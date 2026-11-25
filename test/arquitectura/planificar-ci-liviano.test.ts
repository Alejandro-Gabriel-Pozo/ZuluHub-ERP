import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Dependencias = Record<string, string[]>;
const { BASE_DE_INTEGRACION, perfilDelPullRequest, tocaLaWeb } =
  require("../../arquitectura/perfil-del-ci.cjs") as {
    BASE_DE_INTEGRACION: string;
    perfilDelPullRequest: (e: { evento: string; base: string; origen: string }) => string;
    tocaLaWeb: (e: {
      cambios: string[];
      dependencias: Dependencias;
      cierre: (archivo: string, dependencias: Dependencias) => Set<string>;
    }) => { toca: boolean; motivo: string };
  };
const { cierre } = require("../../arquitectura/planificar-mutacion.cjs") as {
  cierre: (archivo: string, dependencias: Dependencias) => Set<string>;
};

/**
 * CI liviano (dueño, 25/11/2026): un pull request hacia la rama de integración corre sin mutación ni Estabilidad, y la web solo si el cambio la toca; el pull request final
 * (de la rama de integración hacia otra) corre todo. Previene: 60 chequeos y 30 a 60 minutos por pull request con muchas sesiones en paralelo, sin que el recorte se
 * filtre a un pull request que no le corresponde. Cada caso de abajo es una violación inyectada: si se debilita `perfilDelPullRequest` o `tocaLaWeb`, esta prueba falla.
 */
describe("el perfil de un pull request", () => {
  const perfil = (evento: string, base: string, origen: string) =>
    perfilDelPullRequest({ evento, base, origen });

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
  const toca = (...cambios: string[]) =>
    tocaLaWeb({ cambios, dependencias: DEPENDENCIAS, cierre }).toca;

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
      const r = tocaLaWeb({ cambios: [archivo], dependencias: DEPENDENCIAS, cierre });
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
