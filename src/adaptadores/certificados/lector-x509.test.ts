import { createHash, webcrypto, X509Certificate } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ErrorDeConfiguracion } from "../postgres/errores";
import {
  crearAutoridadIntermedia,
  crearAutoridadRaiz,
  emitirCertificado,
  type Autoridad,
} from "../../../test/utilidades/certificados-de-prueba";
import { crearGeneradorDeCredenciales } from "./generador-pkijs";
import { crearLectorDeCertificados } from "./lector-x509";

/**
 * El lector de certificados X.509: leer, comparar con la clave y cerrar la cadena contra las autoridades del MISMO
 * ambiente. Las autoridades, el pedido y el certificado emitido salen de la propia prueba (nunca claves reales).
 */

const DIA = 86_400_000;
const AHORA = new Date("2026-10-14T12:00:00.000Z");
const CUIT = "CUIT 20123456786";
const generador = crearGeneradorDeCredenciales();

type Emitido = Readonly<{
  pem: string;
  clave: Awaited<ReturnType<typeof generador.generar>>["clavePrivada"];
}>;

let raiz: Autoridad;
let intermedia: Autoridad;
let otraRaiz: Autoridad;
let otraIntermedia: Autoridad;
let emitido: Emitido;

async function emitirPara(
  autoridad: Autoridad,
  numeroDeSerie: string | null = CUIT,
): Promise<Emitido> {
  const { clavePrivada, pedidoPem } = await generador.generar({
    alias: "zuluhub1",
    organizacion: "Coop Pampa SA",
    numeroDeSerie: CUIT,
  });
  return {
    pem: await emitirCertificado(autoridad, pedidoPem, { numeroDeSerie }),
    clave: clavePrivada,
  };
}

const ancla = (...autoridades: Autoridad[]) => autoridades.map((a) => a.certificadoPem);

beforeAll(async () => {
  raiz = await crearAutoridadRaiz("AC Raiz Test");
  intermedia = await crearAutoridadIntermedia(raiz, "Computadores Test");
  otraRaiz = await crearAutoridadRaiz("AFIP Root CA 2");
  otraIntermedia = await crearAutoridadIntermedia(otraRaiz, "Computadores");
  emitido = await emitirPara(intermedia);
}, 60_000);

