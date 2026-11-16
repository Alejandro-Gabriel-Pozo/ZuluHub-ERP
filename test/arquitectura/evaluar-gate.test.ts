import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El Gate es el chequeo requerido de `main`: «saltado por filtro» es correcto, «fallido»,
 * «cancelado» o «saltado porque otro job cayó» no lo es.
 */

type Needs = Record<string, { result: string; outputs?: Record<string, string> }>;
const require = createRequire(import.meta.url);
const { evaluarGate, corridaReemplazada } = require("../../arquitectura/evaluar-gate.cjs") as {
  evaluarGate: (needs: Needs, evento?: string) => string[];
  corridaReemplazada: (e: {
    needs: Needs;
    evento?: string;
    actual?: string;
    deEstaCorrida?: string;
  }) => boolean;
};
const RAIZ = join(import.meta.dirname, "../..");

const VERDE: Needs = {
  estatico: { result: "success" },
  guardian: { result: "success" },
  pruebas: { result: "success" },
  seguridad: { result: "success" },
  flujos: { result: "success" },
  web: { result: "success" },
  componentes: { result: "success" },
  recorrido: { result: "success" },
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

  it.each([
    "estatico",
    "guardian",
    "pruebas",
    "seguridad",
    "flujos",
    "web",
    "componentes",
    "recorrido",
  ])("%s fallido o saltado falla", (job) => {
    expect(evaluarGate(con({ [job]: { result: "failure" } }))).toEqual([`${job}: failure`]);
    expect(evaluarGate(con({ [job]: { result: "skipped" } }))).toEqual([`${job}: skipped`]);
  });

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

describe("Gate: una corrida REEMPLAZADA por un push nuevo no es una falla (y todo lo demás sigue en rojo)", () => {
  // Qué previene: 24 de 29 Gates rojos (13-15/11/2026) eran solo corridas canceladas por `concurrency` al llegar un push nuevo: un rojo sobre un commit
  // viejo parece una falla y esconde las reales. Lo que NO puede pasar: que una falla real, un timeout o una cancelación a mano del commit vigente
  // salgan en verde. Por eso se exige que la rama YA haya avanzado (SHA distinto), que ningún job haya fallado y que alguno esté cancelado.
  const VIEJO = "a".repeat(40);
  const NUEVO = "b".repeat(40);
  const CANCELADA = con({
    guardian: { result: "cancelled" },
    pruebas: { result: "cancelled" },
    "mutacion-plan": { result: "cancelled" },
    mutacion: { result: "skipped" },
  });
  const reemplazada = (cambios: Partial<Parameters<typeof corridaReemplazada>[0]> = {}) =>
    corridaReemplazada({
      needs: CANCELADA,
      evento: "pull_request",
      actual: NUEVO,
      deEstaCorrida: VIEJO,
      ...cambios,
    });

  it("cancelada por un push posterior (la rama avanzó): es una corrida reemplazada, en pull request y en push", () => {
    expect(reemplazada()).toBe(true);
    expect(reemplazada({ evento: "push" })).toBe(true);
  });

  it("el veredicto de los jobs no cambia: sigue habiendo problemas (el reemplazo solo decide qué hace el paso)", () => {
    expect(evaluarGate(CANCELADA, "pull_request").length).toBeGreaterThan(0);
  });

  it.each([
    [
      "un job FALLÓ, aunque la rama haya avanzado",
      con({ pruebas: { result: "failure" }, guardian: { result: "cancelled" } }),
    ],
    ["un job falló y ninguno se canceló", con({ pruebas: { result: "failure" } })],
    [
      "un job omitido sin que nada se cancelara (un `if` indebido)",
      con({ mutacion: { result: "skipped" } }),
    ],
    [
      "un resultado desconocido",
      con({ pruebas: { result: "algo-raro" }, guardian: { result: "cancelled" } }),
    ],
    [
      "un job sin resultado",
      con({ pruebas: {} as { result: string }, guardian: { result: "cancelled" } }),
    ],
    ["todo en verde (no hay nada que explicar)", VERDE],
  ])("NO es reemplazada: %s", (_, needs) => {
    expect(reemplazada({ needs })).toBe(false);
  });

  it.each([
    ["cancelada por timeout o a mano con la cabeza vigente (mismo SHA)", { actual: VIEJO }],
    ["no se pudo leer la cabeza actual (vacía)", { actual: "" }],
    ["la cabeza actual no es un SHA", { actual: "main" }],
    ["la cabeza de la corrida no es un SHA", { deEstaCorrida: "HEAD" }],
    ["SHA con mayúsculas o de largo incorrecto", { actual: "B".repeat(40) }],
    ["la corrida nocturna", { evento: "schedule" }],
    ["un disparo manual", { evento: "workflow_dispatch" }],
    ["sin evento", { evento: undefined }],
  ] as [string, Partial<Parameters<typeof corridaReemplazada>[0]>][])(
    "NO es reemplazada: %s",
    (_, cambios) => {
      expect(reemplazada(cambios)).toBe(false);
    },
  );

  describe("el paso de verdad (`node arquitectura/evaluar-gate.cjs`): código de salida", () => {
    const correr = (needs: Needs, env: Record<string, string>) =>
      spawnSync("node", [join(RAIZ, "arquitectura/evaluar-gate.cjs")], {
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          PATH: process.env["PATH"] ?? "",
          NEEDS: JSON.stringify(needs),
          ...env,
        },
      });

    it("reemplazada: sale 0 y lo dice con un aviso que nombra las dos cabezas", () => {
      const r = correr(CANCELADA, {
        EVENTO: "pull_request",
        CABEZA_ACTUAL: NUEVO,
        CABEZA_DE_ESTA_CORRIDA: VIEJO,
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("Corrida reemplazada");
      expect(r.stdout).toContain(NUEVO);
    });

    it.each([
      ["la misma cabeza (cancelada con el commit vigente)", CANCELADA, { CABEZA_ACTUAL: VIEJO }],
      ["sin cabeza actual", CANCELADA, {}],
      [
        "un job fallido con la rama avanzada",
        con({ pruebas: { result: "failure" }, guardian: { result: "cancelled" } }),
        { CABEZA_ACTUAL: NUEVO },
      ],
    ] as [string, Needs, Record<string, string>][])("sale 1 (rojo): %s", (_, needs, env) => {
      const r = correr(needs, { EVENTO: "pull_request", CABEZA_DE_ESTA_CORRIDA: VIEJO, ...env });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Gate en rojo");
    });

    it("todo en verde sale 0 sin aviso de reemplazo", () => {
      const r = correr(VERDE, { EVENTO: "push" });
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain("Corrida reemplazada");
    });
  });

  it("ci.yml: el Gate sigue con `always()` (nunca `!cancelled()`: un Gate omitido contaría como éxito) y recibe las dos cabezas", () => {
    const ci = readFileSync(join(RAIZ, ".github/workflows/ci.yml"), "utf8");
    const gate = ci.slice(ci.indexOf("\n  gate:\n"), ci.indexOf("\n  web:\n"));
    expect(gate).toContain("if: always()");
    expect(gate).not.toContain("cancelled()");
    expect(gate).toContain("CABEZA_ACTUAL: ${{ steps.cabeza.outputs.actual }}");
    expect(gate).toContain(
      "CABEZA_DE_ESTA_CORRIDA: ${{ github.event.pull_request.head.sha || github.sha }}",
    );
  });
});
