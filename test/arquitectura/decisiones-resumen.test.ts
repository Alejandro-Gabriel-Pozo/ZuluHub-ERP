import { describe, expect, it } from "vitest";
import { entrada, resumen } from "./decisiones-apoyo";

/**
 * `npm run decisiones` (`arquitectura/decisiones/resumen.cjs`): lo que el dueño lee. Previene: decisiones pendientes que nadie tiene en un solo
 * lugar, o un resumen con jerga o con una lista a medias.
 */
describe("el resumen para el dueño", () => {
  it("sin pendientes lo dice", () => {
    expect(resumen.resumir([])).toBe("No hay decisiones pendientes de tu OK.\n");
    expect(
      resumen.resumir([
        entrada({ estado: "CONFIRMADA" }),
        entrada({ id: "DEC-0002", estado: "CORREGIDA" }),
      ]),
    ).toBe("No hay decisiones pendientes de tu OK.\n");
  });

  it("agrupa por tipo en español de negocio y una línea por decisión: qué, quién, qué cambia y dónde", () => {
    const texto = resumen.resumir([
      entrada({
        id: "DEC-0003",
        tipo: "DINERO",
        quien: "padre",
        decision: "La merma se suma al neto.",
        donde: "e6 §4",
      }),
      entrada({ id: "DEC-0001" }),
      entrada({ id: "DEC-0002", tipo: "COMERCIAL", quien: "dueño" }),
    ]);
    expect(texto.split("\n")[0]).toBe("Decisiones que esperan tu OK: 3.");
    expect(texto.indexOf("Dinero (1)")).toBeLessThan(
      texto.indexOf("Permisos (quién puede qué) (1)"),
    );
    expect(texto.indexOf("Permisos (quién puede qué) (1)")).toBeLessThan(
      texto.indexOf("Lo comercial (planes y extras) (1)"),
    );
    const lineaDeDinero = texto.split("\n").find((l) => l.startsWith("- DEC-0003")) ?? "";
    expect(lineaDeDinero).toBe(
      "- DEC-0003 · La merma se suma al neto. Lo decidió la sesión padre el 2026-11-11. Si se corrige: El operador deja de ver el costo de cada producto. Dónde: e6 §4.",
    );
    expect(texto).toContain("Lo decidió el dueño");
    expect(texto).toContain("Lo decidió una sesión de código");
  });

  it("no lista las ya confirmadas o corregidas ni las SIN_DECISION", () => {
    const texto = resumen.resumir([
      entrada({ id: "DEC-0001", estado: "CONFIRMADA" }),
      entrada({ id: "DEC-0002", estado: "CORREGIDA" }),
      entrada({
        id: "DEC-0003",
        tipo: "SIN_DECISION",
        motivo: "Cambio técnico sin efecto en el negocio.",
      }),
      entrada({ id: "DEC-0004" }),
    ]);
    expect(texto).toContain("Decisiones que esperan tu OK: 1.");
    expect(texto).toContain("DEC-0004");
    for (const id of ["DEC-0001", "DEC-0002", "DEC-0003"]) expect(texto).not.toContain(id);
  });

  it("todos los tipos de negocio tienen título", () => {
    const tipos = ["DINERO", "PERMISOS", "CLIENTE", "DATOS", "COMERCIAL", "INFRAESTRUCTURA"];
    const texto = resumen.resumir(tipos.map((tipo, i) => entrada({ id: `DEC-000${i + 1}`, tipo })));
    for (const titulo of [
      "Dinero",
      "Permisos",
      "Lo que ve o hace el cliente",
      "Datos",
      "Lo comercial",
      "Infraestructura",
    ]) {
      expect(texto).toContain(titulo);
    }
    expect(texto).not.toContain("undefined");
  });
});
