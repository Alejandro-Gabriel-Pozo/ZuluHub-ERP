import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

  it("la cuota del dueño (11/11/2026) es 5 de negocio y 10 técnicas desde el 14/11/2026, con las excepciones del dueño", () => {
    const cuota: unknown = JSON.parse(
      readFileSync(join(RAIZ, "arquitectura/decisiones/cuota.json"), "utf8"),
    );
    expect(cuota).toEqual({
      vigente_desde: "2026-11-14",
      negocio: 5,
      tecnicas: 10,
      // #371 (Compras N3/N4): el dueño exceptuó las 8 decisiones de negocio del PR (16/11/2026, «A para la cuota de #371»).
      excepciones: [700, 705, 707, 708, 710, 711, 712, 713].map((n) => ({
        id: `DEC-${String(n).padStart(4, "0")}`,
        fecha: "2026-11-16",
        fuente:
          "Mensaje del dueño en el chat del orquestador, 16/11/2026: «A para la cuota de #371», opción A (excepción para este PR) frente a B (partir el PR)",
      })),
    });
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
