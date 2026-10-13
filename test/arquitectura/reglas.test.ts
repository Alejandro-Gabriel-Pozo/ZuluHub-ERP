import { cruise } from "dependency-cruiser";
import type { IForbiddenRuleType } from "dependency-cruiser";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
    { extensions: [".ts", ".tsx", ".js"] },
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
    {
      regla: "dominio-sin-persistencia",
      archivos: {
        "src/modulos/fiscal/dominio/d.ts": importa("../persistencia/tablas"),
        "src/modulos/fiscal/persistencia/tablas.ts": exporta,
      },
    },
    {
      regla: "persistencia-sin-casos-de-uso",
      archivos: {
        "src/modulos/fiscal/persistencia/r.ts": importa("../casos-de-uso/c"),
        "src/modulos/fiscal/casos-de-uso/c.ts": exporta,
      },
    },
    {
      regla: "capacidades-de-planes-fuera-del-dominio",
      archivos: {
        "src/modulos/empresas/dominio/d.ts": importa("../../../capacidades/planes/niveles"),
        "src/capacidades/planes/niveles.ts": exporta,
      },
    },
    {
      regla: "planes-sin-marcas",
      archivos: {
        "src/modulos/planes/dominio/d.ts": importa("../../marcas/publico"),
        "src/modulos/marcas/publico.ts": exporta,
      },
    },
    {
      regla: "modulos-sin-planes",
      archivos: {
        "src/modulos/empresas/casos-de-uso/c.ts": importa("../../planes/publico"),
        "src/modulos/planes/publico.ts": exporta,
      },
    },
    {
      regla: "modulos-sin-marcas",
      archivos: {
        "src/modulos/empresas/casos-de-uso/c.ts": importa("../../marcas/publico"),
        "src/modulos/marcas/publico.ts": exporta,
      },
    },
    {
      regla: "composicion-solo-desde-servidor-de-apps",
      archivos: {
        "apps/web/app/s/app/page.tsx": importa("../../../../../src/composicion/web"),
        "src/composicion/web.ts": exporta,
      },
    },
    {
      regla: "cliente-sin-servidor",
      archivos: {
        "apps/web/app/s/app/boton.cliente.tsx": importa("../../../servidor/composicion"),
        "apps/web/servidor/composicion.ts": exporta,
      },
    },
    {
      regla: "formas-sin-negocio",
      archivos: {
        "src/modulos/empresas/formas.ts": importa("./dominio/sucursal"),
        "src/modulos/empresas/dominio/sucursal.ts": exporta,
      },
    },
    {
      regla: "iconos-solo-por-su-puerta",
      archivos: {
        "apps/web/ui/componentes/boton.ts": importa("lucide-react"),
      },
    },
    {
      regla: "ui-sin-pantallas-ni-modulos",
      archivos: {
        "apps/web/ui/componentes/boton.ts": importa("../../pantallas/factura"),
        "apps/web/pantallas/factura.ts": exporta,
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

  it("la persistencia tampoco puede importar las consultas de su módulo", async () => {
    const v = await violacionesDe({
      "src/modulos/fiscal/persistencia/r.ts": importa("../consultas/q"),
      "src/modulos/fiscal/consultas/q.ts": exporta,
    });
    expect(v).toContain("persistencia-sin-casos-de-uso");
  });

  it("la persistencia sí puede usar el dominio de su módulo, y los casos de uso y las consultas, la persistencia", async () => {
    const v = await violacionesDe({
      "src/modulos/fiscal/dominio/d.ts": exporta,
      "src/modulos/fiscal/persistencia/r.ts": importa("../dominio/d"),
      "src/modulos/fiscal/casos-de-uso/c.ts": [
        importa("../dominio/d"),
        importa("../persistencia/r"),
      ].join(""),
      "src/modulos/fiscal/consultas/q.ts": importa("../persistencia/r"),
    });
    expect(v).not.toContain("dominio-sin-persistencia");
    expect(v).not.toContain("persistencia-sin-casos-de-uso");
  });

  it("el ORM sí se puede importar en la persistencia de un módulo y en el adaptador de Postgres", async () => {
    const v = await violacionesDe({
      "src/modulos/empresas/persistencia/r.ts": 'import "kysely";\nexport const r = 1;\n',
      "src/adaptadores/postgres/a.ts": 'import "kysely";\nexport const a = 1;\n',
    });
    expect(v).not.toContain("orm-solo-en-persistencia");
  });

  it("marcas: la plataforma, las consultas y la puerta web sí entran por su publico.ts; el dominio usa capacidades y primitivas", async () => {
    const v = await violacionesDe({
      "src/primitivas/p.ts": exporta,
      "src/capacidades/vocabulario/v.ts": importa("../../primitivas/p"),
      "src/modulos/marcas/dominio/d.ts": importa("../../../capacidades/vocabulario/v"),
      "src/modulos/marcas/publico.ts": importa("./dominio/d"),
      "src/plataforma/p.ts": importa("../modulos/marcas/publico"),
      "src/consultas-de-grupo/g.ts": importa("../modulos/marcas/publico"),
      "apps/web/a.ts": importa("../../src/modulos/marcas/publico"),
    });
    expect(v).toEqual([]);
  });

  it("marcas: un módulo de negocio no la importa ni por publico.ts, pero la regla no alcanza a la propia marca", async () => {
    const dentro = await violacionesDe({
      "src/modulos/marcas/dominio/a.ts": exporta,
      "src/modulos/marcas/dominio/b.ts": importa("./a"),
    });
    expect(dentro).not.toContain("modulos-sin-marcas");
    const fuera = await violacionesDe({
      "src/modulos/identidad/dominio/d.ts": importa("../../marcas/publico"),
      "src/modulos/marcas/publico.ts": exporta,
    });
    expect(fuera).toContain("modulos-sin-marcas");
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

  describe("captación: el dominio puro de la solicitud de alta cumple las reglas del dominio de plataforma (R-C6)", () => {
    // Falla que previenen: un dominio de captación con Zod, con puertos, con el guard o con el plan, que
    // deje de ser puro y de poder probarse (y mutarse al 100 %) sin base ni framework. El fallo se
    // inyecta en la carpeta nueva: si alguien vuelve a angostar los patrones a `plataforma/dominio`,
    // estos casos dejan de fallar.
    const DOMINIO = "src/plataforma/captacion/dominio";

    it("no puede importar Zod, React ni Next", async () => {
      for (const paquete of ["zod", "react", "react-dom", "next"]) {
        const v = await violacionesDe({
          [`${DOMINIO}/d.ts`]: `import "${paquete}";\nexport const d = 1;\n`,
        });
        expect(v, paquete).toEqual(["plataforma-sin-framework"]);
      }
    });

    it("no puede importar puertos ni exigirAccion", async () => {
      const v = await violacionesDe({
        [`${DOMINIO}/d.ts`]: [
          importa("../../../puertos/q"),
          importa("../../../capacidades/permisos/exigir"),
        ].join(""),
        "src/puertos/q.ts": exporta,
        "src/capacidades/permisos/exigir.ts": exporta,
      });
      expect(v).toEqual(["plataforma-dominio-sin-puertos-ni-exigir"]);
    });

    it("no puede importar el guard, ni siquiera con la excepción de soporte/explicar", async () => {
      const v = await violacionesDe({
        [`${DOMINIO}/d.ts`]: importa("../../../capacidades/permisos/guard"),
        "src/capacidades/permisos/guard.ts": exporta,
      });
      expect(v).toEqual(["plataforma-dominio-sin-guard"]);
    });

    it("no pregunta por el plan del tenant", async () => {
      const v = await violacionesDe({
        [`${DOMINIO}/d.ts`]: importa("../../../capacidades/planes/derechos"),
        "src/capacidades/planes/derechos.ts": exporta,
      });
      expect(v).toEqual(["capacidades-de-planes-fuera-del-dominio"]);
    });

    it("sí puede usar las primitivas (resultado, CUIT, provincias) y sus propios archivos", async () => {
      const v = await violacionesDe({
        "src/primitivas/resultado/resultado.ts": exporta,
        "src/primitivas/domicilio/provincias.ts": exporta,
        [`${DOMINIO}/a.ts`]: importa("./b"),
        [`${DOMINIO}/b.ts`]: [
          importa("../../../primitivas/resultado/resultado"),
          importa("../../../primitivas/domicilio/provincias"),
        ].join(""),
      });
      expect(v).toEqual([]);
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

  describe("marcas y planes M2: derechos de uso y módulo de planes", () => {
    it("los casos de uso y las consultas de cualquier módulo, y la plataforma, sí piden capacidades/planes", async () => {
      const v = await violacionesDe({
        "src/capacidades/planes/niveles.ts": exporta,
        "src/modulos/empresas/casos-de-uso/c.ts": importa("../../../capacidades/planes/niveles"),
        "src/modulos/empresas/consultas/q.ts": importa("../../../capacidades/planes/niveles"),
        "src/plataforma/casos-de-uso/p.ts": importa("../../capacidades/planes/niveles"),
      });
      expect(v).toEqual([]);
    });

    it("el dominio de otro módulo y el dominio de plataforma no pueden, pero el del propio módulo de planes sí", async () => {
      const otros = await violacionesDe({
        "src/capacidades/planes/niveles.ts": exporta,
        "src/plataforma/dominio/d.ts": importa("../../capacidades/planes/niveles"),
      });
      expect(otros).toContain("capacidades-de-planes-fuera-del-dominio");
      const propio = await violacionesDe({
        "src/capacidades/planes/vigencia.ts": exporta,
        "src/modulos/planes/dominio/asignacion.ts": importa("../../../capacidades/planes/vigencia"),
      });
      expect(propio).toEqual([]);
    });

    it("marcas sí importa el módulo de planes por su publico.ts, y la plataforma también", async () => {
      const v = await violacionesDe({
        "src/modulos/planes/publico.ts": exporta,
        "src/modulos/marcas/casos-de-uso/c.ts": importa("../../planes/publico"),
        "src/plataforma/casos-de-uso/p.ts": importa("../../modulos/planes/publico"),
      });
      expect(v).toEqual([]);
    });
  });
});

/**
 * R-W0: `npm run arquitectura` y `npm run typecheck` cubren `apps` y `scripts`. Previene que las reglas
 * `apps-*` existan pero no corran sobre nada (hallazgo H4 del spec de la web). Chequeo: se lee el
 * comando real de `package.json` y se cruza, con esas mismas carpetas, un árbol con un import prohibido
 * bajo `apps/`; si alguien saca `apps` del comando, la violación deja de verse y la prueba falla.
 */
describe("R-W0: el comando de arquitectura alcanza a apps y scripts", () => {
  const paquete = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  const comando = paquete.scripts["arquitectura"] ?? "";
  // Las carpetas que recibe depcruise: todo lo que no es la opción `--config` ni su valor.
  const partes = comando.split(/\s+/).slice(1);
  const carpetasDelComando = partes.filter(
    (p, i) => p !== "" && p !== "--config" && partes[i - 1] !== "--config",
  );

  it("el comando cruza src, apps y scripts, y el typecheck incluye el tsconfig de la web", () => {
    expect(comando.startsWith("depcruise ")).toBe(true);
    expect(carpetasDelComando).toEqual(expect.arrayContaining(["src", "apps", "scripts"]));
    expect(paquete.scripts["typecheck"]).toContain("apps/web/tsconfig.json");
  });

  it("las extensiones de la configuración incluyen .tsx (las pantallas)", () => {
    const configuracion = require("../../.dependency-cruiser.cjs") as {
      options: { enhancedResolveOptions: { extensions: string[] } };
    };
    expect(configuracion.options.enhancedResolveOptions.extensions).toContain(".tsx");
  });

  it("un import prohibido en un archivo bajo apps/ se ve con las carpetas del comando", async () => {
    const base = mkdtempSync(join(tmpdir(), "zuluhub-arq-"));
    directorios.push(base);
    const archivos: Archivos = {
      "src/adaptadores/postgres/a.ts": exporta,
      "apps/web/prueba.ts": importa("../../src/adaptadores/postgres/a"),
      "scripts/vacio.ts": exporta,
    };
    for (const [ruta, contenido] of Object.entries(archivos)) {
      mkdirSync(dirname(join(base, ruta)), { recursive: true });
      writeFileSync(join(base, ruta), contenido);
    }
    const resultado = await cruise(
      carpetasDelComando,
      { baseDir: base, validate: true, ruleSet: { forbidden: reglas }, tsPreCompilationDeps: true },
      { extensions: [".ts", ".js"] },
    );
    if (typeof resultado.output === "string") throw new Error("salida inesperada");
    const nombres = resultado.output.summary.violations.map((v) => v.rule.name);
    expect(nombres).toContain("apps-sin-persistencia-ni-adaptadores");
  });
});

/**
 * R-W9: sin metadatos estáticos globales en `apps/<app>/app/` ni en `apps/<app>/public/`. Previene que todas
 * las marcas compartan el mismo ícono, `robots.txt` o manifiesto (el plan de marca los resuelve por
 * host con la API de metadatos dinámica: `icon.tsx`, `robots.ts`, `manifest.ts`, que sí se permiten).
 * Chequeo: la función se prueba con archivos de verdad en un árbol temporal y se aplica al repo real.
 */
const METADATO_ESTATICO =
  /^(favicon\.ico|icon\d*\.(ico|jpe?g|png|svg)|apple-icon\d*\.(jpe?g|png)|(opengraph|twitter)-image\d*\.(jpe?g|png|gif)|robots\.txt|sitemap\.xml|manifest\.(json|webmanifest))$/i;

function metadatosEstaticosGlobales(raiz: string): string[] {
  const encontrados: string[] = [];
  const apps = join(raiz, "apps");
  if (!existsSync(apps)) return encontrados;
  for (const app of readdirSync(apps, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    for (const carpeta of ["app", "public"]) {
      const base = join(apps, app.name, carpeta);
      if (!existsSync(base)) continue;
      for (const f of readdirSync(base, { recursive: true, encoding: "utf8" })) {
        const nombre = f.split(/[\\/]/).pop() ?? "";
        if (METADATO_ESTATICO.test(nombre)) encontrados.push(`apps/${app.name}/${carpeta}/${f}`);
      }
    }
  }
  return encontrados.sort();
}

describe("R-W9: sin metadatos estáticos globales en apps", () => {
  const arbol = (archivos: string[]): string => {
    const base = mkdtempSync(join(tmpdir(), "zuluhub-w9-"));
    directorios.push(base);
    for (const ruta of archivos) {
      mkdirSync(dirname(join(base, ruta)), { recursive: true });
      writeFileSync(join(base, ruta), "x");
    }
    return base;
  };

  it("el repositorio real no tiene ninguno", () => {
    expect(metadatosEstaticosGlobales(".")).toEqual([]);
  });

  it.each([
    "apps/web/app/favicon.ico",
    "apps/web/app/icon.png",
    "apps/web/app/icon1.svg",
    "apps/web/app/apple-icon.png",
    "apps/web/app/opengraph-image.jpg",
    "apps/web/app/twitter-image.png",
    "apps/web/app/robots.txt",
    "apps/web/app/sitemap.xml",
    "apps/web/app/manifest.json",
    "apps/web/app/manifest.webmanifest",
    "apps/web/app/s/landing/icon.ico",
    "apps/web/public/robots.txt",
    "apps/web/public/favicon.ico",
    "apps/plataforma/app/Favicon.ICO",
  ])("detecta %s", (ruta) => {
    expect(metadatosEstaticosGlobales(arbol([ruta]))).toEqual([ruta]);
  });

  it("deja pasar las versiones dinámicas y los archivos comunes", () => {
    const base = arbol([
      "apps/web/app/icon.tsx",
      "apps/web/app/robots.ts",
      "apps/web/app/sitemap.ts",
      "apps/web/app/manifest.ts",
      "apps/web/app/layout.tsx",
      "apps/web/app/s/neutra/page.tsx",
      "apps/web/public/logo.png",
      "apps/web/package.json",
    ]);
    expect(metadatosEstaticosGlobales(base)).toEqual([]);
  });
});

/**
 * R-W2, R-W4 y R-W5 (W1): quién puede importar la composición, qué no puede importar un archivo de
 * cliente y qué es `formas.ts`. Cada regla de dependencias tiene su violación inyectada en `casos`
 * (arriba); acá van los casos permitidos que no deben dispararla.
 */
describe("R-W2: la composición solo se importa desde apps/web/servidor", () => {
  it("el servidor de la app sí la importa", async () => {
    const v = await violacionesDe({
      "src/composicion/web.ts": exporta,
      "apps/web/servidor/composicion.ts": importa("../../../src/composicion/web"),
    });
    expect(v).toEqual([]);
  });

  it("también se prohíbe desde un archivo de apps que no es .tsx (el proxy, un handler)", async () => {
    const v = await violacionesDe({
      "src/composicion/web.ts": exporta,
      "apps/web/proxy.ts": importa("../../src/composicion/web"),
    });
    expect(v).toContain("composicion-solo-desde-servidor-de-apps");
  });

  it("un .tsx de otro lado tampoco, y la composición puede importar lo suyo", async () => {
    const v = await violacionesDe({
      "src/composicion/web.ts": importa("./entorno"),
      "src/composicion/entorno.ts": exporta,
      "src/modulos/empresas/ui.tsx": importa("../../composicion/web"),
    });
    expect(v).toContain("composicion-solo-desde-servidor-de-apps");
  });
});

describe("R-W4: los archivos de cliente no importan nada del servidor", () => {
  it.each([
    [
      "publico.ts de un módulo",
      "src/modulos/empresas/publico.ts",
      "../../../../../../src/modulos/empresas/publico",
    ],
    ["la composición", "src/composicion/web.ts", "../../../../../../src/composicion/web"],
    ["un adaptador", "src/adaptadores/correo/a.ts", "../../../../../../src/adaptadores/correo/a"],
  ])("no importan %s", async (_nombre, destino, ruta) => {
    const v = await violacionesDe({
      [destino]: exporta,
      "apps/web/app/s/app/x/boton.cliente.tsx": importa(ruta),
    });
    expect(v).toContain("cliente-sin-servidor");
  });

  it("sí importan formas.ts, primitivas, capacidades y otros archivos de cliente", async () => {
    const v = await violacionesDe({
      "src/modulos/empresas/formas.ts": exporta,
      "src/primitivas/p.ts": exporta,
      "src/capacidades/vocabulario/v.ts": exporta,
      "apps/web/ui/otro.cliente.tsx": exporta,
      "apps/web/app/s/app/boton.cliente.tsx": [
        importa("../../../../../src/modulos/empresas/formas"),
        importa("../../../../../src/primitivas/p").replace("y =", "y2 ="),
        importa("../../../../../src/capacidades/vocabulario/v").replace("y =", "y3 ="),
        importa("../../../ui/otro.cliente").replace("y =", "y4 ="),
      ].join(""),
    });
    expect(v).toEqual([]);
  });

  it("un archivo de servidor sí importa lo del servidor (la regla es solo de los .cliente.tsx)", async () => {
    const v = await violacionesDe({
      "src/modulos/empresas/publico.ts": exporta,
      "apps/web/servidor/consulta.ts": importa("../../../src/modulos/empresas/publico"),
    });
    expect(v).toEqual([]);
  });
});

describe("R-W5: formas.ts es una entrada admitida y no tiene negocio", () => {
  it("la pantalla y la composición importan formas.ts sin pasar por publico.ts", async () => {
    const v = await violacionesDe({
      "src/modulos/empresas/formas.ts": exporta,
      "apps/web/app/s/app/page.ts": importa("../../../../../src/modulos/empresas/formas"),
      "src/composicion/web.ts": importa("../modulos/empresas/formas"),
    });
    expect(v).toEqual([]);
  });

  it("el resto del módulo sigue cerrado: dominio, casos de uso y persistencia siguen prohibidos", async () => {
    const v = await violacionesDe({
      "src/modulos/empresas/dominio/d.ts": exporta,
      "apps/web/app/s/app/page.ts": importa("../../../../../src/modulos/empresas/dominio/d"),
    });
    expect(v).toContain("modulos-solo-por-publico-desde-afuera");
  });

  it("otro módulo no importa las formas de este: entre módulos solo publico.ts", async () => {
    const v = await violacionesDe({
      "src/modulos/empresas/formas.ts": exporta,
      "src/modulos/identidad/casos-de-uso/c.ts": importa("../../empresas/formas"),
    });
    expect(v).toContain("modulos-solo-por-publico");
  });

  it.each([
    ["publico.ts del propio módulo", "src/modulos/empresas/publico.ts", "./publico"],
    ["un caso de uso", "src/modulos/empresas/casos-de-uso/c.ts", "./casos-de-uso/c"],
    ["la persistencia", "src/modulos/empresas/persistencia/r.ts", "./persistencia/r"],
    ["una capacidad", "src/capacidades/vocabulario/v.ts", "../../capacidades/vocabulario/v"],
    ["un puerto", "src/puertos/p.ts", "../../puertos/p"],
  ])("formas.ts no importa %s", async (_nombre, destino, ruta) => {
    const v = await violacionesDe({
      [destino]: exporta,
      "src/modulos/empresas/formas.ts": importa(ruta),
    });
    expect(v).toContain("formas-sin-negocio");
  });

  it("formas.ts sí importa zod y primitivas", async () => {
    const v = await violacionesDe({
      "src/primitivas/identificadores/marca.ts": exporta,
      "src/modulos/empresas/formas.ts":
        'import { z } from "zod";\n' +
        importa("../../primitivas/identificadores/marca").replace("y =", "y2 =") +
        "export const f = z;\n",
    });
    expect(v).toEqual([]);
  });

  it("formas.ts no importa módulos de node", async () => {
    const v = await violacionesDe({
      "src/modulos/empresas/formas.ts":
        'import { join } from "node:path";\nexport const f = join;\n',
    });
    expect(v).toContain("formas-sin-negocio");
  });
});

/**
 * Convenciones de archivos de `apps/` que ninguna regla de dependencias ve (W1). Se prueban con
 * archivos de verdad en un árbol temporal y se aplican al repositorio real.
 *  - Todo archivo con la directiva "use client" lleva el sufijo `.cliente.tsx` (R-W4): sin él, la
 *    regla `cliente-sin-servidor` no lo alcanzaría y un componente de cliente podría importar el servidor.
 *  - Todo archivo de `apps/<app>/servidor/` empieza con `import "server-only";`: si un componente de
 *    cliente lo importa, la compilación falla en vez de empaquetar secretos o persistencia.
 */
// Recorrido lineal (sin expresión regular con repeticiones anidadas, que CodeQL marca como ReDoS):
// salta espacios y comentarios iniciales y mira si lo primero es la directiva.
function tieneDirectivaDeCliente(texto: string): boolean {
  let i = 0;
  for (;;) {
    while (i < texto.length && /\s/.test(texto.charAt(i))) i += 1;
    if (texto.startsWith("//", i)) {
      const fin = texto.indexOf("\n", i);
      if (fin === -1) return false;
      i = fin + 1;
    } else if (texto.startsWith("/*", i)) {
      const fin = texto.indexOf("*/", i + 2);
      if (fin === -1) return false;
      i = fin + 2;
    } else {
      break;
    }
  }
  return texto.startsWith('"use client"', i) || texto.startsWith("'use client'", i);
}

function archivosDeApps(raiz: string): string[] {
  const apps = join(raiz, "apps");
  if (!existsSync(apps)) return [];
  return readdirSync(apps, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/(^|[\\/])(node_modules|\.next)[\\/]/.test(f))
    .map((f) => f.replaceAll("\\", "/"))
    .sort();
}

function archivosDeClienteSinSufijo(raiz: string): string[] {
  return archivosDeApps(raiz)
    .filter(
      (f) =>
        !f.endsWith(".cliente.tsx") &&
        tieneDirectivaDeCliente(readFileSync(join(raiz, "apps", f), "utf8")),
    )
    .map((f) => `apps/${f}`);
}

function archivosDeServidorSinServerOnly(raiz: string): string[] {
  return archivosDeApps(raiz)
    .filter((f) => /^[^/]+\/servidor\//.test(f))
    .filter((f) => primeraLineaDeCodigo(join(raiz, "apps", f)) !== 'import "server-only";')
    .map((f) => `apps/${f}`);
}

// Stryker antepone `// @ts-nocheck` a los archivos de su sandbox: esa línea no cuenta como código.
function primeraLineaDeCodigo(ruta: string): string | undefined {
  return readFileSync(ruta, "utf8")
    .split("\n")
    .find((linea) => linea !== "// @ts-nocheck");
}

describe("convenciones de apps: use client con sufijo y server-only en el servidor", () => {
  const arbol = (archivos: Record<string, string>): string => {
    const base = mkdtempSync(join(tmpdir(), "zuluhub-conv-"));
    directorios.push(base);
    for (const [ruta, contenido] of Object.entries(archivos)) {
      mkdirSync(dirname(join(base, ruta)), { recursive: true });
      writeFileSync(join(base, ruta), contenido);
    }
    return base;
  };

  it("el repositorio real las cumple", () => {
    expect(archivosDeClienteSinSufijo(".")).toEqual([]);
    expect(archivosDeServidorSinServerOnly(".")).toEqual([]);
    expect(archivosDeApps(".")).toContain("web/servidor/composicion.ts");
  });

  it.each([
    ['"use client";\nexport const a = 1;\n'],
    ["'use client'\nexport const a = 1;\n"],
    ['// comentario\n"use client";\nexport const a = 1;\n'],
    ['/* bloque\n   de varias líneas */\n\n"use client";\nexport const a = 1;\n'],
  ])("detecta un archivo con la directiva y sin el sufijo: %j", (contenido) => {
    const base = arbol({ "apps/web/app/panel.tsx": contenido, "apps/web/app/otro.ts": contenido });
    expect(archivosDeClienteSinSufijo(base)).toEqual([
      "apps/web/app/otro.ts",
      "apps/web/app/panel.tsx",
    ]);
  });

  it("no marca los .cliente.tsx, ni los archivos sin la directiva, ni un texto que solo la menciona", () => {
    const base = arbol({
      "apps/web/app/panel.cliente.tsx": '"use client";\nexport const a = 1;\n',
      "apps/web/app/servidor.tsx": "export const a = 1;\n",
      "apps/web/app/menciona.tsx": 'export const a = 1;\nexport const t = "use client";\n',
      "apps/web/app/node_modules/x/y.tsx": '"use client";\n',
    });
    expect(archivosDeClienteSinSufijo(base)).toEqual([]);
  });

  it("detecta un archivo de servidor sin server-only como primera línea", () => {
    const base = arbol({
      "apps/web/servidor/bien.ts": 'import "server-only";\nexport const a = 1;\n',
      "apps/web/servidor/sub/mal.ts": 'export const a = 1;\nimport "server-only";\n',
      "apps/web/servidor/comentario.ts": '// server-only\nimport "server-only";\n',
      "apps/web/servidor/pantalla.tsx": "export const a = 1;\n",
      "apps/web/otro/libre.ts": "export const a = 1;\n",
    });
    expect(archivosDeServidorSinServerOnly(base)).toEqual([
      "apps/web/servidor/comentario.ts",
      "apps/web/servidor/pantalla.tsx",
      "apps/web/servidor/sub/mal.ts",
    ]);
  });
});

/**
 * R-W6 y R-W7 (interfaz base). R-W6 previene íconos sueltos sin nombre accesible y un juego de íconos
 * repartido por toda la web: `lucide-react` solo entra por `apps/web/ui/iconos/`. R-W7 previene un
 * componente que sabe de un módulo o de una pantalla: la interfaz base (capas 1 a 5) no los conoce.
 * Chequeo: los casos de arriba (`casos`) los rompen a propósito; acá, lo que SÍ está permitido y las
 * otras formas de romperlas.
 */
describe("R-W6 y R-W7: la interfaz base", () => {
  it("la puerta de íconos sí importa lucide-react; los componentes de ui, la puerta", async () => {
    const v = await violacionesDeLaPuertaDeIconos();
    expect(v).toEqual([]);
  });

  it("una pantalla o cualquier carpeta de src no puede importar lucide-react", async () => {
    for (const origen of [
      "apps/web/pantallas/inicio.ts",
      "apps/web/app/pagina.ts",
      "apps/web/ui/componentes/boton.ts",
      "apps/web/ui/patrones/aviso.ts",
      "src/capacidades/icono.ts",
    ]) {
      const v = await violacionesDe({ [origen]: importa("lucide-react") });
      expect(v, origen).toContain("iconos-solo-por-su-puerta");
    }
  });

  it("también se ve el import de un archivo interno del paquete", async () => {
    const v = await violacionesDe({
      "apps/web/ui/componentes/boton.ts": importa("lucide-react/dist/esm/icons/x"),
    });
    expect(v).toContain("iconos-solo-por-su-puerta");
  });

  it("ui no importa pantallas, servidor ni ningún módulo (ni por su publico.ts)", async () => {
    for (const destino of [
      ["apps/web/pantallas/p.ts", "../../pantallas/p"],
      ["apps/web/servidor/s.ts", "../../servidor/s"],
      ["src/modulos/fiscal/publico.ts", "../../../../src/modulos/fiscal/publico"],
    ] as const) {
      const v = await violacionesDe({
        "apps/web/ui/componentes/c.ts": importa(destino[1]),
        [destino[0]]: exporta,
      });
      expect(v, destino[0]).toContain("ui-sin-pantallas-ni-modulos");
    }
  });

  it("ui sí usa las primitivas y las capacidades, y la pantalla sí usa ui", async () => {
    const v = await violacionesDe({
      "src/primitivas/dinero/importe.ts": exporta,
      "src/capacidades/experiencia/importe-tipeado.ts": importa("../../primitivas/dinero/importe"),
      "apps/web/ui/componentes/campo-importe.ts": importa(
        "../../../../src/capacidades/experiencia/importe-tipeado",
      ),
      "apps/web/pantallas/venta.ts": importa("../ui/componentes/campo-importe"),
    });
    expect(v).toEqual([]);
  });
});

async function violacionesDeLaPuertaDeIconos(): Promise<string[]> {
  return violacionesDe({
    "apps/web/ui/iconos/catalogo.ts": importa("lucide-react"),
    "apps/web/ui/componentes/boton.ts": importa("../iconos/catalogo"),
  });
}
