import { describe, expect, it } from "vitest";
import {
  TIPOS_DE_DOCUMENTO_DE_IDENTIDAD,
  numeroDeDocumentoDesdeTexto,
  type TipoDeDocumentoDeIdentidad,
} from "./documento";

const CUIT = "30712345671";
const ok = (tipo: TipoDeDocumentoDeIdentidad, texto: string, valor = texto) =>
  expect(numeroDeDocumentoDesdeTexto(tipo, texto), `${tipo} ${texto}`).toEqual({ ok: true, valor });
const mal = (tipo: TipoDeDocumentoDeIdentidad, texto: string) =>
  expect(numeroDeDocumentoDesdeTexto(tipo, texto), `${tipo} ${JSON.stringify(texto)}`).toEqual({
    ok: false,
    error: "DOCUMENTO_INVALIDO",
  });

describe("numeroDeDocumentoDesdeTexto", () => {
  it("los tipos son los cinco, en ese orden", () => {
    expect(TIPOS_DE_DOCUMENTO_DE_IDENTIDAD).toEqual(["CUIT", "CUIL", "CDI", "DNI", "PASAPORTE"]);
  });

  it("CUIT, CUIL y CDI: 11 dígitos con verificador; con guiones se guarda sin ellos", () => {
    for (const tipo of ["CUIT", "CUIL", "CDI"] as const) {
      ok(tipo, CUIT);
      ok(tipo, "30-71234567-1", CUIT);
      mal(tipo, "30712345672");
      mal(tipo, "123");
      mal(tipo, "");
      mal(tipo, "3071234567a");
      mal(tipo, " 30712345671");
    }
  });

  it("un nombre en el campo del documento se rechaza en todos los tipos", () => {
    for (const tipo of TIPOS_DE_DOCUMENTO_DE_IDENTIDAD) mal(tipo, "Distribuidora Sur SA");
  });

  it("DNI: de 6 a 9 dígitos y sin cero a la izquierda", () => {
    for (const numero of ["123456", "12345678", "123456789"]) ok("DNI", numero);
    for (const numero of [
      "12345",
      "1234567890",
      "012345678",
      "1234567a",
      "",
      "12 345 678",
      "12.345.67",
      "12..345.678",
      "12345.678",
      ".12.345.678",
      "012.345.678",
      "1.234",
      "12.345.678.9",
      "12.345.678 ",
    ]) {
      mal("DNI", numero);
    }
  });

  it("DNI: con puntos de miles se acepta y se guarda en su forma canónica (Q6)", () => {
    ok("DNI", "12.345.678", "12345678");
    ok("DNI", "1.234.567", "1234567");
    ok("DNI", "123.456", "123456");
    ok("DNI", "123.456.789", "123456789");
  });

  it("pasaporte: solo dígitos, de 1 a 11", () => {
    for (const numero of ["0", "007", "12345678901"]) ok("PASAPORTE", numero);
    for (const numero of ["", "123456789012", "AAB123456", "-1", "1.5"]) mal("PASAPORTE", numero);
  });
});
