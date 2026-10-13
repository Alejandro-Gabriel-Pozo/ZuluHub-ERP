import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * El Gate es el chequeo requerido de `main`: «saltado por filtro» es correcto, «fallido»,
 * «cancelado» o «saltado porque otro job cayó» no lo es.
 */

type Needs = Record<string, { result: string; outputs?: Record<string, string> }>;
const require = createRequire(import.meta.url);
const { evaluarGate } = require("../../arquitectura/evaluar-gate.cjs") as {
  evaluarGate: (needs: Needs) => string[];
};

const VERDE: Needs = {
  estatico: { result: "success" },
  pruebas: { result: "success" },
  seguridad: { result: "success" },
  flujos: { result: "success" },
  web: { result: "success" },
  componentes: { result: "success" },
  dependencias: { result: "success" },
  estabilidad: { result: "success" },
  "mutacion-plan": { result: "success", outputs: { hay: "true" } },
  mutacion: { result: "success" },
};
const con = (cambios: Needs): Needs => ({ ...VERDE, ...cambios });

describe("Gate: veredicto sobre los jobs", () => {
  it("todo en verde pasa", () => {
    expect(evaluarGate(VERDE)).toEqual([]);
  });

  it("en push a main, dependencias y estabilidad saltados pasan", () => {
    const push = con({ dependencias: { result: "skipped" }, estabilidad: { result: "skipped" } });
    expect(evaluarGate(push)).toEqual([]);
  });

  it("mutación saltada porque el plan no encontró grupos que correr pasa", () => {
    const filtrado = con({
      "mutacion-plan": { result: "success", outputs: { hay: "false" } },
      mutacion: { result: "skipped" },
    });
    expect(evaluarGate(filtrado)).toEqual([]);
  });

  it.each(["failure", "cancelled", "skipped"])("mutación %s con grupos por correr falla", (r) => {
    expect(evaluarGate(con({ mutacion: { result: r } }))).toEqual([`mutacion: ${r}`]);
  });

  it.each(["failure", "cancelled"])(
    "mutación %s cuando el plan decía «no hay grupos» falla",
    (r) => {
      const rojo = con({
        "mutacion-plan": { result: "success", outputs: { hay: "false" } },
        mutacion: { result: r },
      });
      expect(evaluarGate(rojo)).toEqual([`mutacion: ${r}`]);
    },
  );

  it("si el plan cayó, la mutación saltada no se toma por «filtrada»", () => {
    const sinPlan = con({
      "mutacion-plan": { result: "failure", outputs: { hay: "false" } },
      mutacion: { result: "skipped" },
    });
    expect(evaluarGate(sinPlan)).toEqual(["mutacion-plan: failure", "mutacion: skipped"]);
  });

  it.each(["estatico", "pruebas", "seguridad", "flujos", "web", "componentes"])(
    "%s fallido o saltado falla",
    (job) => {
      expect(evaluarGate(con({ [job]: { result: "failure" } }))).toEqual([`${job}: failure`]);
      expect(evaluarGate(con({ [job]: { result: "skipped" } }))).toEqual([`${job}: skipped`]);
    },
  );

  it.each(["dependencias", "estabilidad"])("%s fallido o cancelado falla", (job) => {
    expect(evaluarGate(con({ [job]: { result: "failure" } }))).toEqual([`${job}: failure`]);
    expect(evaluarGate(con({ [job]: { result: "cancelled" } }))).toEqual([`${job}: cancelled`]);
  });

  it("un job que falta en `needs` cuenta como fallo", () => {
    const sinPruebas = Object.fromEntries(
      Object.entries(VERDE).filter(([job]) => job !== "pruebas"),
    );
    expect(evaluarGate(sinPruebas)).toEqual(["pruebas: ausente"]);
  });
});
