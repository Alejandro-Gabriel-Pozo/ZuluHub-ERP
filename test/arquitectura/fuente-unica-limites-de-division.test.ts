import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RUTA_DE_LOS_LIMITES_DE_DIVISION,
  topesDeDivisionEscritos,
  valoresDeLosLimitesDeDivision,
} from "./fuente-unica-apoyo";

/**
 * REGLA (CLAUDE.md «Una regla, un lugar»; decisión del dueño del 14/11/2026): los límites de dividir la cuenta (10 cuentas por ítems, 12 partes por
 * porcentaje) viven UNA vez, en `src/primitivas/cuentas/limites-de-division.ts`; dominio, pantalla y pruebas la importan. Esta prueba falla si el número
 * se vuelve a escribir a mano junto a algo que diga parte o cuenta, o si la constante se declara de nuevo, en cualquier archivo de `src` o `apps`
 * (las pruebas `*.test.*` incluidas: usan la constante). Qué se ve y qué no: ver `topesDeDivisionEscritos` en `fuente-unica-apoyo.ts`.
 * Previene: el tope escrito en dos lugares que se desfasa (caso real: 4 y 6 de maquetas repetidos en dominio, pruebas y base).
 * Violación inyectada de cada forma: abajo; el espejo pedido por «una regla nueva» también está en `reglas.test.ts`.
 */

const RAIZ = join(import.meta.dirname, "../..");

function codigo(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const carpeta of ["src", "apps"]) {
    for (const r of readdirSync(join(RAIZ, carpeta), { recursive: true, encoding: "utf8" })) {
      if (r.split("/").some((p) => p === "node_modules" || p === ".next")) continue;
      if (!/\.(tsx?|mts|cts)$/.test(r) || r.endsWith(".d.ts")) continue;
      mapa.set(`${carpeta}/${r}`, readFileSync(join(RAIZ, carpeta, r), "utf8"));
    }
  }
  return mapa;
}

const FUENTE = `export const MAXIMO_DE_CUENTAS_POR_ITEMS = 10;\nexport const MAXIMO_DE_PARTES_POR_PORCENTAJE = 12;\n`;
const conFuente = (ruta: string, texto: string) =>
  new Map([
    [RUTA_DE_LOS_LIMITES_DE_DIVISION, FUENTE],
    [ruta, texto],
  ]);

describe("límites de dividir: el código real", () => {
  const archivos = codigo();
  it("la fuente única existe con sus dos valores (la regla no pasa en vacío)", () => {
    expect(valoresDeLosLimitesDeDivision(archivos).sort((a, b) => a - b)).toEqual([10, 12]);
  });
  it("ningún archivo vuelve a escribir los topes", () => {
    expect(topesDeDivisionEscritos(archivos)).toEqual([]);
  });
  it("la regla está escrita en CLAUDE.md (quitarla hace fallar la prueba)", () => {
    expect(readFileSync(join(RAIZ, "CLAUDE.md"), "utf8")).toContain(
      "fuente-unica-limites-de-division.test.ts",
    );
  });
});

describe("límites de dividir: violación inyectada de cada forma", () => {
  it.each([
    ["comparación con partes (mayor)", "if (partes > 10) throw new Error('x');"],
    ["comparación con partes (a la derecha)", "if (12 < partes) throw new Error('x');"],
    ["comparación con cuentas.length", "if (cuentas.length <= 10) return;"],
    ["igualdad con parte", "const llena = parte === 12;"],
    ["max de un esquema de partes", "const e = { partes: z.number().int().max(12) };"],
    ["min de un esquema de cuentas", "const e = { cuentas: z.number().min(10) };"],
    ["la constante declarada de nuevo", "const MAXIMO_DE_CUENTAS_POR_ITEMS = 4;"],
    ["la constante exportada con otro nombre de partes", "export const MAXIMO_DE_PARTES_X = 7;"],
  ])("%s", (_, uso) => {
    expect(topesDeDivisionEscritos(conFuente("apps/web/x.ts", `${uso}\n`))).toEqual([
      "apps/web/x.ts:1",
    ]);
  });

  it("cuenta también una prueba (*.test.ts) y da la línea exacta", () => {
    expect(
      topesDeDivisionEscritos(
        conFuente(
          "src/a.test.ts",
          "const a = 1;\nexpect(partes).toBe(1);\nif (partes > 12) x();\n",
        ),
      ),
    ).toEqual(["src/a.test.ts:3"]);
  });

  it("no cuenta lo correcto: importar la constante, un número sin relación, la propia fuente", () => {
    expect(
      topesDeDivisionEscritos(
        conFuente(
          "src/b.ts",
          [
            "import { MAXIMO_DE_CUENTAS_POR_ITEMS } from './x';",
            "if (partes > MAXIMO_DE_CUENTAS_POR_ITEMS) throw new Error('x');",
            "if (total > 10) return;",
            "const e = { importe: z.number().max(12) };",
            "if (partes > 3) return;",
          ].join("\n"),
        ),
      ),
    ).toEqual([]);
    expect(topesDeDivisionEscritos(new Map([[RUTA_DE_LOS_LIMITES_DE_DIVISION, FUENTE]]))).toEqual(
      [],
    );
  });

  it("una marca de valor ajeno con motivo exime a esa línea; sin motivo, no", () => {
    const con =
      "// fuente-unica: ajeno — son 10 sillas por mesa, otro dato que el tope\nif (cuentas > 10) x();";
    expect(topesDeDivisionEscritos(conFuente("src/c.ts", con))).toEqual([]);
    const sin = "// fuente-unica: ajeno\nif (cuentas > 10) x();";
    expect(topesDeDivisionEscritos(conFuente("src/c.ts", sin))).toEqual(["src/c.ts:2"]);
  });

  it("sin la fuente no hay valores y la regla real lo detecta", () => {
    expect(valoresDeLosLimitesDeDivision(new Map())).toEqual([]);
  });
});
