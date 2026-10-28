import { createPublicKey, verify, webcrypto, X509Certificate } from "node:crypto";
import * as asn1js from "asn1js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  crearAutoridadIntermedia,
  crearAutoridadRaiz,
  firmaEcdsaEnDer,
} from "./certificados-de-prueba";

/**
 * Las firmas de los certificados de prueba. `pkijs` pasaba mal de `r || s` a DER cuando `r` o `s` empezaban con dos
 * bytes en cero (una firma de cada ~65.000): OpenSSL rechazaba la firma y la cadena «no cerraba» de vez
 * en cuando, en cualquier prueba que armara certificados (lector X.509 y certificados concurrentes, falso rojo en el
 * CI). Acá el caso se arma a propósito, sin azar: con firmas reales ya calculadas que traen ese borde.
 *
 * Los vectores son datos PÚBLICOS: una clave pública, un mensaje y su firma. La clave privada se descartó al generarlos.
 */

const CLAVE_PUBLICA_SPKI =
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEDOxvS3uGnljdpSiSrHoncP0+cxA/d3uzYxzTDKUd8G1smg6x33PdOuj542aEVA3CPcck3OOl7KP9tfRQGT6rFQ==";

const VECTORES = [
  [
    "r empieza con dos ceros y un byte menor que 0x80 (el que rompía a pkijs)",
    "vector-78971",
    "00001c999c292343170ff9e53e71cd13d08434326a464b0915570479825ef0c7d7e03ec54cfb7cc08e512d41a737116bfe30a34bbf2022579f25509a3219992e",
  ],
  [
    "s empieza con dos ceros y un byte menor que 0x80 (el otro lado del mismo defecto)",
    "vector-15732",
    "6b87a383454f36640560e27794a79cc5906769de1e65a563f1602f9f08a678c5000004888b196404943a3e84b9321024d8c8d877cc746b77b4dcdfa451acc948",
  ],
  [
    "r empieza con un solo cero y le sigue un byte con el bit alto (el cero hace falta)",
    "vector-2",
    "00d7bfd0cc186b7cacff0515da258d8c1a51dbbe8865947810b372905d00bc03246c427dc75be7e1248c2bfb53f09debdd299d263276acc5174ea7ac823e05f1",
  ],
  [
    "r y s con el bit alto (hay que anteponer un cero a cada uno)",
    "vector-9",
    "a83077acafd217d84cebe4380ed4af73da2c8fd210c35dd44d820758953ad9a7a4368a7807cf5635b811cfa5d1dc993e1063ba129e83f239c3b172aae8a97a61",
  ],
] as const;

const hexABytes = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, "hex"));

/** Los dos enteros de una firma DER, con sus bytes tal cual están (un INTEGER mínimo no sobra ningún cero). */
function enterosDeLaFirma(der: Uint8Array): Uint8Array[] {
  const secuencia = asn1js.fromBER(Uint8Array.from(der).buffer).result as asn1js.Sequence;
  return secuencia.valueBlock.value.map((v) => (v as asn1js.Integer).valueBlock.valueHexView);
}

function esMinimo(entero: Uint8Array): boolean {
  const primero = entero[0] ?? 0;
  const segundo = entero[1] ?? 0xff;
  const sobraUnCero = primero === 0 && entero.length > 1 && (segundo & 0x80) === 0;
  const pareceNegativo = primero >= 0x80;
  return !sobraUnCero && !pareceNegativo;
}

describe("firmaEcdsaEnDer: de r || s a DER mínimo", () => {
  it.each(VECTORES)("%s: OpenSSL la verifica y no sobra ningún cero", (_caso, mensaje, cruda) => {
    const clave = createPublicKey({
      key: Buffer.from(CLAVE_PUBLICA_SPKI, "base64"),
      format: "der",
      type: "spki",
    });
    const der = firmaEcdsaEnDer(hexABytes(cruda));
    expect(
      verify("sha256", Buffer.from(mensaje), { key: clave, dsaEncoding: "der" }, der),
      "la firma en DER verifica con la clave pública",
    ).toBe(true);
    const enteros = enterosDeLaFirma(der);
    expect(enteros).toHaveLength(2);
    expect(enteros.every(esMinimo)).toBe(true);
  });

  it("los vectores son firmas válidas (la misma firma en r || s la acepta WebCrypto)", async () => {
    const clave = await webcrypto.subtle.importKey(
      "spki",
      Buffer.from(CLAVE_PUBLICA_SPKI, "base64"),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    for (const [, mensaje, cruda] of VECTORES) {
      expect(
        await webcrypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          clave,
          hexABytes(cruda),
          Buffer.from(mensaje),
        ),
      ).toBe(true);
    }
  });
});

describe("los certificados de prueba llevan la firma en DER mínimo aunque la firma cruda traiga ceros a la izquierda", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(VECTORES)("%s", async (_caso, _mensaje, cruda) => {
    // Se fuerza la firma cruda del borde (no será válida para este certificado: acá solo importa cómo queda escrita).
    vi.spyOn(webcrypto.subtle, "sign").mockResolvedValue(hexABytes(cruda).buffer as ArrayBuffer);
    const raiz = await crearAutoridadRaiz("Borde");
    const intermedia = await crearAutoridadIntermedia(raiz, "Borde 2");
    for (const pem of [raiz.certificadoPem, intermedia.certificadoPem]) {
      const cert = new X509Certificate(pem);
      // El certificado es SEQUENCE { cuerpo, algoritmo, BIT STRING con la firma }.
      const certificado = asn1js.fromBER(Uint8Array.from(cert.raw).buffer)
        .result as asn1js.Sequence;
      const firma = certificado.valueBlock.value[2] as asn1js.BitString;
      const bytes = new Uint8Array(firma.valueBlock.valueHexView);
      expect(enterosDeLaFirma(bytes).every(esMinimo)).toBe(true);
    }
  });
});
