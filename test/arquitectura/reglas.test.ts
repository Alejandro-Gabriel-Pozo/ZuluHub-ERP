import { cruise } from "dependency-cruiser";
import type { IForbiddenRuleType } from "dependency-cruiser";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Cada regla de arquitectura tiene una violación inyectada a propósito que la rompe (ADR-003).
 * Si alguien debilita una regla, el caso correspondiente deja de fallar y esta prueba se pone roja.
 */

const require = createRequire(import.meta.url);
const { reglas } = require("../../arquitectura/reglas.cjs") as {
  reglas: IForbiddenRuleType[];
};

type Archivos = Record<string, string>;

const directorios: string[] = [];

afterEach(() => {
  for (const d of directorios.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function violacionesDe(archivos: Archivos): Promise<string[]> {
  const base = mkdtempSync(join(tmpdir(), "zuluhub-arq-"));
  directorios.push(base);
  for (const [ruta, contenido] of Object.entries(archivos)) {
    const destino = join(base, ruta);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, contenido);
  }
  const resultado = await cruise(
    ["src", "apps"].filter((c) => Object.keys(archivos).some((r) => r.startsWith(`${c}/`))),
    {
      baseDir: base,
      validate: true,
      ruleSet: { forbidden: reglas },
      tsPreCompilationDeps: true,
    },
    { extensions: [".ts", ".js"] },
  );
  if (typeof resultado.output === "string") throw new Error("salida inesperada");
  const nombres = resultado.output.summary.violations.map((v) => v.rule.name);
  return [...new Set(nombres)].sort();
}

const exporta = "export const x = 1;\n";
const importa = (ruta: string) => `import { x } from "${ruta}";\nexport const y = x;\n`;

describe("reglas de arquitectura (ADR-001)", () => {
  it("un árbol que respeta las capas no tiene violaciones", async () => {
    const v = await violacionesDe({
      "src/primitivas/a.ts": exporta,
      "src/contexto/b.ts": importa("../primitivas/a"),
      "src/capacidades/c.ts": importa("../contexto/b"),
      "src/modulos/empresas/dominio/d.ts": importa("../../../capacidades/c"),
      "src/modulos/empresas/publico.ts": importa("./dominio/d"),
      "src/plataforma/p.ts": importa("../modulos/empresas/publico"),
      "src/adaptadores/postgres/a.ts": exporta,
      "src/composicion/c.ts": importa("../adaptadores/postgres/a"),
    });
    expect(v).toEqual([]);
  });

  const casos: { regla: string; archivos: Archivos }[] = [
    {
      regla: "sin-ciclos",
      archivos: {
        "src/capacidades/a.ts": importa("./b"),
        "src/capacidades/b.ts": importa("./a"),
      },
    },
    {
      regla: "primitivas-puras",
      archivos: {
        "src/primitivas/a.ts": importa("../contexto/b"),
        "src/contexto/b.ts": exporta,
      },
    },
    {
      regla: "contexto-sin-capas-superiores",
      archivos: {
        "src/contexto/a.ts": importa("../capacidades/b"),
        "src/capacidades/b.ts": exporta,
      },
    },
    {
      regla: "capacidades-sin-negocio",
      archivos: {
        "src/capacidades/a.ts": importa("../modulos/empresas/publico"),
        "src/modulos/empresas/publico.ts": exporta,
      },
    },
    {
      regla: "modulos-sin-capas-superiores",
      archivos: {
        "src/modulos/empresas/publico.ts": importa("../../plataforma/p"),
        "src/plataforma/p.ts": exporta,
      },
    },
    {
      regla: "puertos-sin-capas-superiores",
      archivos: {
        "src/puertos/a.ts": importa("../modulos/empresas/publico"),
        "src/modulos/empresas/publico.ts": exporta,
      },
    },
    {
      regla: "modulos-solo-por-publico",
      archivos: {
        "src/modulos/empresas/publico.ts": importa("../tenants/dominio/t"),
        "src/modulos/tenants/dominio/t.ts": exporta,
      },
    },
    {
      regla: "modulos-solo-por-publico-desde-afuera",
      archivos: {
        "src/plataforma/p.ts": importa("../modulos/empresas/dominio/d"),
        "src/modulos/empresas/dominio/d.ts": exporta,
      },
    },
    {
      regla: "adaptadores-solo-desde-composicion",
      archivos: {
        "src/plataforma/p.ts": importa("../adaptadores/postgres/a"),
        "src/adaptadores/postgres/a.ts": exporta,
      },
    },
    {
      regla: "orm-solo-en-persistencia",
      archivos: {
        "src/modulos/empresas/dominio/d.ts": 'import "kysely";\nexport const d = 1;\n',
      },
    },
    {
      regla: "dominio-sin-framework",
      archivos: {
        "src/modulos/empresas/dominio/d.ts": 'import "zod";\nexport const d = 1;\n',
      },
    },
    {
      regla: "dinero-constructores-internos",
      archivos: {
        "src/modulos/fiscal/dominio/d.ts": importa("../../../primitivas/dinero/interno"),
        "src/primitivas/dinero/interno.ts": exporta,
      },
    },
    {
      regla: "empresas-no-conoce-tenants",
      archivos: {
        "src/modulos/empresas/dominio/d.ts": importa("../../tenants/publico"),
        "src/modulos/tenants/publico.ts": exporta,
      },
    },
    {
      regla: "adaptadores-de-efectos-genericos",
      archivos: {
        "src/adaptadores/trabajos/a.ts": importa("../../modulos/identidad/publico"),
        "src/modulos/identidad/publico.ts": exporta,
      },
    },
    {
      regla: "dominio-sin-guard",
      archivos: {
        "src/modulos/identidad/dominio/d.ts": importa("../../../capacidades/permisos/guard"),
        "src/capacidades/permisos/guard.ts": exporta,
      },
    },
    {
      regla: "plataforma-sin-permisos-de-empresa",
      archivos: {
        "src/plataforma/p.ts": importa("../capacidades/permisos/empresa"),
        "src/capacidades/permisos/empresa.ts": exporta,
      },
    },
    {
      regla: "grupo-sin-permisos-de-empresa",
      archivos: {
        "src/consultas-de-grupo/g.ts": importa("../capacidades/permisos/empresa"),
        "src/capacidades/permisos/empresa.ts": exporta,
      },
    },
    {
      regla: "apps-sin-persistencia-ni-adaptadores",
      archivos: {
        "apps/web/a.ts": importa("../../src/modulos/empresas/persistencia/r"),
        "src/modulos/empresas/persistencia/r.ts": exporta,
      },
    },
    {
      regla: "apps-independientes",
      archivos: {
        "apps/web/a.ts": importa("../plataforma/b"),
        "apps/plataforma/b.ts": exporta,
      },
    },
    {
      regla: "permisos-plataforma-sin-empresa",
      archivos: {
        "src/capacidades/permisos/plataforma.ts": importa("./empresa"),
        "src/capacidades/permisos/empresa.ts": exporta,
      },
    },
    {
      regla: "permisos-empresa-sin-plataforma",
      archivos: {
        "src/capacidades/permisos/empresa.ts": importa("./plataforma"),
        "src/capacidades/permisos/plataforma.ts": exporta,
      },
    },
    {
      regla: "guard-generico-sin-catalogos",
      archivos: {
        "src/capacidades/permisos/guard.ts": importa("./plataforma"),
        "src/capacidades/permisos/plataforma.ts": exporta,
      },
    },
    {
      regla: "modulos-sin-permisos-de-plataforma",
      archivos: {
        "src/modulos/identidad/dominio/d.ts": importa("../../../capacidades/permisos/plataforma"),
        "src/capacidades/permisos/plataforma.ts": exporta,
      },
    },
    {
      regla: "plataforma-sin-framework",
      archivos: {
        "src/plataforma/dominio/d.ts": 'import "zod";\nexport const d = 1;\n',
      },
    },
    {
      regla: "plataforma-dominio-sin-puertos-ni-exigir",
      archivos: {
        "src/plataforma/dominio/d.ts": importa("../../puertos/q"),
        "src/puertos/q.ts": exporta,
      },
    },
    {
      regla: "plataforma-dominio-sin-guard",
      archivos: {
        "src/plataforma/dominio/d.ts": importa("../../capacidades/permisos/guard"),
        "src/capacidades/permisos/guard.ts": exporta,
      },
    },
    {
      regla: "consultas-sin-dominio",
      archivos: {
        "src/modulos/empresas/consultas/c.ts": importa("../dominio/d"),
        "src/modulos/empresas/dominio/d.ts": exporta,
      },
    },
    {
      regla: "empresas-no-conoce-identidad",
      archivos: {
        "src/modulos/empresas/casos-de-uso/c.ts": importa("../../identidad/publico"),
        "src/modulos/identidad/publico.ts": exporta,
      },
    },
    {
      regla: "grupo-solo-escribe-su-auditoria",
      archivos: {
        "src/consultas-de-grupo/g.ts": importa("../puertos/auditoria"),
        "src/puertos/auditoria.ts": exporta,
      },
    },
    {
      regla: "permisos-grupo-sin-otros-catalogos",
      archivos: {
        "src/capacidades/permisos/grupo.ts": importa("./empresa"),
        "src/capacidades/permisos/empresa.ts": exporta,
      },
    },
    {
      regla: "permisos-sin-grupo",
      archivos: {
        "src/capacidades/permisos/empresa.ts": importa("./grupo"),
        "src/capacidades/permisos/grupo.ts": exporta,
      },
    },
    {
      regla: "negocio-sin-permisos-de-grupo",
      archivos: {
        "src/modulos/identidad/dominio/d.ts": importa("../../../capacidades/permisos/grupo"),
        "src/capacidades/permisos/grupo.ts": exporta,
      },
    },
  ];

  it("cada regla definida tiene su caso de violación", () => {
    expect(casos.map((c) => c.regla).sort()).toEqual(reglas.map((r) => r.name).sort());
  });

  for (const caso of casos) {
    it(`la regla ${caso.regla} se dispara con su violación`, async () => {
      const v = await violacionesDe(caso.archivos);
      expect(v).toContain(caso.regla);
    });
  }

  it("las primitivas de dinero sí pueden usar sus propios constructores internos", async () => {
    const v = await violacionesDe({
      "src/primitivas/dinero/importe.ts": importa("./interno"),
      "src/primitivas/dinero/interno.ts": exporta,
      "src/primitivas/dinero/interno-desde-cantidad.ts": importa("../cantidad/interno"),
      "src/primitivas/cantidad/interno.ts": exporta,
    });
    expect(v).toEqual([]);
  });

  it("el procesador de trabajos y el correo sí pueden usar puertos, primitivas y contexto", async () => {
    const v = await violacionesDe({
      "src/primitivas/p.ts": exporta,
      "src/contexto/c.ts": importa("../primitivas/p"),
      "src/puertos/q.ts": importa("../contexto/c"),
      "src/adaptadores/trabajos/a.ts": importa("../../puertos/q"),
      "src/adaptadores/correo/b.ts": importa("../../puertos/q"),
    });
    expect(v).toEqual([]);
  });

  it("el dominio puede conocer los roles, pero no el guard ni la matriz de empresa", async () => {
    const v = await violacionesDe({
      "src/modulos/identidad/dominio/d.ts": importa("../../../capacidades/permisos/roles"),
      "src/capacidades/permisos/roles.ts": exporta,
    });
    expect(v).not.toContain("dominio-sin-guard");
    const w = await violacionesDe({
      "src/modulos/identidad/dominio/d.ts": importa("../../../capacidades/permisos/empresa"),
      "src/capacidades/permisos/empresa.ts": exporta,
    });
    expect(w).toContain("dominio-sin-guard");
  });

  it("los casos de uso sí piden el guard y la plataforma y el grupo sí pueden usar el guard genérico", async () => {
    const v = await violacionesDe({
      "src/modulos/identidad/casos-de-uso/c.ts": importa("../../../capacidades/permisos/guard"),
      "src/plataforma/p.ts": importa("../capacidades/permisos/guard"),
      "src/consultas-de-grupo/g.ts": importa("../capacidades/permisos/guard"),
      "src/capacidades/permisos/guard.ts": exporta,
    });
    expect(v).toEqual([]);
  });

  it("una consulta sí puede usar el guard, los puertos y la persistencia de su módulo, y un caso de uso el dominio", async () => {
    const v = await violacionesDe({
      "src/primitivas/p.ts": exporta,
      "src/contexto/c.ts": importa("../primitivas/p"),
      "src/puertos/q.ts": importa("../contexto/c"),
      "src/capacidades/permisos/guard.ts": exporta,
      "src/modulos/empresas/persistencia/r.ts": exporta,
      "src/modulos/empresas/dominio/d.ts": exporta,
      "src/modulos/empresas/consultas/c.ts":
        'import { x as a } from "../../../capacidades/permisos/guard";\nimport { x as b } from "../../../puertos/q";\nimport { x as c } from "../persistencia/r";\nexport const y = a + b + c;\n',
      "src/modulos/empresas/casos-de-uso/u.ts": importa("../dominio/d"),
    });
    expect(v).toEqual([]);
  });

  it("el ORM sí se puede importar en la persistencia de un módulo y en el adaptador de Postgres", async () => {
    const v = await violacionesDe({
      "src/modulos/empresas/persistencia/r.ts": 'import "kysely";\nexport const r = 1;\n',
      "src/adaptadores/postgres/a.ts": 'import "kysely";\nexport const a = 1;\n',
    });
    expect(v).not.toContain("orm-solo-en-persistencia");
  });

  describe("H5 plataforma: catálogos de permisos independientes y dominio de plataforma puro", () => {
    it("el guard genérico, el catálogo de empresa y el de plataforma conviven sin importarse entre sí", async () => {
      const v = await violacionesDe({
        "src/capacidades/permisos/roles.ts": exporta,
        "src/capacidades/permisos/guard.ts": importa("./roles"),
        "src/capacidades/permisos/exigir.ts": importa("./guard"),
        "src/capacidades/permisos/empresa.ts": importa("./guard"),
        "src/capacidades/permisos/plataforma.ts": importa("./guard"),
      });
      expect(v).toEqual([]);
    });

    it("las pruebas de cada catálogo pueden importar su propio archivo", async () => {
      const v = await violacionesDe({
        "src/capacidades/permisos/empresa.ts": exporta,
        "src/capacidades/permisos/plataforma.ts": exporta,
        "src/capacidades/permisos/empresa.test.ts": importa("./empresa"),
        "src/capacidades/permisos/plataforma.test.ts": importa("./plataforma"),
      });
      expect(v).toEqual([]);
    });

    it("la plataforma sí puede usar el guard, su matriz, el estado efectivo y los módulos por publico.ts", async () => {
      const v = await violacionesDe({
        "src/primitivas/p.ts": exporta,
        "src/contexto/estados.ts": importa("../primitivas/p"),
        "src/capacidades/permisos/guard.ts": exporta,
        "src/capacidades/permisos/exigir.ts": importa("./guard"),
        "src/capacidades/permisos/plataforma.ts": importa("./guard"),
        "src/modulos/identidad/publico.ts": exporta,
        "src/puertos/q.ts": exporta,
        "src/plataforma/casos-de-uso/c.ts": [
          importa("../../capacidades/permisos/exigir"),
          importa("../../capacidades/permisos/plataforma"),
          importa("../../puertos/q"),
          importa("../../modulos/identidad/publico"),
        ].join(""),
        "src/plataforma/dominio/admin.ts": [
          importa("../../capacidades/permisos/plataforma"),
          importa("../../contexto/estados"),
          importa("../../modulos/identidad/publico"),
        ].join(""),
      });
      expect(v).toEqual([]);
    });

    it("soporte/explicar es la única parte del dominio de plataforma que puede usar el guard", async () => {
      const permitido = await violacionesDe({
        "src/plataforma/dominio/soporte/explicar.ts": importa(
          "../../../capacidades/permisos/guard",
        ),
        "src/plataforma/dominio/soporte/explicar.test.ts": importa(
          "../../../capacidades/permisos/guard",
        ),
        "src/capacidades/permisos/guard.ts": exporta,
      });
      expect(permitido).toEqual([]);
      const prohibido = await violacionesDe({
        "src/plataforma/dominio/soporte/otro.ts": importa("../../../capacidades/permisos/guard"),
        "src/capacidades/permisos/guard.ts": exporta,
      });
      expect(prohibido).toEqual(["plataforma-dominio-sin-guard"]);
    });

    it("ni siquiera explicar puede usar exigirAccion ni los puertos", async () => {
      const v = await violacionesDe({
        "src/plataforma/dominio/soporte/explicar.ts": [
          importa("../../../capacidades/permisos/exigir"),
          importa("../../../puertos/q"),
        ].join(""),
        "src/capacidades/permisos/exigir.ts": exporta,
        "src/puertos/q.ts": exporta,
      });
      expect(v).toEqual(["plataforma-dominio-sin-puertos-ni-exigir"]);
    });

    it("los casos de uso de plataforma tampoco pueden importar Zod, React ni Next", async () => {
      for (const paquete of ["zod", "react", "react-dom", "next"]) {
        const v = await violacionesDe({
          "src/plataforma/casos-de-uso/c.ts": `import "${paquete}";\nexport const c = 1;\n`,
        });
        expect(v, paquete).toContain("plataforma-sin-framework");
      }
    });

    it("las consultas de grupo tampoco importan la matriz de plataforma", async () => {
      const v = await violacionesDe({
        "src/consultas-de-grupo/g.ts": importa("../capacidades/permisos/plataforma"),
        "src/capacidades/permisos/plataforma.ts": exporta,
      });
      expect(v).toContain("modulos-sin-permisos-de-plataforma");
    });
  });

  describe("H6 grupo: consultas de solo lectura y catálogo de permisos propio", () => {
    it("las consultas de grupo solo pueden usar las transacciones, la autorización de grupo y su registro de acceso", async () => {
      const v = await violacionesDe({
        "src/primitivas/p.ts": exporta,
        "src/contexto/c.ts": importa("../primitivas/p"),
        "src/capacidades/permisos/guard.ts": exporta,
        "src/capacidades/permisos/exigir.ts": importa("./guard"),
        "src/capacidades/permisos/grupo.ts": importa("./guard"),
        "src/puertos/transacciones.ts": importa("../contexto/c"),
        "src/puertos/autorizacion-de-grupo.ts": importa("../capacidades/permisos/grupo"),
        "src/puertos/auditoria-de-acceso-de-grupo.ts": importa("../primitivas/p"),
        "src/modulos/empresas/publico.ts": exporta,
        "src/consultas-de-grupo/g.ts": [
          importa("../capacidades/permisos/exigir"),
          importa("../capacidades/permisos/grupo"),
          importa("../contexto/c"),
          importa("../modulos/empresas/publico"),
          importa("../puertos/transacciones"),
          importa("../puertos/autorizacion-de-grupo"),
          importa("../puertos/auditoria-de-acceso-de-grupo"),
        ].join(""),
      });
      expect(v).toEqual([]);
    });

    it("cualquier otro puerto de escritura queda prohibido por nombre", async () => {
      for (const puerto of [
        "auditoria",
        "auditoria-de-plataforma",
        "idempotencia",
        "cola-de-trabajos",
        "trabajos",
        "correo",
        "autorizacion",
        "autorizacion-de-plataforma",
        "admins-de-plataforma",
      ]) {
        const v = await violacionesDe({
          "src/consultas-de-grupo/g.ts": importa(`../puertos/${puerto}`),
          [`src/puertos/${puerto}.ts`]: exporta,
        });
        expect(v, puerto).toEqual(["grupo-solo-escribe-su-auditoria"]);
      }
    });

    it("el guard genérico, exigirAccion y los otros catálogos tampoco importan la matriz de grupo", async () => {
      for (const origen of ["guard", "exigir", "empresa", "plataforma"]) {
        const v = await violacionesDe({
          [`src/capacidades/permisos/${origen}.ts`]: importa("./grupo"),
          "src/capacidades/permisos/grupo.ts": exporta,
        });
        expect(v, origen).toContain("permisos-sin-grupo");
      }
    });

    it("el catálogo de grupo no importa el de plataforma, y la plataforma no importa el de grupo", async () => {
      const a = await violacionesDe({
        "src/capacidades/permisos/grupo.ts": importa("./plataforma"),
        "src/capacidades/permisos/plataforma.ts": exporta,
      });
      expect(a).toContain("permisos-grupo-sin-otros-catalogos");
      const b = await violacionesDe({
        "src/plataforma/p.ts": importa("../capacidades/permisos/grupo"),
        "src/capacidades/permisos/grupo.ts": exporta,
      });
      expect(b).toContain("negocio-sin-permisos-de-grupo");
    });

    it("el catálogo de grupo y su prueba conviven con el guard sin importarse entre sí con los demás", async () => {
      const v = await violacionesDe({
        "src/capacidades/permisos/guard.ts": exporta,
        "src/capacidades/permisos/empresa.ts": importa("./guard"),
        "src/capacidades/permisos/plataforma.ts": importa("./guard"),
        "src/capacidades/permisos/grupo.ts": importa("./guard"),
        "src/capacidades/permisos/grupo.test.ts": importa("./grupo"),
      });
      expect(v).toEqual([]);
    });
  });
});
