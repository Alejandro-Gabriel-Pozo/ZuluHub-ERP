import { describe, expect, it } from "vitest";
import { ErrorDeConfiguracion } from "../postgres/errores";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  LARGO_MINIMO_DEL_SECRETO,
  ZULUHUB_AUTH_SECRETO_EMPRESA,
  leerClienteDeGoogle,
  leerSecretoDeAutenticacion,
} from "./configuracion";

/** Valores inventados: lo que se comprueba es la forma de la validación y que ningún error repite el valor. */
const CENTINELA = "valor-secreto-inventado-xyz";

describe("nombres de las variables", () => {
  it("son los que el spec (§5.2) le dio al dueño", () => {
    expect(ZULUHUB_AUTH_SECRETO_EMPRESA).toBe("ZULUHUB_AUTH_SECRETO_EMPRESA");
    expect(GOOGLE_CLIENT_ID).toBe("GOOGLE_CLIENT_ID");
    expect(GOOGLE_CLIENT_SECRET).toBe("GOOGLE_CLIENT_SECRET");
  });
});

describe("leerSecretoDeAutenticacion", () => {
  const de = (largo: number) => "x".repeat(largo);

  it("acepta un secreto de 32 caracteres o más y lo devuelve sin blancos en los extremos", () => {
    expect(LARGO_MINIMO_DEL_SECRETO).toBe(32);
    expect(leerSecretoDeAutenticacion(de(32))).toBe(de(32));
    expect(leerSecretoDeAutenticacion(`  ${de(40)}\n`)).toBe(de(40));
  });

  it("uno de 31 caracteres es corto, y los blancos no cuentan para el largo", () => {
    expect(() => leerSecretoDeAutenticacion(de(31))).toThrow(ErrorDeConfiguracion);
    expect(() => leerSecretoDeAutenticacion(` ${de(31)} `)).toThrow(ErrorDeConfiguracion);
  });

  it.each([undefined, "", "   ", "\n"])("falta (%j)", (valor) => {
    expect(() => leerSecretoDeAutenticacion(valor)).toThrow(
      new ErrorDeConfiguracion("ZULUHUB_AUTH_SECRETO_EMPRESA inválido: falta"),
    );
  });

  it("el motivo de uno corto se dice sin repetir el valor", () => {
    let error: unknown;
    try {
      leerSecretoDeAutenticacion(CENTINELA);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorDeConfiguracion);
    expect((error as Error).message).toBe(
      "ZULUHUB_AUTH_SECRETO_EMPRESA inválido: necesita al menos 32 caracteres",
    );
    expect((error as Error).message).not.toContain(CENTINELA);
  });
});

describe("leerClienteDeGoogle", () => {
  it("devuelve el cliente sin blancos en los extremos", () => {
    expect(leerClienteDeGoogle("  id-de-prueba ", "\tsecreto-de-prueba\n")).toEqual({
      clientId: "id-de-prueba",
      clientSecret: "secreto-de-prueba",
    });
  });

  it("si falta el id, nombra solo el id", () => {
    expect(() => leerClienteDeGoogle(undefined, CENTINELA)).toThrow(
      new ErrorDeConfiguracion("GOOGLE_CLIENT_ID inválido: falta"),
    );
    expect(() => leerClienteDeGoogle("  ", CENTINELA)).toThrow(
      /^GOOGLE_CLIENT_ID inválido: falta$/,
    );
  });

  it("si falta el secreto, nombra solo el secreto", () => {
    expect(() => leerClienteDeGoogle(CENTINELA, undefined)).toThrow(
      new ErrorDeConfiguracion("GOOGLE_CLIENT_SECRET inválido: falta"),
    );
    expect(() => leerClienteDeGoogle(CENTINELA, "")).toThrow(
      /^GOOGLE_CLIENT_SECRET inválido: falta$/,
    );
  });

  it("si faltan los dos, los nombra a los dos, y nunca repite un valor", () => {
    let error: unknown;
    try {
      leerClienteDeGoogle("", "  ");
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toBe("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET inválido: falta");
  });
});
