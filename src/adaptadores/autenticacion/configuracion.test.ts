import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ErrorDeConfiguracion } from "../postgres/errores";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  CARACTERES_DISTINTOS_MINIMOS,
  LARGO_MINIMO_DEL_SECRETO,
  caracteresDistintos,
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
  /** Largo exacto con 16 caracteres distintos (pasa el largo y la variedad). */
  const de = (largo: number) => "0123456789abcdef".repeat(3).slice(0, largo);

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

describe("leerSecretoDeAutenticacion: variedad (M3)", () => {
  const MENSAJE =
    "ZULUHUB_AUTH_SECRETO_EMPRESA inválido: necesita al menos 10 caracteres distintos";
  /** `n` caracteres distintos repetidos hasta `largo`. */
  const con = (n: number, largo = 64) =>
    Array.from({ length: largo }, (_, i) => String.fromCharCode(97 + (i % n))).join("");

  it("el piso es de diez caracteres distintos, contados sin los blancos de los extremos", () => {
    expect(CARACTERES_DISTINTOS_MINIMOS).toBe(10);
    expect(caracteresDistintos("aabbc")).toBe(3);
    expect(caracteresDistintos("")).toBe(0);
    expect(() => leerSecretoDeAutenticacion(con(9))).toThrow(new ErrorDeConfiguracion(MENSAJE));
    expect(leerSecretoDeAutenticacion(con(10))).toBe(con(10));
    // Un blanco del medio cuenta como carácter; los de los extremos no (se recortan antes).
    expect(() => leerSecretoDeAutenticacion(`  ${con(9)}  `)).toThrow(MENSAJE);
  });

  it.each([
    ["un solo carácter repetido", "a".repeat(64)],
    ["dos que se alternan", "ab".repeat(32)],
    ["nueve distintos", con(9)],
    ["un solo número repetido", "7".repeat(40)],
  ])("rechaza %s", (_nombre, secreto) => {
    expect(() => leerSecretoDeAutenticacion(secreto)).toThrow(new ErrorDeConfiguracion(MENSAJE));
  });

  it("propiedad: con menos de diez caracteres distintos siempre se rechaza, sin repetir el valor", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.constantFrom(
            ..."!#$%&()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~",
          ),
          { minLength: 1, maxLength: CARACTERES_DISTINTOS_MINIMOS - 1 },
        ),
        fc.integer({ min: 32, max: 120 }),
        (alfabeto, largo) => {
          const secreto = Array.from(
            { length: largo },
            (_, i) => alfabeto[i % alfabeto.length],
          ).join("");
          const recortado = secreto.trim();
          fc.pre(recortado.length >= LARGO_MINIMO_DEL_SECRETO);
          let mensaje = "";
          try {
            leerSecretoDeAutenticacion(secreto);
          } catch (e) {
            mensaje = (e as Error).message;
          }
          expect(mensaje).toBe(MENSAJE);
          expect(mensaje).not.toContain(recortado);
        },
      ),
    );
  });

  it("propiedad: con diez o más caracteres distintos y el largo suficiente se acepta", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"),
          {
            minLength: CARACTERES_DISTINTOS_MINIMOS,
            maxLength: 40,
          },
        ),
        fc.integer({ min: 0, max: 40 }),
        (alfabeto, extra) => {
          const secreto = [
            ...alfabeto,
            ..."x".repeat(Math.max(0, 32 - alfabeto.length)),
            ..."y".repeat(extra),
          ].join("");
          expect(leerSecretoDeAutenticacion(secreto)).toBe(secreto);
        },
      ),
    );
  });

  it("la prueba de variedad viene después del largo: uno corto dice que es corto", () => {
    expect(() => leerSecretoDeAutenticacion("a".repeat(5))).toThrow(
      "necesita al menos 32 caracteres",
    );
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
