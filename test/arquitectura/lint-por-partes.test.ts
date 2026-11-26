import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `npm run lint` corre eslint en DOS invocaciones (`src` y todo lo demás), cada una con su propio heap: con el árbol completo en una sola, el job «Estático» del CI
 * murió por falta de memoria («Ineffective mark-compacts near heap limit», #635, 26/11/2026; pico medido 9,3 GB contra un tope de 6 GB). Esta prueba falla si al partir
 * se deja una carpeta sin lint (toda carpeta ignorada en una invocación tiene que ser el objetivo de otra y alguna invocación tiene que cubrir `.`) o si el tope de
 * heap supera lo que entra en el runner (ubuntu-latest: 16 GB; sumado a lo que no es heap, más de 12 GB no entra). Una invocación corre después de la otra, nunca a la vez.
 * LÍMITE: lee el texto del script; no corre eslint (eso lo hace el CI y `npm run previo`).
 */
const TOPE_MAXIMO_DE_HEAP_MB = 12288;

interface Invocacion {
  objetivos: string[];
  ignorados: string[];
  heapMb: number | null;
}

/** Las invocaciones de eslint de un script (separadas por `&&`) o un error si no entiende una. */
function invocaciones(script: string): Invocacion[] {
  return script.split("&&").map((tramo) => {
    const t = tramo.trim();
    if (!t.includes("eslint/bin/eslint.js")) throw new Error(`tramo que no es eslint: «${t}»`);
    const heap = /--max-old-space-size=(\d+)/.exec(t);
    const ignorados = [...t.matchAll(/--ignore-pattern\s+"?([^"\s]+)"?/g)].map((m) => m[1] ?? "");
    const objetivos = t
      .replace(/.*eslint\/bin\/eslint\.js/, "")
      .replace(/--ignore-pattern\s+"?[^"\s]+"?/g, "")
      .split(/\s+/)
      .filter((x) => x !== "");
    return { objetivos, ignorados, heapMb: heap === null ? null : Number(heap[1]) };
  });
}

/** Lo que está mal en la forma en que `lint` cubre el árbol. Vacío = bien. */
function problemas(script: string): string[] {
  const salida: string[] = [];
  const todas = invocaciones(script);
  if (!todas.some((i) => i.objetivos.includes("."))) {
    salida.push("ninguna invocación cubre `.`: lo que no nombra una carpeta queda sin lint");
  }
  for (const i of todas) {
    for (const patron of i.ignorados) {
      const carpeta = patron.replace(/\/\*\*$/, "");
      const otra = todas.some((o) => o !== i && o.objetivos.includes(carpeta));
      if (!otra) salida.push(`se ignora «${patron}» y ninguna otra invocación lo lintea`);
    }
    if (i.heapMb === null || i.heapMb > TOPE_MAXIMO_DE_HEAP_MB) {
      salida.push(`el tope de heap tiene que ser un número de hasta ${TOPE_MAXIMO_DE_HEAP_MB} MB`);
    }
  }
  return salida;
}

const SCRIPT_REAL = (
  JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts["lint"] as string;

const UNA = "node --max-old-space-size=8192 node_modules/eslint/bin/eslint.js";

describe("npm run lint partido en invocaciones", () => {
  it("el script real cubre todo el árbol y respeta el tope de heap", () => {
    expect(problemas(SCRIPT_REAL)).toEqual([]);
    expect(invocaciones(SCRIPT_REAL).length).toBeGreaterThan(1);
  });

  it("violación inyectada: una carpeta ignorada que nadie lintea", () => {
    expect(problemas(`${UNA} src && ${UNA} . --ignore-pattern "scripts/**"`)).toEqual([
      "se ignora «scripts/**» y ninguna otra invocación lo lintea",
    ]);
  });

  it("violación inyectada: solo se lintea una carpeta y no `.`", () => {
    expect(problemas(`${UNA} src`)).toEqual([
      "ninguna invocación cubre `.`: lo que no nombra una carpeta queda sin lint",
    ]);
  });

  it("violación inyectada: un tope de heap que no entra en el runner", () => {
    const grande = `${UNA.replace("8192", "20000")} .`;
    expect(problemas(grande)).toEqual([
      `el tope de heap tiene que ser un número de hasta ${TOPE_MAXIMO_DE_HEAP_MB} MB`,
    ]);
  });

  it("violación inyectada: sin tope de heap", () => {
    expect(problemas("node node_modules/eslint/bin/eslint.js .")).toEqual([
      `el tope de heap tiene que ser un número de hasta ${TOPE_MAXIMO_DE_HEAP_MB} MB`,
    ]);
  });

  it("el script partido bien formado no tiene problemas", () => {
    expect(problemas(`${UNA} src && ${UNA} . --ignore-pattern "src/**"`)).toEqual([]);
  });
});
