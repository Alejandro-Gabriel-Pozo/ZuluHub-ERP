import { createHash, X509Certificate } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { crearGeneradorDeCredenciales } from "../adaptadores/certificados/generador-pkijs";
import { crearLectorDeCertificados } from "../adaptadores/certificados/lector-x509";
import {
  crearAutoridadIntermedia,
  crearAutoridadRaiz,
  emitirCertificado,
  type Autoridad,
} from "../../test/utilidades/certificados-de-prueba";
import {
  CADENAS_DE_CONFIANZA_DE_ARCA,
  INTERMEDIA_DE_HOMOLOGACION,
  RAIZ_DE_HOMOLOGACION,
} from "./cadenas-de-confianza-de-arca";

/**
 * Las anclas de ARCA son datos que no pueden cambiar sin que el dueño lo decida: la huella verificada el 2026-11-04 (README de docs,
 * «Autenticidad VERIFICADA») está escrita acá de nuevo a propósito, aparte de la constante, para que cambiar un byte del PEM o de su
 * huella en un solo lugar haga fallar la prueba. Los certificados de las pruebas de aceptación y rechazo nacen acá (nunca reales).
 */

const HUELLA_RAIZ_VERIFICADA =
  "FD:72:00:97:84:9F:D2:CA:0F:17:3F:1A:94:38:C3:61:71:35:61:C9:16:19:2A:38:FD:9A:E4:49:DD:1B:2D:34";
const HUELLA_INTERMEDIA_VERIFICADA =
  "40:FD:CA:A7:BA:F7:66:D3:A6:44:E6:07:59:D4:EA:48:DD:9E:AB:E2:D5:42:EF:EB:5E:F0:73:B6:89:57:76:9E";

const DIA = 86_400_000;
const HOY = new Date("2026-11-04T12:00:00.000Z");
const huellaDelDer = (c: X509Certificate): string =>
  createHash("sha256")
    .update(c.raw)
    .digest("hex")
    .toUpperCase()
    .replace(/(..)(?!$)/g, "$1:");

describe("las autoridades de homologación cargadas", () => {
  const raiz = new X509Certificate(RAIZ_DE_HOMOLOGACION.pem);
  const intermedia = new X509Certificate(INTERMEDIA_DE_HOMOLOGACION.pem);

  it("la huella de cada PEM recalculada coincide con la constante y con la verificada por el dueño", () => {
    expect(RAIZ_DE_HOMOLOGACION.huellaSha256).toBe(HUELLA_RAIZ_VERIFICADA);
    expect(INTERMEDIA_DE_HOMOLOGACION.huellaSha256).toBe(HUELLA_INTERMEDIA_VERIFICADA);
    expect(huellaDelDer(raiz)).toBe(HUELLA_RAIZ_VERIFICADA);
    expect(huellaDelDer(intermedia)).toBe(HUELLA_INTERMEDIA_VERIFICADA);
    expect(raiz.fingerprint256).toBe(HUELLA_RAIZ_VERIFICADA);
    expect(intermedia.fingerprint256).toBe(HUELLA_INTERMEDIA_VERIFICADA);
  });

  it("son la raíz «AC Raiz Test» (autofirmada) y la intermedia «Computadores Test» firmada por ella, ambas de autoridad", () => {
    expect(raiz.subject).toContain("CN=AC Raiz Test");
    expect(raiz.ca).toBe(true);
    expect(raiz.checkIssued(raiz) && raiz.verify(raiz.publicKey)).toBe(true);
    expect(intermedia.subject).toContain("CN=Computadores Test");
    expect(intermedia.ca).toBe(true);
    expect(intermedia.checkIssued(raiz) && intermedia.verify(raiz.publicKey)).toBe(true);
  });

  it("vencen cuando dice el README: la intermedia el 2030-07-07 y la raíz el 2034-06-06", () => {
    expect(new Date(intermedia.validTo).toISOString()).toBe("2030-07-07T12:50:59.000Z");
    expect(new Date(raiz.validTo).toISOString()).toBe("2034-06-06T00:00:00.000Z");
  });

  it("la composición confía en esas dos y en ninguna más; PRODUCCIÓN sigue vacía (sin verificar, falla cerrado)", () => {
    expect(CADENAS_DE_CONFIANZA_DE_ARCA.HOMOLOGACION).toEqual([
      RAIZ_DE_HOMOLOGACION.pem,
      INTERMEDIA_DE_HOMOLOGACION.pem,
    ]);
    expect(CADENAS_DE_CONFIANZA_DE_ARCA.PRODUCCION).toEqual([]);
  });
});

