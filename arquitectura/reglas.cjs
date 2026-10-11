/**
 * Reglas de dependencias de ZuluHub (ADR-001). Se escriben a mano en H0; cuando exista la primera
 * ficha `modulo.ts` se generan de las fichas (ADR-003). Todas con severidad `error`.
 *
 * Las rutas son relativas a la raíz del repositorio.
 */

const ORM =
  "^(node_modules/)?(kysely|drizzle-orm|drizzle-kit|@prisma/|prisma|pg|pg-pool|postgres|@neondatabase/)(/|$)";
const FRAMEWORK = "^(node_modules/)?(zod|react|react-dom|next)(/|$)";

const CAPAS_SUPERIORES_A_CAPACIDADES =
  "^src/(modulos|plataforma|consultas-de-grupo|composicion|adaptadores)/";

/** @type {import("dependency-cruiser").IForbiddenRuleType[]} */
const reglas = [
  {
    name: "sin-ciclos",
    severity: "error",
    comment: "Ningún ciclo de dependencias.",
    from: {},
    to: { circular: true },
  },
  {
    name: "primitivas-puras",
    severity: "error",
    comment: "Las primitivas no importan nada del resto de src: son valores puros.",
    from: { path: "^src/primitivas/" },
    to: { path: "^src/", pathNot: "^src/primitivas/" },
  },
  {
    name: "contexto-sin-capas-superiores",
    severity: "error",
    comment: "contexto solo conoce primitivas (y puertos).",
    from: { path: "^src/contexto/" },
    to: {
      path: "^src/(capacidades|modulos|plataforma|consultas-de-grupo|composicion|adaptadores)/",
    },
  },
  {
    name: "capacidades-sin-negocio",
    severity: "error",
    comment: "Las capacidades transversales no conocen módulos de negocio ni adaptadores.",
    from: { path: "^src/capacidades/" },
    to: { path: CAPAS_SUPERIORES_A_CAPACIDADES },
  },
  {
    name: "modulos-sin-capas-superiores",
    severity: "error",
    comment:
      "Un módulo de negocio no conoce plataforma, consultas de grupo, composición ni adaptadores.",
    from: { path: "^src/modulos/" },
    to: { path: "^src/(plataforma|consultas-de-grupo|composicion|adaptadores)/" },
  },
  {
    name: "puertos-sin-capas-superiores",
    severity: "error",
    comment: "Los puertos solo conocen primitivas, contexto y capacidades.",
    from: { path: "^src/puertos/" },
    to: { path: "^src/(modulos|plataforma|consultas-de-grupo|composicion|adaptadores)/" },
  },
  {
    name: "modulos-solo-por-publico",
    severity: "error",
    comment: "Entre módulos de negocio solo se entra por publico.ts.",
    from: { path: "^src/modulos/([^/]+)/" },
    to: {
      path: "^src/modulos/[^/]+/",
      pathNot: ["^src/modulos/$1/", "^src/modulos/[^/]+/publico\\.ts$"],
    },
  },
  {
    name: "modulos-solo-por-publico-desde-afuera",
    severity: "error",
    comment:
      "Quien no es un módulo (plataforma, consultas, composición, apps) entra por publico.ts.",
    from: { path: "^(src|apps)/", pathNot: "^src/modulos/" },
    to: { path: "^src/modulos/[^/]+/", pathNot: "^src/modulos/[^/]+/publico\\.ts$" },
  },
  {
    name: "adaptadores-solo-desde-composicion",
    severity: "error",
    comment: "Solo composición (y las pruebas) importan adaptadores concretos.",
    from: { path: "^(src|apps)/", pathNot: "^src/(adaptadores|composicion)/" },
    to: { path: "^src/adaptadores/" },
  },
  {
    name: "orm-solo-en-persistencia",
    severity: "error",
    comment:
      "La herramienta de acceso a datos solo se importa en adaptadores/postgres y en modulos/*/persistencia (ADR-004).",
    from: {
      path: "^(src|apps)/",
      pathNot: "^src/(adaptadores/postgres|modulos/[^/]+/persistencia)/",
    },
    to: { path: ORM },
  },
  {
    name: "dominio-sin-framework",
    severity: "error",
    comment: "Primitivas, contexto, capacidades y dominios no importan Zod, React ni Next.",
    from: {
      path: "^src/(primitivas|contexto|capacidades)/|^src/modulos/[^/]+/(dominio|casos-de-uso)/",
    },
    to: { path: FRAMEWORK },
  },
  {
    name: "apps-sin-persistencia-ni-adaptadores",
    severity: "error",
    comment:
      "Las apps no importan persistencia ni adaptadores: pasan por composición y publico.ts.",
    from: { path: "^apps/" },
    to: { path: "^src/(adaptadores/|modulos/[^/]+/persistencia/)" },
  },
  {
    name: "apps-independientes",
    severity: "error",
    comment: "Una app no importa a otra (plataforma y web son aplicaciones separadas).",
    from: { path: "^apps/([^/]+)/" },
    to: { path: "^apps/", pathNot: "^apps/$1/" },
  },
];

module.exports = { reglas };
