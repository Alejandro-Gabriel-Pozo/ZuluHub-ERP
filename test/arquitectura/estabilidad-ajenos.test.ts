import { execFileSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Estabilidad (la integración repetida) no corre por un cambio que solo toca archivos que la integración no lee
 * (`arquitectura/ajenos-a-la-integracion.json`); todo lo demás sigue corriendo (fail-closed). Previene gastar ~50 min de máquina por PR en cambios
 * de decisiones o de datos de la mutación. Cada caso es una violación inyectada: quitar la lista, ampliarla de más o aflojar el fail-closed falla.
 */

const require = createRequire(import.meta.url);
const { planificarEstabilidad } = require("../../arquitectura/planificar-mutacion.cjs") as {
  planificarEstabilidad: (e: { cambios: string[]; dependencias: Record<string, string[]> }) => {
    corre: boolean;
    motivo: string;
  };
};
const AJENOS = require("../../arquitectura/ajenos-a-la-integracion.json") as string[];

const RAIZ = join(import.meta.dirname, "../..");
const DEPENDENCIAS: Record<string, string[]> = {
  "src/a/dominio/a.ts": [],
  "test/integracion/x.test.ts": ["src/a/dominio/a.ts"],
};
const corre = (...cambios: string[]) =>
  planificarEstabilidad({ cambios, dependencias: DEPENDENCIAS }).corre;

describe("lo que la integración no lee no dispara Estabilidad", () => {
  it.each([
    "arquitectura/decisiones/cuota.json",
    "arquitectura/decisiones/archivos-sensibles.json",
    "arquitectura/decisiones/registro/DEC-0001.json",
    "arquitectura/mutacion/algun-grupo.json",
    "arquitectura/paridad/copias.json",
    ".github/CODEOWNERS",
    ".gitignore",
  ])("un PR que solo cambia %s no la repite", (archivo) => {
    expect(corre(archivo)).toBe(false);
  });

  it("la lista declarada es exactamente la que se prueba arriba (agregar un ajeno obliga a agregar su caso)", () => {
    expect([...AJENOS].sort()).toEqual(
      [
        "arquitectura/decisiones/**",
        "arquitectura/mutacion/*.json",
        "arquitectura/paridad/**",
        ".github/CODEOWNERS",
        ".gitignore",
      ].sort(),
    );
  });

  it.each([
    ["migraciones/0099_x.sql", "una migración"],
    ["test/integracion/x.test.ts", "una prueba de integración"],
    [".github/workflows/ci.yml", "el workflow"],
    ["package.json", "la configuración (la lee la integración)"],
    ["arquitectura/lint-sql.cjs", "las reglas SQL"],
    [
      "arquitectura/mutacion/sub/otro.json",
      "un JSON en una subcarpeta de mutacion (`*` no cruza carpetas)",
    ],
    ["arquitectura/mutacion/cosa.cjs", "código dentro de mutacion (la lista es de .json)"],
    ["arquitectura/algo-nuevo.json", "un archivo de arquitectura que nadie declaró"],
    [".gitignore.bak", "un nombre parecido"],
    ["src/b/dominio/borrado.ts", "un archivo que el grafo no explica"],
  ])("sigue corriendo ante %s (%s)", (archivo) => {
    expect(corre(archivo)).toBe(true);
  });

  it("un ajeno junto a algo que SÍ la dispara corre (nunca se saltea por mezcla)", () => {
    expect(corre("arquitectura/decisiones/cuota.json", "migraciones/0099_x.sql")).toBe(true);
    expect(corre(".gitignore", "src/b/dominio/borrado.ts")).toBe(true);
  });

  it("ningún ajeno es una ruta que la integración use: no entra nada de test/integracion, migraciones, src ni scripts", () => {
    for (const glob of AJENOS) {
      expect(glob, glob).toMatch(/^(arquitectura\/|\.github\/CODEOWNERS$|\.gitignore$)/);
    }
  });

  it("cada ajeno apunta a algo que existe en el repositorio (la lista no acumula rutas muertas)", () => {
    const rastreados = execFileSync("git", ["ls-files"], { cwd: RAIZ, encoding: "utf8" }).split(
      "\n",
    );
    for (const glob of AJENOS) {
      const coincide = rastreados.some((archivo) => posix.matchesGlob(archivo, glob));
      expect(coincide, glob).toBe(true);
    }
  });

  it("la integración (código de test/integracion, sin comentarios) no nombra ninguna de esas rutas", () => {
    const nombres = [
      "arquitectura/decisiones",
      "arquitectura/mutacion",
      "arquitectura/paridad",
      "CODEOWNERS",
      ".gitignore",
    ];
    for (const archivo of globSync("test/integracion/**/*.ts", { cwd: RAIZ })) {
      const codigo = readFileSync(join(RAIZ, archivo), "utf8")
        .split("\n")
        .filter((linea) => !/^\s*(\/\/|\/?\*)/.test(linea))
        .join("\n");
      for (const nombre of nombres)
        expect(codigo.includes(nombre), `${archivo}: ${nombre}`).toBe(false);
    }
  });
});
