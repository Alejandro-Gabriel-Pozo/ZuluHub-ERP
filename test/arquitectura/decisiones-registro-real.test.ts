import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El registro REAL del repositorio cumple su propio control (sin base): todo SUPUESTO del código, del SQL y de las pruebas cita una decisión
 * registrada y la forma es válida. Es la misma corrida que `npm run decisiones:verificar` del gate; acá falla en `npm test` con el mensaje que
 * dice qué entrada falta. (Corre sobre las fuentes del repo: no entra a ningún grupo de mutación.)
 */
const RAIZ = join(import.meta.dirname, "../..");

describe("el registro de decisiones del repositorio", () => {
  it("el control sale 0", () => {
    const corrida = spawnSync(process.execPath, ["arquitectura/decisiones/decisiones.cjs"], {
      cwd: RAIZ,
      encoding: "utf8",
    });
    expect(corrida.stdout).toContain("Registro de decisiones: 0 fallas");
    expect(corrida.status).toBe(0);
  });

  it("el resumen del dueño se imprime", () => {
    const corrida = spawnSync(process.execPath, ["arquitectura/decisiones/resumen.cjs"], {
      cwd: RAIZ,
      encoding: "utf8",
    });
    expect(corrida.status).toBe(0);
    expect(corrida.stdout).toMatch(
      /Decisiones que esperan tu OK: \d+\.|No hay decisiones pendientes/,
    );
  });
});
