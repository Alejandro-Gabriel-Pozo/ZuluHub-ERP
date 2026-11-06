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

describe("fuente única: el límite de una primitiva escrito en otro lado (revisión independiente, PR 2 de C1)", () => {
  const PRIMITIVA = "export const LARGO_MAXIMO_DEL_EMAIL_DE_CONTACTO = 254;\n";

  it.each([
    ["max sin nombrar la constante", "z.string().max(254)"],
    ["min", "z.string().min(254)"],
    ["length(N)", "z.string().length(254)"],
    ["slice(0, N)", "t.slice(0, 254)"],
    ["substring(0, N)", "t.substring(0, 254)"],
    ["maxLength en JSX", "const x = <input maxLength={254} />;"],
    ["maxLength en un objeto", "const x = { maxLength: 254 };"],
    ["largo comparado", "if (t.length > 254) throw new Error('x');"],
    ["cantidad máxima de una expresión regular", "const R = /^[a-z]{1,254}$/;"],
  ])("%s, en un archivo que no nombra la constante", (_, uso) => {
    expect(
      cuenta({ "src/primitivas/contacto/email.ts": PRIMITIVA, "apps/web/p.tsx": `${uso}\n` }),
    ).toEqual({
      "apps/web/p.tsx": 1,
    });
  });

  it("una constante PRIVADA con otro nombre y el mismo valor, fuera de la primitiva, cuenta", () => {
    for (const declaracion of [
      "const LARGO_MAXIMO_DEL_CORREO = 254;",
      "export const LARGO_MAXIMO_DEL_CORREO = 254;",
      "const LONGITUD_DEL_MAIL = 254;",
      "const largoMaximoDelCorreo = 254;",
    ]) {
      expect(
        cuenta({
          "src/primitivas/contacto/email.ts": PRIMITIVA,
          "src/plataforma/f.ts": `${declaracion}\n`,
        }),
        declaracion,
      ).toEqual({ "src/plataforma/f.ts": 1 });
    }
  });

  it("no cuenta la primitiva misma, otros valores, otros nombres ni una constante que no es un largo", () => {
    expect(cuenta({ "src/primitivas/contacto/email.ts": PRIMITIVA })).toEqual({});
    expect(
      cuenta({
        "src/primitivas/contacto/email.ts": PRIMITIVA,
        "src/f.ts": "const LARGO_MAXIMO_X = 255;\nz.string().max(255);\n",
      }),
    ).toEqual({});
    expect(
      cuenta({
        "src/primitivas/contacto/email.ts": PRIMITIVA,
        "src/f.ts": "const LADO_MAXIMO = 254;\nconst PUERTO = 254;\n",
      }),
    ).toEqual({});
  });

  it("una constante duplicada exacta se cuenta una sola vez", () => {
    expect(
      cuenta({
        "src/primitivas/contacto/email.ts": PRIMITIVA,
        "src/f.ts": PRIMITIVA,
      }),
    ).toEqual({ "src/f.ts": 1 });
  });

  it("la dueña es la primitiva aunque esté en otra carpeta que la copia", () => {
    expect(
      cuenta({ "src/a/f.ts": PRIMITIVA, "src/primitivas/contacto/email.ts": PRIMITIVA }),
    ).toEqual({
      "src/a/f.ts": 1,
    });
  });
});
