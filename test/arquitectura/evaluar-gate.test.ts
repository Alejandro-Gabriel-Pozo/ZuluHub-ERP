import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * El Gate es el chequeo requerido de `main`: «saltado por filtro» es correcto, «fallido»,
 * «cancelado» o «saltado porque otro job cayó» no lo es.
 */

type Needs = Record<string, { result: string; outputs?: Record<string, string> }>;
const require = createRequire(import.meta.url);
const { evaluarGate } = require("../../arquitectura/evaluar-gate.cjs") as {
  evaluarGate: (needs: Needs, evento?: string) => string[];
};

const VERDE: Needs = {
  estatico: { result: "success" },
  guardian: { result: "success" },
  pruebas: { result: "success" },
  seguridad: { result: "success" },
  flujos: { result: "success" },
  web: { result: "success" },
  componentes: { result: "success" },
  dependencias: { result: "success" },
  estabilidad: { result: "success" },
  "mutacion-plan": { result: "success", outputs: { hay: "true", estabilidad: "true" } },
  mutacion: { result: "success" },
};
const con = (cambios: Needs): Needs => ({ ...VERDE, ...cambios });
/** El plan terminó bien y dijo que la integración repetida no hace falta. */
const SIN_ESTABILIDAD: Needs = {
  "mutacion-plan": { result: "success", outputs: { hay: "true", estabilidad: "false" } },
  estabilidad: { result: "skipped" },
};

describe("Gate: veredicto sobre los jobs", () => {
  it("todo en verde pasa", () => {
    expect(evaluarGate(VERDE)).toEqual([]);
  });

  it("en push a main, dependencias saltado pasa", () => {
    expect(evaluarGate(con({ dependencias: { result: "skipped" } }), "push")).toEqual([]);
  });

  it.each(["push", "schedule", "pull_request"])("estabilidad en verde pasa en %s", (evento) => {
    expect(evaluarGate(VERDE, evento)).toEqual([]);
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

  it.each(["estatico", "guardian", "pruebas", "seguridad", "flujos", "web", "componentes"])(
    "%s fallido o saltado falla",
    (job) => {
      expect(evaluarGate(con({ [job]: { result: "failure" } }))).toEqual([`${job}: failure`]);
      expect(evaluarGate(con({ [job]: { result: "skipped" } }))).toEqual([`${job}: skipped`]);
    },
  );

  it.each(["dependencias", "estabilidad"])("%s fallido o cancelado falla", (job) => {
    expect(evaluarGate(con({ [job]: { result: "failure" } }), "pull_request")).toEqual([
      `${job}: failure`,
    ]);
    expect(evaluarGate(con({ [job]: { result: "cancelled" } }), "pull_request")).toEqual([
      `${job}: cancelled`,
    ]);
  });

  it("el guardián cancelado también falla (no cuenta como verde)", () => {
    expect(evaluarGate(con({ guardian: { result: "cancelled" } }))).toEqual([
      "guardian: cancelled",
    ]);
  });

  it("un job que falta en `needs` cuenta como fallo", () => {
    const sinPruebas = Object.fromEntries(
      Object.entries(VERDE).filter(([job]) => job !== "pruebas"),
    );
    expect(evaluarGate(sinPruebas)).toEqual(["pruebas: ausente"]);
  });

  it("el guardián ausente de `needs` cuenta como fallo (quitarlo del Gate no lo deja pasar)", () => {
    const sinGuardian = Object.fromEntries(
      Object.entries(VERDE).filter(([job]) => job !== "guardian"),
    );
    expect(evaluarGate(sinGuardian)).toEqual(["guardian: ausente"]);
  });
});

describe("Gate: estabilidad (la integración repetida 12 veces)", () => {
  it("en un pull request, saltada porque el plan dijo «no hace falta» pasa", () => {
    expect(evaluarGate(con(SIN_ESTABILIDAD), "pull_request")).toEqual([]);
  });

  it.each(["push", "schedule", "workflow_dispatch", "", undefined])(
    "con el evento «%s» NO se acepta saltada, ni siquiera si el plan dijo «no hace falta»",
    (evento) => {
      expect(evaluarGate(con(SIN_ESTABILIDAD), evento)).toEqual(["estabilidad: skipped"]);
    },
  );

  it("saltada sin que el plan lo haya pedido falla (otro job caído, un `if` indebido)", () => {
    expect(evaluarGate(con({ estabilidad: { result: "skipped" } }), "pull_request")).toEqual([
      "estabilidad: skipped",
    ]);
  });

  it.each([
    ["sin la salida del plan", { result: "success", outputs: { hay: "true" } }],
    [
      "con una salida distinta de «false»",
      { result: "success", outputs: { estabilidad: "FALSE" } },
    ],
    ["con el plan fallido", { result: "failure", outputs: { estabilidad: "false" } }],
    ["con el plan cancelado", { result: "cancelled", outputs: { estabilidad: "false" } }],
  ])("saltada %s falla en un pull request", (_nombre, plan) => {
    const necesidades = con({ "mutacion-plan": plan, estabilidad: { result: "skipped" } });
    const problemas = evaluarGate(necesidades, "pull_request");
    expect(problemas).toContain("estabilidad: skipped");
  });

  it.each(["failure", "cancelled"])("%s falla aunque el plan haya dicho «no hace falta»", (r) => {
    const necesidades = con({ ...SIN_ESTABILIDAD, estabilidad: { result: r } });
    expect(evaluarGate(necesidades, "pull_request")).toEqual([`estabilidad: ${r}`]);
  });

  it("ausente de `needs` falla", () => {
    const sinEstabilidad = Object.fromEntries(
      Object.entries(VERDE).filter(([job]) => job !== "estabilidad"),
    );
    expect(evaluarGate(sinEstabilidad, "pull_request")).toEqual(["estabilidad: ausente"]);
  });
});
