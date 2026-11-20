import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CodeQL cancela el análisis de un commit que otro posterior reemplaza (pull request y push a `main`) y NUNCA cancela el semanal. Previene: un análisis
 * completo por cada push a un PR compitiendo con el CI por las mismas ~40 máquinas (63 corridas de PR para 43 ramas, 13-15/11/2026) y, en el otro sentido,
 * que una cancelación mal escrita deje sin análisis la corrida semanal de la rama principal.
 */
const RAIZ = join(import.meta.dirname, "../..");
const GRUPO =
  "codeql-${{ github.event_name }}-${{ github.event_name == 'schedule' && github.sha || github.ref }}";
const CANCELAR = "${{ github.event_name != 'schedule' }}";

/** Los valores de `group` y `cancel-in-progress` del bloque `concurrency:` de primer nivel (undefined si no hay). */
function leer(texto: string): { grupo?: string | undefined; cancelar?: string | undefined } {
  const lineas = texto.split("\n");
  const inicio = lineas.findIndex((l) => /^concurrency:\s*$/.test(l));
  if (inicio < 0) return {};
  const bloque: string[] = [];
  for (const l of lineas.slice(inicio + 1)) {
    if (!/^ {2}\S/.test(l)) break;
    bloque.push(l.trim());
  }
  const campo = (n: string) =>
    bloque
      .find((l) => l.startsWith(`${n}:`))
      ?.slice(n.length + 1)
      .trim();
  return { grupo: campo("group"), cancelar: campo("cancel-in-progress") };
}

describe("codeql.yml: cancela lo reemplazado y nunca la corrida semanal", () => {
  const real = readFileSync(join(RAIZ, ".github/workflows/codeql.yml"), "utf8");

  it("el archivo real tiene el grupo y la cancelación esperados", () => {
    expect(leer(real)).toEqual({ grupo: GRUPO, cancelar: CANCELAR });
  });

  it("el análisis semanal tiene grupo propio por SHA y no cancela (la expresión lo expresa)", () => {
    expect(GRUPO).toContain("github.event_name == 'schedule' && github.sha");
    expect(CANCELAR).toContain("!= 'schedule'");
  });

  it("violación inyectada: sin bloque, con cancelación incondicional o con un grupo sin el SHA de la semanal, no cumple", () => {
    expect(leer(real.replace(/concurrency:[\s\S]*?\njobs:/, "jobs:"))).toEqual({});
    expect(leer(real.replace(CANCELAR, "true")).cancelar).not.toBe(CANCELAR);
    expect(leer(real.replace("github.sha || github.ref", "github.ref")).grupo).not.toBe(GRUPO);
  });

  it("no toca nada más: los disparadores y el permiso mínimo siguen", () => {
    expect(real).toContain("push:\n    branches: [main]");
    expect(real).toContain("pull_request:");
    expect(real).toContain('cron: "17 5 * * 1"');
    expect(real).toContain("security-events: write");
  });
});