describe("el lector con las cadenas de la composición", () => {
  const generador = crearGeneradorDeCredenciales();
  let ajenaRaiz: Autoridad;
  let ajena: Autoridad;
  let delaAjena: string;
  let autofirmado: string;
  let homonima: string;

  const pedido = async () =>
    (await generador.generar({ alias: "a", organizacion: "O", numeroDeSerie: "CUIT 20123456786" }))
      .pedidoPem;

  beforeAll(async () => {
    ajenaRaiz = await crearAutoridadRaiz("AC Raiz Test");
    ajena = await crearAutoridadIntermedia(ajenaRaiz, "Computadores Test");
    delaAjena = await emitirCertificado(ajena, await pedido(), {});
    autofirmado = (await crearAutoridadRaiz("Autofirmado")).certificadoPem;
    // Mismos nombres que las de ARCA pero otra clave: el nombre coincide y la firma no.
    homonima = delaAjena;
  }, 60_000);

  const lector = crearLectorDeCertificados(CADENAS_DE_CONFIANZA_DE_ARCA);

  it("un certificado de otra autoridad, aunque use los mismos nombres, no cierra en ningún ambiente", () => {
    for (const ambiente of ["HOMOLOGACION", "PRODUCCION"] as const) {
      expect(lector.cadenaCierra(homonima, ambiente, HOY)).toBe(false);
    }
  });

  it("un certificado autofirmado no cierra en ningún ambiente", () => {
    for (const ambiente of ["HOMOLOGACION", "PRODUCCION"] as const) {
      expect(lector.cadenaCierra(autofirmado, ambiente, HOY)).toBe(false);
    }
  });

  it("las propias autoridades de ARCA pegadas como certificado del emisor no cierran", () => {
    expect(lector.cadenaCierra(RAIZ_DE_HOMOLOGACION.pem, "HOMOLOGACION", HOY)).toBe(false);
    expect(lector.cadenaCierra(INTERMEDIA_DE_HOMOLOGACION.pem, "HOMOLOGACION", HOY)).toBe(false);
  });

  describe("con una cadena de prueba que reproduce la forma y la vigencia de la de ARCA", () => {
    // Las claves privadas de ARCA no existen acá: se arma una cadena propia y se la ancla con la misma forma de configuración.
    const venceLaIntermedia = new Date("2030-07-07T12:50:59.000Z");
    let raiz: Autoridad;
    let intermedia: Autoridad;
    let hoja: string;

    beforeAll(async () => {
      raiz = await crearAutoridadRaiz("AC Raiz Test");
      intermedia = await crearAutoridadIntermedia(raiz, "Computadores Test", {
        noAntes: new Date("2022-07-07T12:50:59.000Z"),
        noDespues: venceLaIntermedia,
      });
      hoja = await emitirCertificado(intermedia, await pedido(), {
        noAntes: new Date(HOY.getTime() - DIA),
        noDespues: new Date("2032-01-01T00:00:00.000Z"),
      });
    }, 60_000);

    const cadenas = () => ({
      HOMOLOGACION: [raiz.certificadoPem, intermedia.certificadoPem],
      PRODUCCION: [] as string[],
    });

    it("se acepta en homologación y se rechaza en producción (CADENA_NO_CONFIABLE: producción no tiene autoridades)", () => {
      const l = crearLectorDeCertificados(cadenas());
      expect(l.cadenaCierra(hoja, "HOMOLOGACION", HOY)).toBe(true);
      expect(l.cadenaCierra(hoja, "PRODUCCION", HOY)).toBe(false);
    });

    it("vencida la intermedia (2030-07-07) la cadena falla cerrado; un instante antes todavía cierra", () => {
      const l = crearLectorDeCertificados(cadenas());
      expect(l.cadenaCierra(hoja, "HOMOLOGACION", new Date(venceLaIntermedia.getTime() - 1))).toBe(
        true,
      );
      expect(l.cadenaCierra(hoja, "HOMOLOGACION", venceLaIntermedia)).toBe(false);
      expect(l.cadenaCierra(hoja, "HOMOLOGACION", new Date("2030-07-08T00:00:00.000Z"))).toBe(
        false,
      );
    });

    it("no cierra contra las anclas reales de ARCA (no son las mismas claves)", () => {
      expect(lector.cadenaCierra(hoja, "HOMOLOGACION", HOY)).toBe(false);
    });
  });
});