describe("leer", () => {
  const lector = crearLectorDeCertificados({ HOMOLOGACION: [], PRODUCCION: [] });

  it("devuelve la huella SHA-256 del DER, el serialNumber del sujeto y las fechas de validez", async () => {
    const noAntes = new Date("2026-10-01T00:00:00.000Z");
    const noDespues = new Date("2028-10-01T00:00:00.000Z");
    const { clavePrivada, pedidoPem } = await generador.generar({
      alias: "a",
      organizacion: "O",
      numeroDeSerie: CUIT,
    });
    const pem = await emitirCertificado(intermedia, pedidoPem, { noAntes, noDespues });
    expect(clavePrivada).toBeDefined();
    expect(lector.leer(pem)).toEqual({
      huellaSha256: createHash("sha256").update(new X509Certificate(pem).raw).digest("hex"),
      numeroDeSerieDelSujeto: CUIT,
      noAntes,
      noDespues,
    });
  });

  it("la huella es hexadecimal minúscula de 64 caracteres y cambia con el certificado", async () => {
    const otro = await emitirPara(intermedia);
    const a = lector.leer(emitido.pem)?.huellaSha256 ?? "";
    const b = lector.leer(otro.pem)?.huellaSha256 ?? "";
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("un certificado sin serialNumber en el sujeto lo informa como null", async () => {
    const sin = await emitirPara(intermedia, null);
    expect(lector.leer(sin.pem)?.numeroDeSerieDelSujeto).toBeNull();
  });

  it.each([
    ["vacío", ""],
    ["texto cualquiera", "no es un certificado"],
    [
      "un bloque con base64 que no es un certificado",
      "-----BEGIN CERTIFICATE-----\nQUJDREVGR0g=\n-----END CERTIFICATE-----\n",
    ],
    ["una clave privada", "-----BEGIN PRIVATE KEY-----\nQUJD\n-----END PRIVATE KEY-----\n"],
  ])("%s → null", (_nombre, pem) => {
    expect(lector.leer(pem)).toBeNull();
  });

  it("un certificado truncado → null", () => {
    expect(lector.leer(emitido.pem.slice(0, 200))).toBeNull();
  });
});

describe("correspondeALaClave", () => {
  const lector = crearLectorDeCertificados({ HOMOLOGACION: [], PRODUCCION: [] });

  it("es true con la clave que generó el pedido y false con cualquier otra", async () => {
    expect(lector.correspondeALaClave(emitido.pem, emitido.clave)).toBe(true);
    const otra = await emitirPara(intermedia);
    expect(lector.correspondeALaClave(emitido.pem, otra.clave)).toBe(false);
    expect(lector.correspondeALaClave(otra.pem, otra.clave)).toBe(true);
  });

  it("false si la clave no es una clave o el certificado no es un certificado (nunca lanza)", async () => {
    const { Secreto } = await import("../../primitivas/secreto/secreto");
    expect(lector.correspondeALaClave(emitido.pem, new Secreto("basura"))).toBe(false);
    expect(lector.correspondeALaClave("basura", emitido.clave)).toBe(false);
  });

  it("false si la clave es de otro tipo (curva elíptica) que la del certificado", async () => {
    const { Secreto } = await import("../../primitivas/secreto/secreto");
    const par = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", par.privateKey)).toString(
      "base64",
    );
    const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n`;
    expect(lector.correspondeALaClave(emitido.pem, new Secreto(pem))).toBe(false);
  });
});

describe("cadenaCierra: contra las autoridades del MISMO ambiente", () => {
  // Las autoridades se crean en `beforeAll`: el lector se arma cuando ya existen.
  const lector = () =>
    crearLectorDeCertificados({
      HOMOLOGACION: ancla(raiz, intermedia),
      PRODUCCION: ancla(otraRaiz, otraIntermedia),
    });

  it("cierra con la raíz y la intermedia de su ambiente, y no con las del otro", () => {
    expect(lector().cadenaCierra(emitido.pem, "HOMOLOGACION", AHORA)).toBe(true);
    expect(lector().cadenaCierra(emitido.pem, "PRODUCCION", AHORA)).toBe(false);
  });

  it("un certificado emitido por la cadena de producción cierra en producción y no en homologación", async () => {
    const deProduccion = await emitirPara(otraIntermedia);
    expect(lector().cadenaCierra(deProduccion.pem, "PRODUCCION", AHORA)).toBe(true);
    expect(lector().cadenaCierra(deProduccion.pem, "HOMOLOGACION", AHORA)).toBe(false);
  });

  it("sin autoridades configuradas para el ambiente no cierra (falla cerrado)", () => {
    const sin = crearLectorDeCertificados({
      HOMOLOGACION: [],
      PRODUCCION: ancla(otraRaiz, otraIntermedia),
    });
    expect(sin.cadenaCierra(emitido.pem, "HOMOLOGACION", AHORA)).toBe(false);
  });

  it("falta la intermedia o falta la raíz: la cadena no cierra", () => {
    expect(
      crearLectorDeCertificados({ HOMOLOGACION: ancla(raiz), PRODUCCION: [] }).cadenaCierra(
        emitido.pem,
        "HOMOLOGACION",
        AHORA,
      ),
    ).toBe(false);
    expect(
      crearLectorDeCertificados({ HOMOLOGACION: ancla(intermedia), PRODUCCION: [] }).cadenaCierra(
        emitido.pem,
        "HOMOLOGACION",
        AHORA,
      ),
    ).toBe(false);
  });

  it("un certificado de otra autoridad, o con la firma de otra clave, no cierra", async () => {
    const ajeno = await emitirPara(otraIntermedia);
    expect(lector().cadenaCierra(ajeno.pem, "HOMOLOGACION", AHORA)).toBe(false);
    // Mismo nombre de emisor que la intermedia pero otra clave: el nombre coincide y la firma no.
    const falsa = await crearAutoridadIntermedia(raiz, "Computadores Test");
    const falsificado = await emitirPara(falsa);
    expect(lector().cadenaCierra(falsificado.pem, "HOMOLOGACION", AHORA)).toBe(false);
  });

  it("una autoridad pegada como si fuera el certificado del emisor no cierra", () => {
    expect(lector().cadenaCierra(intermedia.certificadoPem, "HOMOLOGACION", AHORA)).toBe(false);
    expect(lector().cadenaCierra(raiz.certificadoPem, "HOMOLOGACION", AHORA)).toBe(false);
  });

  it("un certificado que no es legible no cierra (nunca lanza)", () => {
    expect(lector().cadenaCierra("basura", "HOMOLOGACION", AHORA)).toBe(false);
  });

  it("una intermedia que no es de autoridad (sin CA:TRUE) no sirve de eslabón", async () => {
    const intermediaFalsa = await crearAutoridadIntermedia(
      raiz,
      "Intermedia Falsa",
      undefined,
      false,
    );
    const deLaFalsa = await emitirPara(intermediaFalsa);
    const l = crearLectorDeCertificados({
      HOMOLOGACION: ancla(raiz, intermediaFalsa),
      PRODUCCION: [],
    });
    expect(l.cadenaCierra(deLaFalsa.pem, "HOMOLOGACION", AHORA)).toBe(false);
  });

  describe("la validez de las autoridades se mide con la hora dada (inclusive al comienzo, exclusive al final)", () => {
    const desde = new Date("2026-01-01T00:00:00.000Z");
    const hasta = new Date("2026-12-31T00:00:00.000Z");
    let acotada: Autoridad;
    let delaAcotada: Emitido;
    beforeAll(async () => {
      acotada = await crearAutoridadIntermedia(raiz, "Acotada", {
        noAntes: desde,
        noDespues: hasta,
      });
      delaAcotada = await emitirPara(acotada);
    }, 60_000);
    const cierraEn = (ahora: Date) =>
      crearLectorDeCertificados({
        HOMOLOGACION: ancla(raiz, acotada),
        PRODUCCION: [],
      }).cadenaCierra(delaAcotada.pem, "HOMOLOGACION", ahora);

    it.each([
      ["un milisegundo antes del comienzo", new Date(desde.getTime() - 1), false],
      ["en el instante del comienzo", desde, true],
      ["en el medio", AHORA, true],
      ["un milisegundo antes del final", new Date(hasta.getTime() - 1), true],
      ["en el instante del final", hasta, false],
      ["después del final", new Date(hasta.getTime() + DIA), false],
    ])("%s", (_nombre, ahora, esperado) => {
      expect(cierraEn(ahora)).toBe(esperado);
    });
  });

  it("una cadena de cuatro eslabones cierra y una de cinco no (el tope corta los ciclos y las cadenas absurdas)", async () => {
    const a = await crearAutoridadIntermedia(raiz, "A");
    const b = await crearAutoridadIntermedia(a, "B");
    const c = await crearAutoridadIntermedia(b, "C");
    const d = await crearAutoridadIntermedia(c, "D");
    const de3 = await emitirPara(c); // hoja → C → B → A → raíz: 4 eslabones
    const de4 = await emitirPara(d); // hoja → D → C → B → A → raíz: 5 eslabones
    const l = crearLectorDeCertificados({ HOMOLOGACION: ancla(raiz, a, b, c, d), PRODUCCION: [] });
    expect(l.cadenaCierra(de3.pem, "HOMOLOGACION", AHORA)).toBe(true);
    expect(l.cadenaCierra(de4.pem, "HOMOLOGACION", AHORA)).toBe(false);
  });
});

describe("autoridades mal configuradas: falla cerrado y el mensaje no repite su contenido", () => {
  it("una autoridad que no es un certificado lanza ErrorDeConfiguracion", () => {
    const secreto = "-----BEGIN CERTIFICATE-----\nQUJDREVGR0g=\n-----END CERTIFICATE-----";
    for (const ambiente of ["HOMOLOGACION", "PRODUCCION"] as const) {
      const cadenas = {
        HOMOLOGACION: [] as string[],
        PRODUCCION: [] as string[],
        [ambiente]: [secreto],
      };
      let mensaje = "";
      try {
        crearLectorDeCertificados(cadenas);
      } catch (e) {
        expect(e).toBeInstanceOf(ErrorDeConfiguracion);
        mensaje = (e as Error).message;
      }
      expect(mensaje).not.toBe("");
      expect(mensaje).not.toContain("QUJD");
    }
  });

  it("acepta una autoridad con los saltos de línea `\\r` solos que traen los archivos de ARCA", () => {
    const conCr = raiz.certificadoPem.replace(/\n/g, "\r");
    expect(() =>
      crearLectorDeCertificados({ HOMOLOGACION: [conCr], PRODUCCION: [] }),
    ).not.toThrow();
  });
});
