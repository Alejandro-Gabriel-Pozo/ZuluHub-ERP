import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import type { Dato } from "../../puertos/sin-secretos";
import {
  claveDeIdempotenciaValida,
  decidirConsulta,
  exigirClaveYOperacion,
  formaCanonica,
  huellaCanonica,
  operacionDeIdempotenciaValida,
} from "./huella-canonica";

const HUELLA_A = "a".repeat(64);
const HUELLA_B = "b".repeat(64);

describe("claveDeIdempotenciaValida", () => {
  it("acepta de 16 a 128 letras, números, guion y guion bajo", () => {
    for (const clave of [
      "a".repeat(16),
      "A".repeat(128),
      "0123456789abcdefABCDEF_-0123",
      "-".repeat(16),
      "_".repeat(20),
    ]) {
      expect(claveDeIdempotenciaValida(clave), clave).toBe(true);
    }
  });

  it("rechaza lo más corto, lo más largo, los caracteres ajenos y los saltos de línea", () => {
    for (const clave of [
      "",
      "a".repeat(15),
      "a".repeat(129),
      `${"a".repeat(16)} `,
      ` ${"a".repeat(16)}`,
      `${"a".repeat(16)}\n`,
      `${"a".repeat(16)}.`,
      `${"a".repeat(15)}ñ`,
      `${"a".repeat(15)}/`,
      `${"a".repeat(15)}:`,
      `${"a".repeat(15)}\u0000`,
    ]) {
      expect(claveDeIdempotenciaValida(clave), JSON.stringify(clave)).toBe(false);
    }
  });
});

describe("operacionDeIdempotenciaValida", () => {
  it("acepta minúsculas, guion bajo y punto", () => {
    for (const operacion of [
      "empresas.alta",
      "a",
      "altas.cancelar_alta",
      "._",
      "tenants.suspender",
    ]) {
      expect(operacionDeIdempotenciaValida(operacion), operacion).toBe(true);
    }
  });

  it("rechaza vacía, mayúsculas, números, espacios, guiones y saltos de línea", () => {
    for (const operacion of [
      "",
      "Empresas.alta",
      "empresas.alta2",
      "empresas alta",
      "empresas-alta",
      "empresas.alta\n",
      "\nempresas.alta",
      "empresas/alta",
    ]) {
      expect(operacionDeIdempotenciaValida(operacion), JSON.stringify(operacion)).toBe(false);
    }
  });
});

describe("exigirClaveYOperacion", () => {
  const clave = "clave-de-prueba-0001";

  it("no lanza con una clave y una operación válidas", () => {
    expect(() => exigirClaveYOperacion(clave, "empresas.alta")).not.toThrow();
  });

  it("lanza RangeError con la clave inválida, con su propio mensaje", () => {
    expect(() => exigirClaveYOperacion("corta", "empresas.alta")).toThrow(RangeError);
    expect(() => exigirClaveYOperacion("corta", "empresas.alta")).toThrow(
      "idempotencia: la clave debe tener de 16 a 128 letras, números, _ o -",
    );
  });

  it("lanza RangeError con la operación inválida, con su propio mensaje", () => {
    expect(() => exigirClaveYOperacion(clave, "Alta")).toThrow(RangeError);
    expect(() => exigirClaveYOperacion(clave, "Alta")).toThrow(
      "idempotencia: la operación debe ser minúsculas, _ o .",
    );
  });

  it("si las dos son inválidas, se queja primero de la clave", () => {
    expect(() => exigirClaveYOperacion("x", "Y")).toThrow("la clave");
  });
});

