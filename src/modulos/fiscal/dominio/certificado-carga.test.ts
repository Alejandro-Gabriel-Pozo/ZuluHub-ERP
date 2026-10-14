import { describe, expect, it } from "vitest";
import { cuitDesdeTexto, type Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import {
  evaluarCertificado,
  extraerCertificadoPem,
  type HallazgosDelCertificado,
} from "./certificado-carga";

const ENCABEZADO = "-----BEGIN CERTIFICATE-----";
const PIE = "-----END CERTIFICATE-----";
const cuit = (texto: string): Cuit => {
  const r = cuitDesdeTexto(texto);
  if (!r.ok) throw new Error("CUIT de prueba inválido");
  return r.valor;
};
const EMISOR = cuit("20123456786");
const AHORA = new Date("2026-10-14T12:00:00.000Z");

/** Un base64 de `n` caracteres (múltiplo de 4) que usa los 64 símbolos y termina en `==` si se pide. */
const base64 = (n: number, relleno = ""): string => {
  const simbolos = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let t = "";
  for (let i = 0; i < n - relleno.length; i++) t += simbolos[i % 64];
  return t + relleno;
};
const pem = (cuerpo: string, fin = "\n") => `${ENCABEZADO}\n${cuerpo}\n${PIE}${fin}`;
const ILEGIBLE = { ok: false, error: "CERTIFICADO_ILEGIBLE" };

describe("extraerCertificadoPem: un solo bloque CERTIFICATE, en su forma canónica", () => {
  it("lo que ya es canónico vuelve igual", () => {
    const canonico = pem(`${base64(64)}\n${base64(8)}`);
    expect(extraerCertificadoPem(canonico)).toEqual({ ok: true, valor: canonico });
  });

  it("parte el base64 en líneas de 64: una línea, dos y la última justa", () => {
    expect(extraerCertificadoPem(pem(base64(64)))).toEqual({ ok: true, valor: pem(base64(64)) });
    expect(extraerCertificadoPem(pem(base64(68)))).toEqual({
      ok: true,
      valor: pem(`${base64(68).slice(0, 64)}\n${base64(68).slice(64)}`),
    });
    expect(extraerCertificadoPem(pem(base64(128)))).toEqual({
      ok: true,
      valor: pem(`${base64(128).slice(0, 64)}\n${base64(128).slice(64)}`),
    });
    expect(extraerCertificadoPem(pem(base64(4)))).toEqual({ ok: true, valor: pem(base64(4)) });
  });

  it("acepta los símbolos + y / y el relleno = y ==", () => {
    for (const cuerpo of [base64(64), base64(8, "="), base64(8, "==")]) {
      expect(extraerCertificadoPem(pem(cuerpo))).toEqual({ ok: true, valor: pem(cuerpo) });
    }
  });

  it("arregla los saltos de línea de los archivos de ARCA (\\r\\n y \\r solo) y los blancos de más", () => {
    const esperado = pem(`${base64(64)}\n${base64(8)}`);
    const sucio = `\n  ${ENCABEZADO}\r${base64(64).slice(0, 30)}\r\n  ${base64(64).slice(30)}\t\r${base64(8)}\r\n${PIE}  \r\n\r\n`;
    expect(extraerCertificadoPem(sucio)).toEqual({ ok: true, valor: esperado });
    expect(extraerCertificadoPem(`${ENCABEZADO}\r${base64(8)}\r${PIE}`)).toEqual({
      ok: true,
      valor: pem(base64(8)),
    });
  });

  it("acepta el tope de 16.000 caracteres de base64 y rechaza uno más (múltiplo de 4)", () => {
    expect(extraerCertificadoPem(pem(base64(16_000))).ok).toBe(true);
    expect(extraerCertificadoPem(pem(base64(16_004)))).toEqual(ILEGIBLE);
  });

  describe("lo demás es ilegible", () => {
    const clave = `-----BEGIN PRIVATE KEY-----\n${base64(64)}\n-----END PRIVATE KEY-----\n`;
    it.each([
      ["texto vacío", ""],
      ["texto cualquiera", "esto no es un certificado"],
      ["solo el encabezado", ENCABEZADO],
      ["sin pie", `${ENCABEZADO}\n${base64(8)}\n`],
      ["sin encabezado", `${base64(8)}\n${PIE}`],
      ["sin cuerpo", `${ENCABEZADO}\n${PIE}`],
      ["sin cuerpo y sin salto", `${ENCABEZADO}${PIE}`],
      ["una clave privada pegada por error", clave],
      [
        "un pedido de certificado",
        `-----BEGIN CERTIFICATE REQUEST-----\n${base64(8)}\n-----END CERTIFICATE REQUEST-----`,
      ],
      ["el certificado y una clave privada juntos", pem(base64(8)) + clave],
      ["la clave y después el certificado", clave + pem(base64(8))],
      ["dos certificados", pem(base64(8)) + pem(base64(8))],
      ["texto antes del bloque", `Certificado:\n${pem(base64(8))}`],
      ["texto después del bloque", `${pem(base64(8))}fin`],
      ["base64 con un símbolo inválido", pem(`${base64(8)}!`)],
      ["base64 con un guion", pem("AAAA-AAA")],
      ["base64 con relleno en el medio", pem("AA==AAAA")],
      ["base64 con tres rellenos", pem("A===")],
      ["base64 con largo que no es múltiplo de 4", pem(base64(7))],
      ["encabezado en minúscula", pem(base64(8)).replace("BEGIN", "begin")],
    ])("%s", (_nombre, texto) => {
      expect(extraerCertificadoPem(texto)).toEqual(ILEGIBLE);
    });

    it("el mensaje de error nunca repite lo pegado (ni una clave privada)", () => {
      expect(JSON.stringify(extraerCertificadoPem(clave))).not.toContain("PRIVATE");
    });
  });
});

describe("evaluarCertificado", () => {
  const sano: HallazgosDelCertificado = {
    correspondeALaClave: true,
    numeroDeSerieDelSujeto: "CUIT 20123456786",
    cadenaCierra: true,
    noDespues: new Date("2028-10-14T12:00:00.000Z"),
  };
  const evaluar = (cambios: Partial<HallazgosDelCertificado> = {}, ahora = AHORA) =>
    evaluarCertificado(EMISOR, { ...sano, ...cambios }, ahora);

  it("un certificado del emisor, de la clave, con cadena y vigente sirve, y vence en su noDespues", () => {
    expect(evaluar()).toEqual({ ok: true, valor: { vence: sano.noDespues } });
  });

  it("no corresponde a la clave guardada → NO_CORRESPONDE_A_LA_CLAVE", () => {
    expect(evaluar({ correspondeALaClave: false })).toEqual({
      ok: false,
      error: "NO_CORRESPONDE_A_LA_CLAVE",
    });
  });

  describe("el titular tiene que ser el CUIT del emisor", () => {
    it.each([
      ["sin serialNumber", null],
      ["de otro CUIT", "CUIT 30703088534"],
      ["con el CUIT sin la palabra", "20123456786"],
      ["con guiones", "CUIT 20-12345678-6"],
      ["en minúscula", "cuit 20123456786"],
      ["con un espacio al final", "CUIT 20123456786 "],
      ["con más texto", "CUIT 20123456786 SA"],
      ["vacío", ""],
    ])("%s → TITULAR_DISTINTO", (_nombre, numeroDeSerieDelSujeto) => {
      expect(evaluar({ numeroDeSerieDelSujeto })).toEqual({ ok: false, error: "TITULAR_DISTINTO" });
    });
  });

  it("la cadena no cierra → CADENA_NO_CONFIABLE", () => {
    expect(evaluar({ cadenaCierra: false })).toEqual({ ok: false, error: "CADENA_NO_CONFIABLE" });
  });

  it("vence en el instante de la hora: ya venció; un milisegundo antes todavía sirve", () => {
    expect(evaluar({}, sano.noDespues)).toEqual({ ok: false, error: "CERTIFICADO_VENCIDO" });
    expect(evaluar({}, new Date(sano.noDespues.getTime() + 1))).toEqual({
      ok: false,
      error: "CERTIFICADO_VENCIDO",
    });
    expect(evaluar({}, new Date(sano.noDespues.getTime() - 1)).ok).toBe(true);
  });

  it("con varios defectos manda el primero: clave, titular, cadena, vencimiento", () => {
    const todoMal = {
      correspondeALaClave: false,
      numeroDeSerieDelSujeto: null,
      cadenaCierra: false,
      noDespues: AHORA,
    };
    expect(evaluar(todoMal)).toEqual({ ok: false, error: "NO_CORRESPONDE_A_LA_CLAVE" });
    expect(evaluar({ ...todoMal, correspondeALaClave: true })).toEqual({
      ok: false,
      error: "TITULAR_DISTINTO",
    });
    expect(
      evaluar({
        ...todoMal,
        correspondeALaClave: true,
        numeroDeSerieDelSujeto: "CUIT 20123456786",
      }),
    ).toEqual({ ok: false, error: "CADENA_NO_CONFIABLE" });
  });
});
