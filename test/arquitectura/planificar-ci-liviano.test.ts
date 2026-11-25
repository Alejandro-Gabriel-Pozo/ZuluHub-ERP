import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Dependencias = Record<string, string[]>;
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
    base: string;
    origen: string;
    raiz: string;
    grupos: unknown[];
    h: Record<string, unknown>;
  }) => Decision;
};
const { cierre } = require("../../arquitectura/planificar-mutacion.cjs") as {
  cierre: (archivo: string, dependencias: Dependencias) => Set<string>;
};

/** Decide el plan con las herramientas de `planificar-mutacion.cjs` reemplazadas por falsos: el grafo y los cambios los pone cada caso. */
function decidir(e: {
  evento: string;
  base: string;
  origen: string;
  cambios?: string[];
  dependencias?: Dependencias;
}): Decision {
  return decidirElPlan({
    evento: e.evento,
    base: e.base,
    origen: e.origen,
    raiz: "/no-se-lee",
    grupos: [{ grupo: "uno" }],
    h: {
      todosLosGrupos: (grupos: unknown[], motivo: string) => ({ completo: true, motivo, grupos }),
      leerCambios: () => e.cambios ?? [],
      leerDependencias: () => e.dependencias ?? {},
      leerCi: () => ({ antes: null, despues: null }),
      planificar: () => ({ completo: false, motivo: "por grafo", grupos: [{ grupo: "uno" }] }),
      planificarEstabilidad: () => ({ corre: false, motivo: "por grafo" }),
      cierre,
    },
  });
}

/**
 * CI liviano (dueño, 25/11/2026): un pull request hacia la rama de integración corre sin mutación ni Estabilidad, y la web solo si el cambio la toca; el pull request final
 * (de la rama de integración hacia otra) corre todo. Previene: 60 chequeos y 30 a 60 minutos por pull request con muchas sesiones en paralelo, sin que el recorte se
 * filtre a un pull request que no le corresponde. Cada caso de abajo es una violación inyectada: si se debilita `decidirElPlan`, esta prueba falla.
 */
describe("el perfil de un pull request", () => {
  const perfil = (evento: string, base: string, origen: string) =>
    decidir({ evento, base, origen }).perfil;

  it("hacia la rama de integración es liviano", () => {
    expect(perfil("pull_request", BASE_DE_INTEGRACION, "feat/algo")).toBe("liviano");
  });

  it("el pull request final (de la rama de integración hacia main) es completo", () => {
    expect(perfil("pull_request", "main", BASE_DE_INTEGRACION)).toBe("completo");
  });

  it("cualquier otro pull request (por ejemplo, dependencias hacia main) sigue por grafo, como antes", () => {
    expect(perfil("pull_request", "main", "dependabot/npm_and_yarn/x")).toBe("por-grafo");
    expect(perfil("pull_request", "otra", "feat/algo")).toBe("por-grafo");
  });

  it("VIOLACIÓN: base vacía, parecida o con otra forma NO es liviano (la base tiene que ser exacta)", () => {
    for (const base of [
      "",
      "integracion",
      "integracion/modulos-v2/",
      "Integracion/modulos-v2",
      "integracion/modulos-v2-x",
      "x/integracion/modulos-v2",
      "main",
    ]) {
      expect(perfil("pull_request", base, "feat/algo"), base).not.toBe("liviano");
    }
  });

  it("VIOLACIÓN: otro evento (nocturna, a pedido, push) nunca es liviano, aunque la base sea la de integración", () => {
    for (const evento of ["schedule", "workflow_dispatch", "push", "", "pull_request_target"]) {
      expect(perfil(evento, BASE_DE_INTEGRACION, BASE_DE_INTEGRACION), evento).toBe("completo");
    }
  });

  it("un pull request con origen igual a la base de integración y base de integración es liviano (la base manda)", () => {
    expect(perfil("pull_request", BASE_DE_INTEGRACION, BASE_DE_INTEGRACION)).toBe("liviano");
  });
});