describe("formaCanonica", () => {
  it("escribe cada tipo de dato como JSON", () => {
    expect(formaCanonica(null)).toBe("null");
    expect(formaCanonica(true)).toBe("true");
    expect(formaCanonica(false)).toBe("false");
    expect(formaCanonica(0)).toBe("0");
    expect(formaCanonica(-0)).toBe("0");
    expect(formaCanonica(12.5)).toBe("12.5");
    expect(formaCanonica(-3)).toBe("-3");
    expect(formaCanonica("")).toBe('""');
    expect(formaCanonica('a"b\\c\n')).toBe('"a\\"b\\\\c\\n"');
    expect(formaCanonica([])).toBe("[]");
    expect(formaCanonica({})).toBe("{}");
    expect(formaCanonica([1, "a", null, [true]])).toBe('[1,"a",null,[true]]');
  });

  it("ordena las claves de cada objeto, en cualquier nivel, y no ordena los arreglos", () => {
    expect(formaCanonica({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }, 3, 1] } })).toBe(
      '{"a":{"c":[{"y":2,"z":1},3,1],"d":2},"b":1}',
    );
    expect(formaCanonica([3, 1, 2])).toBe("[3,1,2]");
  });

  it("ordena por unidades de código: mayúsculas antes que minúsculas", () => {
    expect(formaCanonica({ b: 1, B: 2, a: 3, A: 4 })).toBe('{"A":4,"B":2,"a":3,"b":1}');
  });

  it("dos objetos con los mismos datos en otro orden dan el mismo texto", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ maxLength: 6 }),
          fc.oneof(fc.integer(), fc.string(), fc.boolean()),
        ),
        (objeto) => {
          const invertido = Object.fromEntries(Object.entries(objeto).reverse());
          expect(formaCanonica(invertido)).toBe(formaCanonica(objeto));
        },
      ),
    );
  });

  it("distingue lo que JSON.stringify confundiría: null, NaN e infinitos no se mezclan", () => {
    expect(() => formaCanonica(Number.NaN)).toThrow(RangeError);
    expect(() => formaCanonica(Number.NaN)).toThrow("idempotencia: número no finito");
    expect(() => formaCanonica(Number.POSITIVE_INFINITY)).toThrow("idempotencia: número no finito");
    expect(() => formaCanonica(Number.NEGATIVE_INFINITY)).toThrow("idempotencia: número no finito");
    expect(() => formaCanonica({ a: Number.NaN })).toThrow(RangeError);
    expect(() => formaCanonica([Number.POSITIVE_INFINITY])).toThrow(RangeError);
  });

  it("rechaza lo que no es un dato guardable: undefined, bigint, funciones y símbolos", () => {
    const malos: unknown[] = [undefined, 10n, () => 1, Symbol("x")];
    for (const malo of malos) {
      expect(() => formaCanonica(malo as Dato), String(typeof malo)).toThrow(RangeError);
    }
    expect(() => formaCanonica(undefined as unknown as Dato)).toThrow(
      "idempotencia: un undefined no se puede guardar",
    );
    expect(() => formaCanonica({ a: undefined } as unknown as Dato)).toThrow(RangeError);
    expect(() => formaCanonica([undefined] as unknown as Dato)).toThrow(RangeError);
  });
});

describe("huellaCanonica", () => {
  it("es el sha256 en hexadecimal de la forma canónica (vectores calculados aparte)", () => {
    expect(huellaCanonica({ b: [true, null, "x"], a: 1 })).toBe(
      "eca8cfb31ab74533e1eb2f4c74d2d55dfe3c79ac704787e54be8647ea7777eb1",
    );
    expect(huellaCanonica({})).toBe(
      "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    );
  });

  it("el texto va en UTF-8 (vector calculado aparte con acentos y un emoji)", () => {
    expect(huellaCanonica({ razón: "Ñandú 🦜" })).toBe(
      "c9ac4190f9469beca43d0ffb58d534ef5a4ee4442f90fa044ca82e3ae6e19f6c",
    );
  });

  it("tiene 64 caracteres hexadecimales en minúscula", () => {
    fc.assert(
      fc.property(fc.string(), (texto) => {
        expect(huellaCanonica(texto)).toMatch(/^[0-9a-f]{64}$/);
      }),
    );
  });

  it("cambia con cualquier cambio de la entrada", () => {
    const base = huellaCanonica({ cuit: "20123456786", razon: "ACME" });
    expect(huellaCanonica({ cuit: "20123456786", razon: "ACME " })).not.toBe(base);
    expect(huellaCanonica({ cuit: "20123456787", razon: "ACME" })).not.toBe(base);
    expect(huellaCanonica({ cuit: "20123456786" })).not.toBe(base);
    expect(huellaCanonica({ razon: "ACME", cuit: "20123456786" })).toBe(base);
    expect(huellaCanonica("1")).not.toBe(huellaCanonica(1));
    expect(huellaCanonica(null)).not.toBe(huellaCanonica("null"));
  });
});

describe("decidirConsulta", () => {
  const guardada = { operacion: "empresas.alta", huella: HUELLA_A, resultado: { empresaId: "e1" } };

  it("sin fila, la clave es nueva", () => {
    expect(decidirConsulta(null, "empresas.alta", HUELLA_A)).toEqual({ tipo: "NUEVA" });
  });

  it("misma operación y misma huella: repetida, con lo guardado", () => {
    expect(decidirConsulta(guardada, "empresas.alta", HUELLA_A)).toEqual({
      tipo: "REPETIDA",
      resultado: { empresaId: "e1" },
    });
  });

  it("otra huella: la clave se reutilizó", () => {
    expect(decidirConsulta(guardada, "empresas.alta", HUELLA_B)).toEqual({
      tipo: "CLAVE_REUTILIZADA",
    });
  });

  it("otra operación con la misma huella: la clave se reutilizó", () => {
    expect(decidirConsulta(guardada, "altas.cancelar", HUELLA_A)).toEqual({
      tipo: "CLAVE_REUTILIZADA",
    });
  });

  it("otra operación y otra huella: la clave se reutilizó", () => {
    expect(decidirConsulta(guardada, "altas.cancelar", HUELLA_B)).toEqual({
      tipo: "CLAVE_REUTILIZADA",
    });
  });

  it("devuelve el resultado guardado aunque sea null, 0 o texto vacío", () => {
    for (const resultado of [null, 0, "", false, []] as const) {
      expect(
        decidirConsulta({ ...guardada, resultado }, "empresas.alta", HUELLA_A),
        JSON.stringify(resultado),
      ).toEqual({ tipo: "REPETIDA", resultado });
    }
  });
});
