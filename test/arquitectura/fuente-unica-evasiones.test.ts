import { describe, expect, it } from "vitest";
import { constantesDeLargo, duplicadosPorArchivo } from "./fuente-unica-apoyo";

/**
 * Violaciones inyectadas de `fuente-unica.test.ts`: cada forma de escribir un tope de largo dos veces tiene su caso. Si se debilita el
 * analizador (`fuente-unica-apoyo.ts`), el caso deja de contar y esta prueba se pone roja. Y lo correcto (importar la constante,
 * un número sin vínculo con ninguna constante) no cuenta.
 */

const DUENA = "export const LARGO_MAXIMO_DEL_NOMBRE = 80;\n";
const cuenta = (archivos: Record<string, string>) =>
  Object.fromEntries(duplicadosPorArchivo(new Map(Object.entries(archivos))));

describe("fuente única: la misma constante en dos archivos", () => {
  it("cuenta la copia (la de fuera de src/) y no a la dueña", () => {
    expect(cuenta({ "src/a.ts": DUENA, "apps/b.ts": DUENA })).toEqual({ "apps/b.ts": 1 });
    expect(cuenta({ "apps/b.ts": DUENA, "src/a.ts": DUENA })).toEqual({ "apps/b.ts": 1 });
  });

  it("entre dos de src/ cuenta la de ruta posterior", () => {
    expect(cuenta({ "src/a.ts": DUENA, "src/b.ts": DUENA })).toEqual({ "src/b.ts": 1 });
  });

  it("entre dos de apps/ (sin dueña en src/) cuenta la segunda", () => {
    expect(cuenta({ "apps/a.ts": DUENA, "apps/b.ts": DUENA })).toEqual({ "apps/b.ts": 1 });
  });

  it("no cuenta el mismo nombre con otro valor (otro dato) ni nombres distintos", () => {
    expect(
      cuenta({ "src/a.ts": DUENA, "src/b.ts": "export const LARGO_MAXIMO_DEL_NOMBRE = 90;\n" }),
    ).toEqual({});
    expect(
      cuenta({ "src/a.ts": DUENA, "src/b.ts": "export const LARGO_MAXIMO_DEL_TEXTO = 80;\n" }),
    ).toEqual({});
  });

  it("solo mira constantes exportadas con valor numérico", () => {
    expect(
      constantesDeLargo(
        "x.ts",
        "const LARGO_MAXIMO_A = 3;\nexport const LARGO_MAXIMO_B = LARGO;\nexport const OTRA = 4;",
      ),
    ).toEqual([]);
    expect(constantesDeLargo("x.ts", DUENA)).toEqual([
      { nombre: "LARGO_MAXIMO_DEL_NOMBRE", valor: 80, ruta: "x.ts" },
    ]);
  });
});

describe("fuente única: un número a mano en un archivo que tiene la constante a mano", () => {
  it.each([
    ["max de un esquema", "z.string().max(80)"],
    ["min de un esquema", "z.string().min(80)"],
    ["largo comparado (mayor)", "if (t.length > 80) throw new Error('x')"],
    ["largo comparado (a la derecha)", "if (80 < t.length) throw new Error('x')"],
    ["largo comparado (igualdad)", "if (t.length === 80) throw new Error('x')"],
    ["cantidad máxima de una expresión regular", "const R = /^[a-z]{1,80}$/;"],
    ["cantidad exacta de una expresión regular", "const R = /^[a-z]{80}$/;"],
  ])("%s", (_, uso) => {
    const dueno = `${DUENA}export const usa = () => LARGO_MAXIMO_DEL_NOMBRE;\n`;
    expect(cuenta({ "src/a.ts": `${dueno}${uso}\n` })).toEqual({ "src/a.ts": 1 });
  });

  it("también cuando solo la importa", () => {
    expect(
      cuenta({
        "src/a.ts": DUENA,
        "src/b.ts":
          'import { LARGO_MAXIMO_DEL_NOMBRE } from "./a";\nexport const x = LARGO_MAXIMO_DEL_NOMBRE;\nz.string().max(80);\n',
      }),
    ).toEqual({ "src/b.ts": 1 });
  });

  it("no cuenta usar la constante, otro número ni un número sin ninguna constante a la vista", () => {
    expect(
      cuenta({
        "src/a.ts": `${DUENA}z.string().max(LARGO_MAXIMO_DEL_NOMBRE);\nz.string().max(40);\n`,
      }),
    ).toEqual({});
    expect(cuenta({ "src/a.ts": DUENA, "src/b.ts": "z.string().max(80);\n" })).toEqual({});
    expect(cuenta({ "src/a.ts": `${DUENA}const dias = 80;\n` })).toEqual({});
  });

  it("cuenta cada repetición por separado", () => {
    expect(cuenta({ "src/a.ts": `${DUENA}z.string().max(80);\nz.string().min(80);\n` })).toEqual({
      "src/a.ts": 2,
    });
  });
});
