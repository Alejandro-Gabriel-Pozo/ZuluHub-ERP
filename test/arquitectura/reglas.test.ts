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
  const base = mkdtempSync(join(tmpdir(), "pedernal-arq-"));
  directorios.push(base);
  for (const [ruta, contenido] of Object.entries(archivos)) {
    const destino = join(base, ruta);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, contenido);
  }
  const resultado = await cruise(
    ["src", "apps", "scripts"].filter((c) =>
      Object.keys(archivos).some((r) => r.startsWith(`${c}/`)),
    ),
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
      regla: "src-sin-apps",
      archivos: {
        "src/composicion/a.ts": importa("../../apps/web/servidor/b"),
        "apps/web/servidor/b.ts": exporta,
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
    {
      regla: "fiscal-sin-negocio-ajeno",
      archivos: {
        "src/modulos/fiscal/dominio/d.ts": importa("../../ventas/publico"),
        "src/modulos/ventas/publico.ts": exporta,
      },
    },
    {
      regla: "arca-solo-en-su-adaptador",
      archivos: {
        "src/modulos/fiscal/dominio/d.ts": importa("pkijs"),
      },
    },
    {
      regla: "qr-solo-en-la-autenticacion-de-plataforma",
      archivos: {
        "src/adaptadores/autenticacion/opciones.ts": importa("qrcode-generator"),
      },
    },
    {
      regla: "adaptador-arca-solo-con-fiscal",
      archivos: {
        "src/adaptadores/arca/a.ts": importa("../../modulos/identidad/publico"),
        "src/modulos/identidad/publico.ts": exporta,
      },
    },
    {
      regla: "better-auth-solo-en-su-adaptador",
      archivos: {
        "apps/web/servidor/ingreso.ts": importa("better-auth"),
      },
    },
    {
      regla: "error-de-next-sin-servidor",
      archivos: {
        "apps/web/app/s/app/error.tsx": importa("../../../servidor/composicion"),
        "apps/web/servidor/composicion.ts": exporta,
      },
    },
    {
      regla: "plataforma-sin-correo",
      archivos: {
        "src/plataforma/casos-de-uso/c.ts": importa("../../puertos/correo"),
        "src/puertos/correo.ts": exporta,
      },
    },
    {
      regla: "plataforma-solo-desde-scripts",
      archivos: {
        "apps/web/servidor/composicion.ts": importa("../../../src/composicion/plataforma"),
        "src/composicion/plataforma.ts": exporta,
      },
    },
    {
      regla: "puerta-de-consola-solo-desde-la-consola",
      archivos: {
        "apps/web/servidor/composicion.ts": importa("../../../src/composicion/puerta-de-consola"),
        "src/composicion/puerta-de-consola.ts": exporta,
      },
    },
    {
      regla: "ingreso-de-consola-solo-desde-la-consola",
      archivos: {
        "apps/web/servidor/composicion.ts": importa("../../../src/composicion/ingreso-de-consola"),
        "src/composicion/ingreso-de-consola.ts": exporta,
      },
    },
    {
      regla: "plataforma-solo-importa-la-interfaz-de-la-web",
      archivos: {
        "apps/plataforma/servidor/a.ts": importa("../../web/servidor/sesion"),
        "apps/web/servidor/sesion.ts": exporta,
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

  it("un comando de scripts/ no abre su propia conexión: importar pg o kysely directo viola orm-solo-en-persistencia", async () => {
    for (const herramienta of ["pg", "kysely"]) {
      const v = await violacionesDe({
        "scripts/migrar.ts": `import "${herramienta}";\nexport const m = 1;\n`,
      });
      expect(v).toContain("orm-solo-en-persistencia");
    }
  });

  it("un comando de scripts/ sí puede usar el adaptador de Postgres (pero no el ORM directo)", async () => {
    const v = await violacionesDe({
      "src/adaptadores/postgres/a.ts": 'import "pg";\nexport const a = 1;\n',
      "scripts/migrar.ts": importa("../src/adaptadores/postgres/a"),
    });
    expect(v).toEqual([]);
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
  // El script encadena el guardián de contratos con `&&`: acá interesa solo la parte de depcruise.
  const comando = (paquete.scripts["arquitectura"] ?? "").split("&&")[0]?.trim() ?? "";
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
    const base = mkdtempSync(join(tmpdir(), "pedernal-arq-"));
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
    const base = mkdtempSync(join(tmpdir(), "pedernal-w9-"));
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

/**
 * Next obliga a que el límite de errores se llame `error.tsx` / `global-error.tsx` y lleve la directiva:
 * no puede terminar en `.cliente.tsx`. Se admite solo si es la directiva y UNA reexportación de un
 * componente `.cliente` (sin lógica, sin importar nada más): la regla `error-de-next-sin-servidor` lo
 * trata como cliente. Previene que la excepción se use para esconder un componente de cliente sin sufijo.
 */
const REEXPORTACION_DE_CLIENTE =
  /^\s*"use client";\s*export \{ \w+ as default \} from "[^"]+\.cliente";\s*$/;
// Stryker antepone `// @ts-nocheck` a los archivos de su sandbox: esa línea no cuenta como código.
const ENCABEZADO_DE_STRYKER = "// @ts-nocheck\n";
function esErrorDeNextMinimo(f: string, contenido: string): boolean {
  const tramos = f.split("/");
  const nombre = tramos[tramos.length - 1];
  const esDeNext = tramos[1] === "app" && (nombre === "error.tsx" || nombre === "global-error.tsx");
  const codigo = contenido.startsWith(ENCABEZADO_DE_STRYKER)
    ? contenido.slice(ENCABEZADO_DE_STRYKER.length)
    : contenido;
  return esDeNext && REEXPORTACION_DE_CLIENTE.test(codigo);
}

function archivosDeClienteSinSufijo(raiz: string): string[] {
  return archivosDeApps(raiz)
    .filter((f) => {
      const contenido = readFileSync(join(raiz, "apps", f), "utf8");
      return (
        !f.endsWith(".cliente.tsx") &&
        !esErrorDeNextMinimo(f, contenido) &&
        tieneDirectivaDeCliente(contenido)
      );
    })
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
    const base = mkdtempSync(join(tmpdir(), "pedernal-conv-"));
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

describe("facturación F1: el facturador funciona solo (spec H7 facturación §B.0 y §B.9)", () => {
  it("fiscal no importa ventas, caja, catálogo, clientes ni stock, ni por su publico.ts", async () => {
    for (const modulo of ["ventas", "caja", "catalogo", "clientes", "stock"]) {
      const v = await violacionesDe({
        "src/modulos/fiscal/casos-de-uso/c.ts": importa(`../../${modulo}/publico`),
        [`src/modulos/${modulo}/publico.ts`]: exporta,
      });
      expect(v, modulo).toContain("fiscal-sin-negocio-ajeno");
    }
  });

  it("fiscal sí usa los módulos de base (identidad, empresas) y los demás módulos sí usan fiscal por su publico.ts", async () => {
    const v = await violacionesDe({
      "src/modulos/empresas/publico.ts": exporta,
      "src/modulos/fiscal/dominio/d.ts": exporta,
      "src/modulos/fiscal/casos-de-uso/c.ts": importa("../dominio/d"),
      "src/modulos/fiscal/publico.ts": importa("./casos-de-uso/c"),
      "src/modulos/ventas/casos-de-uso/v.ts": importa("../../fiscal/publico"),
    });
    expect(v).not.toContain("fiscal-sin-negocio-ajeno");
  });
});

describe("facturación F6: las consultas del facturador (spec H7 facturación §B.4.9 y §B.7)", () => {
  it("una consulta de fiscal importa el modelo de impresión, pero ningún otro archivo del dominio", async () => {
    const permitido = await violacionesDe({
      "src/modulos/fiscal/dominio/modelo-de-impresion.ts": exporta,
      "src/modulos/fiscal/consultas/c.ts": importa("../dominio/modelo-de-impresion"),
    });
    expect(permitido).not.toContain("consultas-sin-dominio");
    const prohibido = await violacionesDe({
      "src/modulos/fiscal/dominio/comprobante-nuevo.ts": exporta,
      "src/modulos/fiscal/consultas/c.ts": importa("../dominio/comprobante-nuevo"),
    });
    expect(prohibido).toContain("consultas-sin-dominio");
  });

  it("una consulta de fiscal importa la acreditación (D-16), pero ningún otro archivo del dominio", async () => {
    const permitido = await violacionesDe({
      "src/modulos/fiscal/dominio/acreditacion.ts": exporta,
      "src/modulos/fiscal/consultas/c.ts": importa("../dominio/acreditacion"),
    });
    expect(permitido).not.toContain("consultas-sin-dominio");
    const prohibido = await violacionesDe({
      "src/modulos/fiscal/dominio/acreditacion-de-otra-cosa.ts": exporta,
      "src/modulos/fiscal/consultas/c.ts": importa("../dominio/acreditacion-de-otra-cosa"),
    });
    expect(prohibido).toContain("consultas-sin-dominio");
  });

  it("la excepción es solo de fiscal: el modelo de impresión y la acreditación de otro módulo siguen prohibidos", async () => {
    const v = await violacionesDe({
      "src/modulos/empresas/dominio/modelo-de-impresion.ts": exporta,
      "src/modulos/empresas/dominio/acreditacion.ts": exporta,
      "src/modulos/empresas/consultas/c.ts": importa("../dominio/modelo-de-impresion"),
      "src/modulos/empresas/consultas/d.ts": importa("../dominio/acreditacion"),
    });
    expect(v).toContain("consultas-sin-dominio");
  });
});

describe("facturación F8: el adaptador real de ARCA (spec H7 facturación §B.5.7 y §B.9)", () => {
  const PAQUETES = ["pkijs", "asn1js", "fast-xml-parser"];

  it("solo los adaptadores de ARCA y de certificados importan pkijs, asn1js y fast-xml-parser", async () => {
    for (const paquete of PAQUETES) {
      for (const ruta of [
        "src/adaptadores/arca/firma.ts",
        "src/adaptadores/certificados/lector.ts",
      ]) {
        const permitido = await violacionesDe({ [ruta]: importa(paquete) });
        expect(permitido, `${paquete} desde ${ruta}`).not.toContain("arca-solo-en-su-adaptador");
      }
    }
  });

  it("el dominio, los casos de uso, otro adaptador, las apps y los scripts no los importan", async () => {
    for (const paquete of PAQUETES) {
      for (const ruta of [
        "src/modulos/fiscal/dominio/d.ts",
        "src/modulos/fiscal/casos-de-uso/c.ts",
        "src/modulos/fiscal/persistencia/p.ts",
        "src/adaptadores/correo/a.ts",
        "src/composicion/c.ts",
        "src/primitivas/p.ts",
        "apps/web/servidor/s.ts",
        "scripts/s.ts",
      ]) {
        const v = await violacionesDe({ [ruta]: importa(paquete) });
        expect(v, `${paquete} desde ${ruta}`).toContain("arca-solo-en-su-adaptador");
      }
    }
  });

  it("también se ve el import de un archivo interno del paquete", async () => {
    const v = await violacionesDe({
      "src/modulos/fiscal/dominio/d.ts": importa("fast-xml-parser/src/fxp"),
    });
    expect(v).toContain("arca-solo-en-su-adaptador");
  });

  it("el adaptador de ARCA solo importa fiscal por su publico.ts", async () => {
    const permitido = await violacionesDe({
      "src/modulos/fiscal/publico.ts": exporta,
      "src/adaptadores/arca/a.ts": importa("../../modulos/fiscal/publico"),
    });
    expect(permitido).not.toContain("adaptador-arca-solo-con-fiscal");
    expect(permitido).not.toContain("modulos-solo-por-publico-desde-afuera");
  });

  it("no importa los archivos internos de fiscal ni ningún otro módulo, ni siquiera por su publico.ts", async () => {
    const internos = await violacionesDe({
      "src/modulos/fiscal/dominio/d.ts": exporta,
      "src/adaptadores/arca/a.ts": importa("../../modulos/fiscal/dominio/d"),
    });
    expect(internos).toContain("adaptador-arca-solo-con-fiscal");
    for (const modulo of ["identidad", "empresas", "tenants", "ventas"]) {
      const v = await violacionesDe({
        [`src/modulos/${modulo}/publico.ts`]: exporta,
        "src/adaptadores/arca/a.ts": importa(`../../modulos/${modulo}/publico`),
      });
      expect(v, modulo).toContain("adaptador-arca-solo-con-fiscal");
    }
  });

  it("tampoco lee la base por su cuenta: la herramienta de datos sigue prohibida ahí", async () => {
    const v = await violacionesDe({ "src/adaptadores/arca/a.ts": importa("kysely") });
    expect(v).toContain("orm-solo-en-persistencia");
  });

  it("otro adaptador sí puede importar fiscal por publico.ts: la regla es solo del adaptador de ARCA", async () => {
    const v = await violacionesDe({
      "src/modulos/fiscal/publico.ts": exporta,
      "src/modulos/identidad/publico.ts": exporta,
      "src/adaptadores/correo/a.ts": importa("../../modulos/identidad/publico"),
    });
    expect(v).not.toContain("adaptador-arca-solo-con-fiscal");
  });
});

/**
 * C-2 (D10): ningún `font-size` en `px` dentro de `apps/web/ui/plantillas/carta`. Previene que un CSS de la
 * carta fije la letra e ignore el tamaño del celular del comensal y el control «Letra» (ESLint no mira CSS:
 * la parte de JavaScript es el bloque `web/carta-sin-px-de-letra`). Chequeo: las violaciones inyectadas de acá
 * y la aplicación al repositorio real. Se prohíbe también `font:` abreviado y `calc()` con px.
 */
function tamanosDeLetraEnPx(css: string): string[] {
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...sinComentarios.matchAll(/(?:^|[;{\s])(font(?:-size)?\s*:\s*[^;}]*)/gi)]
    .map((m) => (m[1] ?? "").trim())
    .filter((declaracion) => /\d\s*px\b/i.test(declaracion));
}

function archivosCssDeLaCarta(raiz: string): string[] {
  const carpeta = join(raiz, "apps/web/ui/plantillas/carta");
  if (!existsSync(carpeta)) return [];
  return readdirSync(carpeta, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".css"))
    .map((f) => f.replaceAll("\\", "/"))
    .sort();
}

function cssDeLaCartaConPx(raiz: string): string[] {
  return archivosCssDeLaCarta(raiz).filter(
    (f) =>
      tamanosDeLetraEnPx(readFileSync(join(raiz, "apps/web/ui/plantillas/carta", f), "utf8"))
        .length > 0,
  );
}

describe("C-2: la plantilla de la carta no fija la letra en px (D10)", () => {
  it.each([
    ["font-size", ".a { font-size: 18px; }"],
    ["font-size con decimales y mayúsculas", ".a { FONT-SIZE: 17.5PX; }"],
    ["font-size con espacio", ".a{font-size:18 px}"],
    ["font abreviado", ".a { font: 600 18px/1.4 system-ui; }"],
    ["calc con px", ".a { font-size: calc(1rem + 2px); }"],
    [
      "en una regla anidada o dentro de un @media",
      "@media (min-width: 48rem) {\n  .a { font-size: 20px; }\n}",
    ],
  ])("detecta %s", (_nombre, css) => {
    expect(tamanosDeLetraEnPx(css)).toHaveLength(1);
  });

  it.each([
    ["rem", ".a { font-size: 1.125rem; }"],
    ["em", ".a { font-size: 0.9em; }"],
    ["un token", ".a { font-size: var(--tipo-tamano-base); }"],
    ["otras propiedades en px", ".a { border: 1px solid; width: 72px; line-height: 20px; }"],
    ["font-family y font-weight", ".a { font-family: system-ui; font-weight: 600; }"],
    ["un comentario que lo nombra", "/* antes era font-size: 18px */ .a { color: red; }"],
  ])("deja pasar %s", (_nombre, css) => {
    expect(tamanosDeLetraEnPx(css)).toEqual([]);
  });

  it("encuentra el CSS de la carta en el árbol y marca el que tiene px", () => {
    const base = mkdtempSync(join(tmpdir(), "pedernal-letra-"));
    directorios.push(base);
    const carpeta = join(base, "apps/web/ui/plantillas/carta");
    mkdirSync(carpeta, { recursive: true });
    writeFileSync(join(carpeta, "bien.module.css"), ".a { font-size: 1em; }");
    writeFileSync(join(carpeta, "mal.module.css"), ".a { font-size: 18px; }");
    mkdirSync(join(base, "apps/web/ui/componentes"), { recursive: true });
    writeFileSync(join(base, "apps/web/ui/componentes/otro.module.css"), ".a { font-size: 14px; }");
    expect(cssDeLaCartaConPx(base)).toEqual(["mal.module.css"]);
  });

  it("el repositorio real la cumple y tiene CSS de la carta que revisar", () => {
    expect(archivosCssDeLaCarta(".").length).toBeGreaterThanOrEqual(8);
    expect(cssDeLaCartaConPx(".")).toEqual([]);
  });
});

/**
 * W3b (autenticación). `better-auth` solo entra por su adaptador: el resto usa el puerto. Y el adaptador de
 * autenticación no importa la herramienta de datos (`kysely`, `pg`): el Kysely del rol de autenticación lo
 * crea solo `adaptadores/postgres/conexion-de-autenticacion.ts` y llega armado desde la composición. La
 * segunda ya la da `orm-solo-en-persistencia`; acá se fija que cubre también a esta carpeta.
 */
describe("W3b: la librería de ingreso y la herramienta de datos", () => {
  it("better-auth lo importa el adaptador de autenticación, y nadie más", async () => {
    const v = await violacionesDe({
      "src/adaptadores/autenticacion/instancia.ts": importa("better-auth"),
      "src/adaptadores/autenticacion/opciones.ts": importa("better-auth/api"),
      "src/adaptadores/autenticacion/migracion.ts": importa("@better-auth/core/db"),
    });
    expect(v).toEqual([]);
  });

  it.each([
    ["una acción o ruta de la web", "apps/web/servidor/ingreso.ts", "better-auth"],
    ["una ruta de la web", "apps/web/app/api/auth/ruta.ts", "better-auth/api"],
    ["la composición", "src/composicion/web.ts", "better-auth"],
    ["un módulo de negocio", "src/modulos/identidad/casos-de-uso/ingresar.ts", "better-auth"],
    ["otro adaptador", "src/adaptadores/postgres/sesion.ts", "better-auth/db/migration"],
    ["un puerto", "src/puertos/autenticacion.ts", "better-auth"],
    ["una capacidad", "src/capacidades/autenticacion/vigencia.ts", "better-auth"],
    ["un paquete de la librería", "src/composicion/ingreso.ts", "@better-auth/core"],
  ])("%s no puede importarlo (%s -> %s)", async (_nombre, origen, paquete) => {
    const v = await violacionesDe({ [origen]: importa(paquete) });
    expect(v).toContain("better-auth-solo-en-su-adaptador");
  });

  it("las pruebas y los scripts no entran en la regla (los usa quien genera o revisa el SQL de la librería)", async () => {
    const v = await violacionesDe({ "src/x.ts": exporta });
    expect(v).toEqual([]);
  });

  it.each(["kysely", "pg", "kysely/helpers/postgres"])(
    "el adaptador de autenticación no puede importar la herramienta de datos (%s)",
    async (paquete) => {
      const v = await violacionesDe({
        "src/adaptadores/autenticacion/instancia.ts": importa(paquete),
      });
      expect(v).toContain("orm-solo-en-persistencia");
    },
  );

  it("la conexión del rol de autenticación, en adaptadores/postgres, sí puede crear el Kysely", async () => {
    const v = await violacionesDe({
      "src/adaptadores/postgres/conexion-de-autenticacion.ts": importa("kysely"),
      "src/adaptadores/postgres/barrido-de-autenticacion.ts": importa("kysely"),
    });
    expect(v).not.toContain("orm-solo-en-persistencia");
  });

  it("un módulo de negocio no puede importar el adaptador de autenticación (solo la composición)", async () => {
    const v = await violacionesDe({
      "src/modulos/identidad/casos-de-uso/c.ts": importa(
        "../../../adaptadores/autenticacion/instancia",
      ),
      "src/adaptadores/autenticacion/instancia.ts": exporta,
    });
    expect(v).toContain("adaptadores-solo-desde-composicion");
  });
});

describe("R-W4b: el error.tsx de Next es cliente por obligación, pero mínimo", () => {
  const arbol = (archivos: Record<string, string>): string => {
    const base = mkdtempSync(join(tmpdir(), "pedernal-conv-"));
    directorios.push(base);
    for (const [ruta, contenido] of Object.entries(archivos)) {
      mkdirSync(dirname(join(base, ruta)), { recursive: true });
      writeFileSync(join(base, ruta), contenido);
    }
    return base;
  };
  const MINIMO = '"use client";\n\nexport { Error as default } from "../../ui/Error.cliente";\n';

  it("admite la directiva más una reexportación de un componente .cliente", () => {
    const base = arbol({
      "apps/web/app/error.tsx": MINIMO,
      "apps/web/app/s/app/error.tsx": MINIMO,
      "apps/web/app/global-error.tsx": MINIMO,
    });
    expect(archivosDeClienteSinSufijo(base)).toEqual([]);
  });

  it.each([
    ["con lógica", '"use client";\nexport default function E() { return null; }\n'],
    [
      "que reexporta algo que no es .cliente",
      '"use client";\nexport { E as default } from "../x";\n',
    ],
    ["con otra importación", `${MINIMO}import "../../servidor/composicion";\n`],
    ["sin la directiva pero reexporta", 'export { E as default } from "../x.cliente";\n'],
  ])("marca un error.tsx %s", (_nombre, contenido) => {
    const base = arbol({ "apps/web/app/s/app/error.tsx": contenido });
    expect(archivosDeClienteSinSufijo(base).length).toBe(
      contenido.startsWith('"use client"') ? 1 : 0,
    );
  });

  it("la excepción es solo para error.tsx / global-error.tsx dentro de app/", () => {
    const base = arbol({
      "apps/web/app/s/app/pagina.tsx": MINIMO,
      "apps/web/ui/error.tsx": MINIMO,
      "apps/web/app/s/app/otro-error.tsx": MINIMO,
    });
    expect(archivosDeClienteSinSufijo(base)).toEqual([
      "apps/web/app/s/app/otro-error.tsx",
      "apps/web/app/s/app/pagina.tsx",
      "apps/web/ui/error.tsx",
    ]);
  });

  it("el error.tsx real del repositorio cumple la forma mínima", () => {
    for (const f of ["web/app/s/app/error.tsx", "web/app/s/landing/error.tsx"]) {
      const leido = readFileSync(join("apps", f), "utf8");
      const contenido = leido.startsWith(ENCABEZADO_DE_STRYKER)
        ? leido.slice(ENCABEZADO_DE_STRYKER.length)
        : leido;
      expect(esErrorDeNextMinimo(f, contenido), f).toBe(true);
      // El sandbox de Stryker le antepone una línea: la forma mínima se sigue reconociendo.
      expect(esErrorDeNextMinimo(f, `${ENCABEZADO_DE_STRYKER}${contenido}`), f).toBe(true);
    }
  });

  it("también el de la raíz de app/ y el global no pueden importar el servidor", async () => {
    for (const ruta of ["apps/web/app/error.tsx", "apps/web/app/global-error.tsx"]) {
      const v = await violacionesDe({
        [ruta]: importa("../servidor/composicion"),
        "apps/web/servidor/composicion.ts": exporta,
      });
      expect(v, ruta).toContain("error-de-next-sin-servidor");
    }
  });

  it("un error.tsx puede importar ui y primitivas, pero no el servidor", async () => {
    const v = await violacionesDe({
      "src/primitivas/p.ts": exporta,
      "apps/web/ui/patrones/e.cliente.tsx": importa("../../../../../src/primitivas/p"),
      "apps/web/app/s/app/error.tsx": importa("../../../ui/patrones/e.cliente"),
    });
    expect(v).toEqual([]);
  });
});

describe("M6: los casos de uso de plataforma no envían correo (ADR-007)", () => {
  it("ni por el puerto ni por el adaptador, desde ninguna carpeta de plataforma", async () => {
    for (const origen of [
      "src/plataforma/casos-de-uso/c.ts",
      "src/plataforma/consultas/c.ts",
      "src/plataforma/dominio/c.ts",
    ]) {
      expect(
        await violacionesDe({
          [origen]: importa("../../puertos/correo"),
          "src/puertos/correo.ts": exporta,
        }),
        origen,
      ).toContain("plataforma-sin-correo");
    }
    expect(
      await violacionesDe({
        "src/plataforma/casos-de-uso/c.ts": importa("../../adaptadores/correo/resend"),
        "src/adaptadores/correo/resend.ts": exporta,
      }),
    ).toContain("plataforma-sin-correo");
  });

  it("encolar el trabajo sí se puede: el puerto de trabajos no es el de correo", async () => {
    const v = await violacionesDe({
      "src/plataforma/casos-de-uso/c.ts": importa("../../puertos/trabajos"),
      "src/puertos/trabajos.ts": exporta,
    });
    expect(v).not.toContain("plataforma-sin-correo");
  });

  it("el procesador de trabajos y los módulos (cuyos manejadores sí envían) quedan fuera de la regla", async () => {
    const v = await violacionesDe({
      "src/modulos/identidad/casos-de-uso/enviar.ts": importa("../../../puertos/correo"),
      "src/puertos/correo.ts": exporta,
    });
    expect(v).not.toContain("plataforma-sin-correo");
  });
});

describe("P7: la puerta de plataforma solo la importan los scripts y las pruebas (R10)", () => {
  const PUERTA = "src/composicion/plataforma.ts";
  const ENTORNO = "src/composicion/entorno-de-plataforma.ts";

  it.each([
    ["la acción del servidor de la web", "apps/web/servidor/accion.ts", "../../../src/composicion"],
    ["una página de la web", "apps/web/app/s/app/page.tsx", "../../../../../src/composicion"],
    ["el proxy de la web", "apps/web/proxy.ts", "../../src/composicion"],
    ["la composición de la web", "src/composicion/web.ts", "."],
    ["la composición de conexiones", "src/composicion/conexiones.ts", "."],
    ["un módulo", "src/modulos/empresas/casos-de-uso/c.ts", "../../../composicion"],
    ["un caso de uso de plataforma", "src/plataforma/casos-de-uso/c.ts", "../../composicion"],
    ["un adaptador", "src/adaptadores/postgres/a.ts", "../../composicion"],
  ])("no la importa %s, ni la puerta ni su entorno", async (_quien, origen, carpeta) => {
    for (const destino of [PUERTA, ENTORNO]) {
      const nombre = destino.slice(destino.lastIndexOf("/") + 1, -3);
      const ruta = carpeta === "." ? `./${nombre}` : `${carpeta}/${nombre}`;
      const v = await violacionesDe({ [origen]: importa(ruta), [destino]: exporta });
      expect(v, `${origen} → ${destino}`).toContain("plataforma-solo-desde-scripts");
    }
  });

  it("la consola de plataforma (apps/plataforma) NO puede importar la puerta sin sesión: entra por la puerta de la consola", async () => {
    // P8b: `plataforma.ts` corre casos con un contexto armado por quien llama, sin el chequeo del segundo factor reciente.
    for (const origen of [
      "apps/plataforma/servidor/composicion.ts",
      "apps/plataforma/app/page.tsx",
      "apps/plataforma/ui/boton.ts",
    ]) {
      const profundidad = "../".repeat(origen.split("/").length - 1);
      for (const destino of ["plataforma", "entorno-de-plataforma"]) {
        const v = await violacionesDe({
          [origen]: importa(`${profundidad}src/composicion/${destino}`),
          [`src/composicion/${destino}.ts`]: exporta,
        });
        expect(v, `${origen} → ${destino}`).toContain("plataforma-solo-desde-scripts");
      }
    }
  });

  it("la web no puede importar la puerta de plataforma, de ninguna de las dos formas", async () => {
    for (const origen of [
      "apps/web/servidor/composicion.ts",
      "apps/web/servidor/web/otro.ts",
      "src/composicion/web.ts",
    ]) {
      const profundidad = "../".repeat(origen.split("/").length - 1);
      const v = await violacionesDe({
        [origen]: importa(`${profundidad}src/composicion/plataforma`),
        [PUERTA]: exporta,
      });
      expect(v, origen).toContain("plataforma-solo-desde-scripts");
    }
  });

  it("la puerta de la consola solo la importa el servidor de la consola (y las pruebas): ni la web ni el resto de src/ ni las páginas de la consola", async () => {
    const PUERTA_DE_CONSOLA = "src/composicion/puerta-de-consola.ts";
    const servidor = await violacionesDe({
      "apps/plataforma/servidor/composicion.ts": importa(
        "../../../src/composicion/puerta-de-consola",
      ),
      "src/composicion/puerta-de-consola.test.ts": importa("./puerta-de-consola"),
      [PUERTA_DE_CONSOLA]: exporta,
    });
    expect(servidor).not.toContain("puerta-de-consola-solo-desde-la-consola");
    expect(servidor).not.toContain("composicion-solo-desde-servidor-de-apps");
    for (const origen of [
      "apps/plataforma/app/page.tsx",
      "apps/plataforma/ui/boton.ts",
      "apps/web/servidor/composicion.ts",
      "apps/web/app/s/app/page.tsx",
      "src/composicion/web.ts",
      "src/composicion/conexiones.ts",
      "src/modulos/empresas/casos-de-uso/c.ts",
      "src/plataforma/casos-de-uso/c.ts",
      "src/adaptadores/postgres/a.ts",
    ]) {
      const profundidad = "../".repeat(origen.split("/").length - 1);
      const v = await violacionesDe({
        [origen]: importa(`${profundidad}src/composicion/puerta-de-consola`),
        [PUERTA_DE_CONSOLA]: exporta,
      });
      expect(v, origen).toContain("puerta-de-consola-solo-desde-la-consola");
    }
  });

  it("sí la importan los scripts, las pruebas y los archivos de la propia puerta", async () => {
    const v = await violacionesDe({
      [PUERTA]: importa("./entorno-de-plataforma"),
      [ENTORNO]: exporta,
      "src/composicion/puerta-de-consola.ts": importa("./plataforma"),
      "scripts/ejecutar.ts": importa("../src/composicion/plataforma"),
      "scripts/otro.ts": importa("../src/composicion/entorno-de-plataforma").replace("y =", "z ="),
      "src/composicion/plataforma.test.ts": importa("./plataforma"),
      "src/composicion/entorno-de-plataforma.test.ts": importa("./entorno-de-plataforma"),
    });
    expect(v).not.toContain("plataforma-solo-desde-scripts");
  });

  it("los demás archivos de la composición siguen siendo importables por la web", async () => {
    const v = await violacionesDe({
      "apps/web/servidor/composicion.ts": importa("../../../src/composicion/web"),
      "src/composicion/web.ts": exporta,
    });
    expect(v).not.toContain("plataforma-solo-desde-scripts");
  });
});

/**
 * P8c (h5-p8 §7). El ingreso de la consola armado (`ingreso-de-consola.ts`) junta el secreto de ingreso y el cliente de
 * Google de la consola, las cadenas del rol de plataforma y del de autenticación y la puerta que ejecuta casos: solo lo
 * importa el servidor de la consola (y las pruebas). Para leer sus variables importa `entorno-de-plataforma.ts` y arma la
 * puerta con `puerta-de-consola.ts`: se les abre la puerta a ESE archivo y a ningún vecino.
 */
describe("P8c: el ingreso de la consola solo lo importa el servidor de la consola (R10)", () => {
  const INGRESO = "src/composicion/ingreso-de-consola.ts";
  const ENTORNO = "src/composicion/entorno-de-plataforma.ts";
  const PUERTA_DE_CONSOLA = "src/composicion/puerta-de-consola.ts";
  const ENTORNO_Y_PUERTA = [
    'import { x } from "./entorno-de-plataforma";',
    'import { x as z } from "./puerta-de-consola";',
    "export const y = x + z;",
    "",
  ].join("\n");

  it("lo importan el servidor de la consola y las pruebas, sin violar ni la regla del ingreso ni la de la composición", async () => {
    const v = await violacionesDe({
      "apps/plataforma/servidor/composicion.ts": importa(
        "../../../src/composicion/ingreso-de-consola",
      ),
      "src/composicion/ingreso-de-consola.test.ts": importa("./ingreso-de-consola"),
      [INGRESO]: exporta,
    });
    expect(v).not.toContain("ingreso-de-consola-solo-desde-la-consola");
    expect(v).not.toContain("composicion-solo-desde-servidor-de-apps");
    expect(v).not.toContain("plataforma-solo-desde-scripts");
  });

  it.each([
    ["una página de la consola", "apps/plataforma/app/page.tsx"],
    ["la interfaz de la consola", "apps/plataforma/ui/boton.ts"],
    ["la acción del servidor de la web", "apps/web/servidor/composicion.ts"],
    ["una página de la web", "apps/web/app/s/app/page.tsx"],
    ["el proxy de la web", "apps/web/proxy.ts"],
    ["la composición de la web", "src/composicion/web.ts"],
    ["la composición de conexiones", "src/composicion/conexiones.ts"],
    ["la puerta de la consola", PUERTA_DE_CONSOLA],
    ["la puerta de plataforma sin sesión", "src/composicion/plataforma.ts"],
    ["un módulo", "src/modulos/empresas/casos-de-uso/c.ts"],
    ["un caso de uso de plataforma", "src/plataforma/casos-de-uso/c.ts"],
    ["un adaptador", "src/adaptadores/postgres/a.ts"],
  ])("no lo importa %s", async (_quien, origen) => {
    const profundidad = "../".repeat(origen.split("/").length - 1);
    const v = await violacionesDe({
      [origen]: importa(`${profundidad}src/composicion/ingreso-de-consola`),
      [INGRESO]: exporta,
    });
    expect(v, origen).toContain("ingreso-de-consola-solo-desde-la-consola");
  });

  it("el ingreso sí lee el entorno de plataforma y arma la puerta de la consola; un vecino con nombre parecido, no", async () => {
    const propio = await violacionesDe({
      [INGRESO]: ENTORNO_Y_PUERTA,
      [ENTORNO]: exporta,
      [PUERTA_DE_CONSOLA]: exporta,
    });
    expect(propio).not.toContain("plataforma-solo-desde-scripts");
    expect(propio).not.toContain("puerta-de-consola-solo-desde-la-consola");
    for (const vecino of [
      "src/composicion/ingreso-de-consola-otro.ts",
      "src/composicion/otro-ingreso-de-consola.ts",
      "src/composicion/ingreso-de-consola.tsx",
    ]) {
      const v = await violacionesDe({
        [vecino]: ENTORNO_Y_PUERTA,
        [ENTORNO]: exporta,
        [PUERTA_DE_CONSOLA]: exporta,
      });
      expect(v, vecino).toContain("plataforma-solo-desde-scripts");
      expect(v, vecino).toContain("puerta-de-consola-solo-desde-la-consola");
    }
  });

  it("la consola de plataforma sigue sin poder importar el entorno de plataforma ni la puerta sin sesión: entra por el ingreso y la puerta de la consola", async () => {
    for (const destino of ["plataforma", "entorno-de-plataforma"]) {
      const v = await violacionesDe({
        "apps/plataforma/servidor/composicion.ts": importa(`../../../src/composicion/${destino}`),
        [`src/composicion/${destino}.ts`]: exporta,
      });
      expect(v, destino).toContain("plataforma-solo-desde-scripts");
    }
  });
});

/**
 * P8a (h5-p8 §2.4 ter). El generador del QR (`qrcode-generator`, 2.0.4 exacta, aprobada por el dueño) recibe la
 * dirección `otpauth://` con el secreto del segundo factor: solo lo importa el adaptador de la autenticación de
 * plataforma, la carpeta `src/adaptadores/autenticacion/plataforma/`, y nada más.
 */
describe("P8a: el generador de QR solo entra por la autenticación de plataforma", () => {
  it("lo importa el adaptador de la autenticación de plataforma (y sus pruebas), y nadie más puede", async () => {
    const v = await violacionesDe({
      "src/adaptadores/autenticacion/plataforma/qr-svg.ts": importa("qrcode-generator"),
      "src/adaptadores/autenticacion/plataforma/qr-svg.test.ts": importa("qrcode-generator"),
      "src/adaptadores/autenticacion/plataforma/otro/archivo.ts": importa(
        "qrcode-generator/dist/qrcode",
      ),
    });
    expect(v).not.toContain("qr-solo-en-la-autenticacion-de-plataforma");
  });

  it.each([
    [
      "el adaptador de autenticación de EMPRESA (misma carpeta padre)",
      "src/adaptadores/autenticacion/opciones.ts",
    ],
    ["la web de empresa", "src/adaptadores/autenticacion/autenticacion-de-better-auth.ts"],
    ["otro adaptador", "src/adaptadores/postgres/segundo-factor-de-autenticacion.ts"],
    ["una capacidad", "src/capacidades/autenticacion/totp.ts"],
    ["un puerto", "src/puertos/autenticacion.ts"],
    ["la composición", "src/composicion/plataforma.ts"],
    ["un módulo de negocio", "src/modulos/identidad/casos-de-uso/ingresar.ts"],
    ["la web", "apps/web/servidor/ingreso.ts"],
    ["una pantalla de la web", "apps/web/app/ingreso/page.tsx"],
    ["la consola futura", "apps/plataforma/servidor/ingreso.ts"],
    ["un script", "scripts/crear-qr.ts"],
  ])("%s no puede importarlo (%s)", async (_nombre, origen) => {
    const v = await violacionesDe({ [origen]: importa("qrcode-generator") });
    expect(v).toContain("qr-solo-en-la-autenticacion-de-plataforma");
  });

  it("también se ve el import de un archivo interno del paquete, y desde una carpeta que solo se parece", async () => {
    expect(
      await violacionesDe({
        "src/adaptadores/autenticacion/instancia.ts": importa("qrcode-generator/dist/qrcode"),
      }),
    ).toContain("qr-solo-en-la-autenticacion-de-plataforma");
    expect(
      await violacionesDe({
        "src/adaptadores/autenticacion/plataformas/qr.ts": importa("qrcode-generator"),
      }),
    ).toContain("qr-solo-en-la-autenticacion-de-plataforma");
    expect(
      await violacionesDe({ "src/adaptadores/otra/plataforma/qr.ts": importa("qrcode-generator") }),
    ).toContain("qr-solo-en-la-autenticacion-de-plataforma");
  });

  it("la dependencia está fijada en la versión exacta aprobada, sin rango", () => {
    const paquete = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(paquete.dependencies["qrcode-generator"]).toBe("2.0.4");
  });
});

/**
 * Consola de plataforma (UX1 §4): importa la interfaz de `apps/web/ui` y nada más de la web; la web nunca importa la
 * consola ni la interfaz importa nada de la consola.
 */
describe("la consola reutiliza solo la interfaz de la web", () => {
  it("importar apps/web/ui no rompe ninguna regla de apps entre sí", async () => {
    const v = await violacionesDe({
      "apps/plataforma/pantallas/a.tsx": importa("../../web/ui/componentes/Boton"),
      "apps/web/ui/componentes/Boton.tsx": exporta,
    });
    expect(v).not.toContain("plataforma-solo-importa-la-interfaz-de-la-web");
    expect(v).not.toContain("apps-independientes");
  });

  it.each([
    ["el servidor de la web", "apps/web/servidor/sesion.ts"],
    ["las pantallas de la web", "apps/web/pantallas/errores.tsx"],
    ["las rutas de la web", "apps/web/app/layout.tsx"],
  ])("importar %s sí rompe la regla", async (_nombre, destino) => {
    const v = await violacionesDe({
      "apps/plataforma/servidor/a.ts": importa(
        `../../web/${destino
          .split("/")
          .slice(2)
          .join("/")
          .replace(/\.tsx?$/, "")}`,
      ),
      [destino]: exporta,
    });
    expect(v).toContain("plataforma-solo-importa-la-interfaz-de-la-web");
  });

  it("la interfaz de la web no puede importar la consola", async () => {
    const v = await violacionesDe({
      "apps/web/ui/componentes/Boton.tsx": importa("../../../plataforma/logica/ingreso"),
      "apps/plataforma/logica/ingreso.ts": exporta,
    });
    expect(v).toContain("apps-independientes");
  });
});