describe("lo que decide el plan en cada perfil", () => {
  it("liviano: ningún grupo de mutación, Estabilidad no corre, y se dice por qué", () => {
    const d = decidir({ evento: "pull_request", base: BASE_DE_INTEGRACION, origen: "feat/x" });
    expect(d.plan.grupos).toEqual([]);
    expect(d.plan.motivo).toContain("CI liviano");
    expect(d.estabilidad.corre).toBe(false);
  });

  it("VIOLACIÓN: el pull request final corre TODOS los grupos, Estabilidad y la web (nunca liviano)", () => {
    const d = decidir({ evento: "pull_request", base: "main", origen: BASE_DE_INTEGRACION });
    expect(d.plan.grupos).toHaveLength(1);
    expect(d.estabilidad.corre).toBe(true);
    expect(d.web.toca).toBe(true);
  });

  it("VIOLACIÓN: la nocturna y la corrida a pedido corren todo y la web, aunque la base sea la de integración", () => {
    for (const evento of ["schedule", "workflow_dispatch"]) {
      const d = decidir({ evento, base: BASE_DE_INTEGRACION, origen: BASE_DE_INTEGRACION });
      expect(d.plan.grupos, evento).toHaveLength(1);
      expect(d.estabilidad.corre, evento).toBe(true);
      expect(d.web.toca, evento).toBe(true);
    }
  });

  it("cualquier otro pull request sigue por grafo (lo que decide `planificar`), con la web siempre", () => {
    const d = decidir({ evento: "pull_request", base: "main", origen: "dependabot/x" });
    expect(d.perfil).toBe("por-grafo");
    expect(d.plan.motivo).toBe("por grafo");
    expect(d.web.toca).toBe(true);
  });
});

describe("¿el cambio toca la web?", () => {
  // Grafo mínimo: una aplicación importa un composicion, que importa un dominio; un recorrido importa un auxiliar; el guardián y sus pruebas viven aparte.
  const DEPENDENCIAS: Record<string, string[]> = {
    "apps/web/app/pagina.tsx": ["src/composicion/caja-web.ts"],
    "src/composicion/caja-web.ts": ["src/modulos/caja/dominio/cobro.ts"],
    "src/modulos/caja/dominio/cobro.ts": [],
    "src/modulos/otro/dominio/aislado.ts": [],
    "test/recorrido/facturacion.recorrido.ts": ["test/utilidades/auxiliar-de-recorrido.ts"],
    "test/utilidades/auxiliar-de-recorrido.ts": [],
    "test/arquitectura/algo.test.ts": ["arquitectura/algo.cjs"],
    "arquitectura/algo.cjs": [],
    ".github/workflows/ci.yml": [],
  };
  const decidirWeb = (...cambios: string[]) =>
    decidir({
      evento: "pull_request",
      base: BASE_DE_INTEGRACION,
      origen: "feat/x",
      cambios,
      dependencias: DEPENDENCIAS,
    }).web;
  const toca = (...cambios: string[]) => decidirWeb(...cambios).toca;

  it("un archivo de una aplicación toca la web", () => {
    expect(toca("apps/web/app/pagina.tsx")).toBe(true);
    expect(toca("apps/plataforma/otra.tsx")).toBe(true); // aunque no esté en el grafo
  });

  it("un archivo que una aplicación importa (directo o por varios saltos) toca la web", () => {
    expect(toca("src/composicion/caja-web.ts")).toBe(true);
    expect(toca("src/modulos/caja/dominio/cobro.ts")).toBe(true);
  });

  it("un auxiliar que importa un recorrido toca la web, y el propio recorrido también", () => {
    expect(toca("test/utilidades/auxiliar-de-recorrido.ts")).toBe(true);
    expect(toca("test/recorrido/facturacion.recorrido.ts")).toBe(true);
  });

  it("lo que ninguna aplicación ni recorrido alcanza NO toca la web", () => {
    expect(toca("src/modulos/otro/dominio/aislado.ts")).toBe(false);
    expect(toca("test/arquitectura/algo.test.ts", "arquitectura/algo.cjs")).toBe(false);
  });

  it("la documentación y lo ajeno no cuentan", () => {
    expect(toca("README.md", "docs/algo.md", ".gitleaks.toml")).toBe(false);
  });

  it("VIOLACIÓN: lo que el grafo no conoce (configuración, migraciones, package.json, un archivo nuevo) toca la web (fail-closed)", () => {
    for (const archivo of [
      "package.json",
      "package-lock.json",
      "migraciones/0100_algo.sql",
      "vitest.config.ts",
      "tsconfig.json",
      "src/modulos/nuevo/dominio/recien-creado.ts",
      "archivo-raro.xyz",
    ]) {
      const r = decidirWeb(archivo);
      expect(r.toca, archivo).toBe(true);
      expect(r.motivo, archivo).toContain(archivo);
    }
  });

  it("VIOLACIÓN: el propio ci.yml toca la web aunque esté en el grafo", () => {
    expect(toca(".github/workflows/ci.yml")).toBe(true);
  });

  it("basta UN archivo que toque la web entre varios que no", () => {
    expect(
      toca("src/modulos/otro/dominio/aislado.ts", "README.md", "apps/web/app/pagina.tsx"),
    ).toBe(true);
  });

  it("un PR sin cambios (o solo documentación) no toca la web", () => {
    expect(toca()).toBe(false);
  });
});
