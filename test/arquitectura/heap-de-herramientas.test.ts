import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `typecheck` y `lint` corren con un heap explícito. Hecho real (CI del PR #331, 15/11/2026): `eslint .` con el heap por defecto de Node murió con «JavaScript heap out of memory»
 * (exit 134): el lint con tipos de todo el repositorio necesita entre 3 y 4 GB (medido sobre main: con 2 GB y con 3 GB falla, con 4 GB pasa), y `tsc` pasa de 2 GB. El heap por defecto
 * depende de la memoria de la máquina, así que un PR que sumaba pocos archivos rompía el Estático de todos. Falla que previene: volver al heap por defecto (quitar la bandera) sin que nadie lo note.
 * Desde el 26/11/2026 el lint corre en DOS invocaciones (`src` y el resto; #638: con el árbol completo en una sola el pico medido era 9,3 GB y el job «Estático» se quedaba sin memoria): cada una fija su heap
 * y no se puede borrar ninguna (la cobertura de carpetas la cuida `lint-por-partes.test.ts`). El heap de cada una tiene que entrar en el runner (16 GB): a lo sumo 12288 MB.
 * Sin dependencia nueva (nada de `cross-env`): la bandera va como argumento de `node`.
 */

const MINIMO_DE_MB = 6144;
const MAXIMO_DE_MB = 12288;
const INVOCACIONES_DE_LINT = 2;

function heapDeCadaInvocacion(
  script: string,
  herramienta: "eslint.js" | "tsc",
): readonly (number | null)[] {
  return script
    .split("&&")
    .map((paso) => paso.trim())
    .filter((paso) => paso.includes(herramienta))
    .map((paso) => {
      const m = /^node --max-old-space-size=(\d+) /.exec(paso);
      return m === null ? null : Number(m[1]);
    });
}

const scripts = (
  JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

describe("heap de las herramientas de la verificación estática", () => {
  it("el lint y las tres comprobaciones de tipos fijan el heap, cada una, en al menos 6 GB", () => {
    const lint = heapDeCadaInvocacion(scripts["lint"] ?? "", "eslint.js");
    const tipos = heapDeCadaInvocacion(scripts["typecheck"] ?? "", "tsc");
    expect(lint).toHaveLength(INVOCACIONES_DE_LINT);
    expect(tipos).toHaveLength(3);
    for (const heap of [...lint, ...tipos]) expect(heap).toBeGreaterThanOrEqual(MINIMO_DE_MB);
    for (const heap of [...lint, ...tipos]) expect(heap).toBeLessThanOrEqual(MAXIMO_DE_MB);
  });

  it("violación inyectada: un script sin la bandera, con una más baja o sin una de sus invocaciones, se detecta", () => {
    expect(heapDeCadaInvocacion("eslint .", "eslint.js")).toEqual([]);
    expect(heapDeCadaInvocacion("node node_modules/eslint/bin/eslint.js .", "eslint.js")).toEqual([
      null,
    ]);
    expect(
      heapDeCadaInvocacion(
        "node --max-old-space-size=2048 node_modules/eslint/bin/eslint.js .",
        "eslint.js",
      ),
    ).toEqual([2048]);
    expect(
      heapDeCadaInvocacion(
        "node --max-old-space-size=6144 node_modules/typescript/bin/tsc --noEmit && tsc --noEmit -p a",
        "tsc",
      ),
    ).toEqual([6144, null]);
  });
});
