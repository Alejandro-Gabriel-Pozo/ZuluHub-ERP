import { createPrivateKey, createPublicKey } from "node:crypto";
import * as asn1js from "asn1js";
import { CertificationRequest } from "pkijs";
import { describe, expect, it } from "vitest";
import { crearGeneradorDeCredenciales } from "./generador-pkijs";

/**
 * El generador de la clave y el pedido (CSR) de un certificado de ARCA. Cada prueba genera su propia clave (RSA de
 * 2048 bits, unos 100 ms): nunca una clave real.
 */

const generador = crearGeneradorDeCredenciales();
const DATOS = {
  alias: "zuluhub2026",
  organizacion: "Pañalera Ñandú S.R.L.",
  numeroDeSerie: "CUIT 20123456786",
};

const analizarPedido = (pem: string): CertificationRequest => {
  const base64 = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  return new CertificationRequest({ schema: asn1js.fromBER(Buffer.from(base64, "base64")).result });
};

describe("generador de credenciales (pkijs)", () => {
  it("genera una clave RSA de 2048 bits en PKCS#8 y un pedido en PEM", async () => {
    const { clavePrivada, pedidoPem } = await generador.generar(DATOS);
    const pem = clavePrivada.revelar();
    expect(pem).toMatch(
      /^-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PRIVATE KEY-----\n$/,
    );
    const clave = createPrivateKey(pem);
    expect(clave.asymmetricKeyType).toBe("rsa");
    expect(clave.asymmetricKeyDetails?.modulusLength).toBe(2048);
    expect(pedidoPem).toMatch(
      /^-----BEGIN CERTIFICATE REQUEST-----\n[A-Za-z0-9+/=\n]+\n-----END CERTIFICATE REQUEST-----\n$/,
    );
    // Líneas de 64 caracteres, como los demás PEM.
    for (const linea of pedidoPem.split("\n")) expect(linea.length).toBeLessThanOrEqual(64);
  });

  it("el pedido lleva el sujeto C=AR, O, CN y serialNumber, cada uno en su propio conjunto (como `openssl -subj`)", async () => {
    const { pedidoPem } = await generador.generar(DATOS);
    const pedido = analizarPedido(pedidoPem);
    expect(
      pedido.subject.typesAndValues.map((a) => [
        a.type,
        (a.value.valueBlock as { value: string }).value,
      ]),
    ).toEqual([
      ["2.5.4.6", "AR"],
      ["2.5.4.10", DATOS.organizacion],
      ["2.5.4.3", DATOS.alias],
      ["2.5.4.5", DATOS.numeroDeSerie],
    ]);
    // En el DER: un SEQUENCE de cuatro SET con un solo atributo cada uno (no un SET multivaluado).
    const nombre = pedido.subject.toSchema();
    expect(nombre).toBeInstanceOf(asn1js.Sequence);
    const conjuntos = nombre.valueBlock.value;
    expect(conjuntos).toHaveLength(4);
    for (const conjunto of conjuntos) {
      expect(conjunto).toBeInstanceOf(asn1js.Set);
      expect((conjunto as asn1js.Set).valueBlock.value).toHaveLength(1);
    }
  });

  it("el pedido está firmado con SHA-256 y RSA, la firma verifica y la clave pública es la de la clave privada", async () => {
    const { clavePrivada, pedidoPem } = await generador.generar(DATOS);
    const pedido = analizarPedido(pedidoPem);
    expect(pedido.signatureAlgorithm.algorithmId).toBe("1.2.840.113549.1.1.11");
    expect(await pedido.verify()).toBe(true);
    const delPedido = Buffer.from(pedido.subjectPublicKeyInfo.toSchema().toBER(false));
    const derivada = createPublicKey(createPrivateKey(clavePrivada.revelar())).export({
      type: "spki",
      format: "der",
    });
    expect(delPedido.equals(derivada)).toBe(true);
  });

  it("cada llamada genera un par nuevo", async () => {
    const [a, b] = await Promise.all([generador.generar(DATOS), generador.generar(DATOS)]);
    expect(a.clavePrivada.esIgualA(b.clavePrivada)).toBe(false);
    expect(a.pedidoPem).not.toBe(b.pedidoPem);
  });

  it("la clave sale envuelta: serializarla no la muestra, y el pedido no contiene nada de ella", async () => {
    const { clavePrivada, pedidoPem } = await generador.generar(DATOS);
    expect(JSON.stringify({ clavePrivada })).toBe('{"clavePrivada":"[secreto]"}');
    const cuerpoDeLaClave = clavePrivada.revelar().split("\n")[1] ?? "";
    expect(cuerpoDeLaClave.length).toBeGreaterThan(20);
    expect(pedidoPem).not.toContain(cuerpoDeLaClave);
    expect(pedidoPem).not.toContain("PRIVATE");
  });
}, 60_000);
