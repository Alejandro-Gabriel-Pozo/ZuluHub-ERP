import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Decision = {
  perfil: string;
  plan: { grupos: unknown[]; motivo: string };
  estabilidad: { corre: boolean };
  web: { toca: boolean; motivo: string };
};
const { BASE_DE_INTEGRACION, decidirElPlan } = require("../../arquitectura/perfil-del-ci.cjs") as {
  BASE_DE_INTEGRACION: string;
  decidirElPlan: (e: {
    evento: string;
    origen: string;
    raiz: string;
    grupos: unknown[];
    h: Record<string, unknown>;
  }) => Decision;
};

/** Decide el plan con las herramientas de `planificar-mutacion.cjs` reemplazadas por falsos: el grafo y los cambios los pone cada caso. */
function decidir(e: { evento: string; origen: string }): Decision {
  return decidirElPlan({
    evento: e.evento,
    origen: e.origen,
    raiz: "/no-se-lee",
    grupos: [{ grupo: "uno" }],
    h: {
      todosLosGrupos: (grupos: unknown[], motivo: string) => ({ completo: true, motivo, grupos }),
      leerCambios: () => [],
      leerDependencias: () => ({}),
      leerCi: () => ({ antes: null, despues: null }),
      planificar: () => ({ completo: false, motivo: "por grafo", grupos: [{ grupo: "uno" }] }),
      planificarEstabilidad: () => ({ corre: false, motivo: "por grafo" }),
    },
  });
}

/**
 * El perfil liviano del CI (dueño, 25/11/2026: un pull request hacia la rama de integración sin mutación ni Estabilidad y con la web solo si el cambio la tocaba) se RETIRÓ el 27/11/2026 con
 * la rama de integración. Previene que vuelva sin que nadie lo decida: el recorte (60 chequeos y 30 a 60 minutos por pull request, a cambio de dejar la mutación para la nocturna) solo se
 * justificaba con muchas sesiones sobre esa rama. Cada caso es una violación inyectada: si `decidirElPlan` vuelve a devolver `liviano` para algún pull request, esta prueba falla.
 */
describe("el perfil de un pull request (ya no hay perfil liviano)", () => {
  const perfil = (evento: string, origen: string) => decidir({ evento, origen }).perfil;

  it("un pull request que no viene de la rama de integración va por grafo (también hacia la rama de integración)", () => {
    expect(perfil("pull_request", "feat/algo")).toBe("por-grafo");
    expect(perfil("pull_request", "dependabot/npm_and_yarn/x")).toBe("por-grafo");
  });

  it("el pull request final (desde la rama de integración) sigue siendo completo", () => {
    expect(perfil("pull_request", BASE_DE_INTEGRACION)).toBe("completo");
  });

  it("VIOLACIÓN: ningún evento ni origen devuelve «liviano»", () => {
    for (const evento of [
      "pull_request",
      "push",
      "schedule",
      "workflow_dispatch",
      "",
      "pull_request_target",
    ]) {
      for (const origen of [
        "",
        "feat/x",
        BASE_DE_INTEGRACION,
        "integracion/modulos-v2-x",
        "main",
      ]) {
        expect(perfil(evento, origen), `${evento} / ${origen}`).not.toBe("liviano");
      }
    }
  });
});

describe("lo que decide el plan en cada perfil", () => {
  it("VIOLACIÓN: el pull request final corre TODOS los grupos, Estabilidad y la web", () => {
    const d = decidir({ evento: "pull_request", origen: BASE_DE_INTEGRACION });
    expect(d.plan.grupos).toHaveLength(1);
    expect(d.estabilidad.corre).toBe(true);
    expect(d.web.toca).toBe(true);
  });

  it("VIOLACIÓN: la nocturna y la corrida a pedido corren todo y la web", () => {
    for (const evento of ["schedule", "workflow_dispatch"]) {
      const d = decidir({ evento, origen: BASE_DE_INTEGRACION });
      expect(d.plan.grupos, evento).toHaveLength(1);
      expect(d.estabilidad.corre, evento).toBe(true);
      expect(d.web.toca, evento).toBe(true);
    }
  });

  it("cualquier otro pull request sigue por grafo (lo que decide `planificar`), con la web siempre y sin el motivo del CI liviano", () => {
    const d = decidir({ evento: "pull_request", origen: "dependabot/x" });
    expect(d.perfil).toBe("por-grafo");
    expect(d.plan.motivo).toBe("por grafo");
    expect(d.plan.motivo).not.toContain("CI liviano");
    expect(d.web.toca).toBe(true);
  });
});
