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
    name: "dinero-constructores-internos",
    severity: "error",
    comment:
      "Los constructores sin parser de dinero y cantidad (interno.ts) solo los usan las propias primitivas: fuera de ellas un importe nace de texto validado, de sumar/restar, de redondear o de prorratear (caso 0b).",
    from: { path: "^src/", pathNot: "^src/primitivas/(dinero|cantidad)/" },
    to: { path: "^src/primitivas/(dinero|cantidad)/interno\\.ts$" },
  },
  {
    name: "empresas-no-conoce-tenants",
    severity: "error",
    comment:
      "Lo de abajo no conoce lo de arriba (R3): la empresa guarda solo el identificador de su tenant y no importa el módulo de tenants.",
    from: { path: "^src/modulos/empresas/" },
    to: { path: "^src/modulos/tenants/" },
  },
  {
    name: "adaptadores-de-efectos-genericos",
    severity: "error",
    comment:
      "El procesador de la cola y el correo son mecanismos genéricos (ADR-007): no conocen ningún módulo de negocio. Cada tipo de trabajo trae su manejador desde la composición.",
    from: { path: "^src/adaptadores/(trabajos|correo)/" },
    to: { path: "^src/modulos/" },
  },
  {
    name: "dominio-sin-guard",
    severity: "error",
    comment:
      "El dominio no autoriza: el guard y la matriz de permisos de empresa se piden en el caso de uso, dentro de la transacción (ADR-003). El dominio solo puede conocer los roles (permisos/roles.ts).",
    from: { path: "^src/modulos/[^/]+/dominio/" },
    to: { path: "^src/capacidades/permisos/(guard|empresa)\\.ts$" },
  },
  {
    name: "plataforma-sin-permisos-de-empresa",
    severity: "error",
    comment:
      "La plataforma tiene su propio catálogo de acciones y su guard (H5): no reutiliza la matriz de roles de empresa.",
    from: { path: "^src/plataforma/" },
    to: { path: "^src/capacidades/permisos/empresa\\.ts$" },
  },
  {
    name: "grupo-sin-permisos-de-empresa",
    severity: "error",
    comment:
      "Las consultas de grupo tienen su propio catálogo de acciones de grupo (H6): no reutilizan la matriz de roles de empresa.",
    from: { path: "^src/consultas-de-grupo/" },
    to: { path: "^src/capacidades/permisos/empresa\\.ts$" },
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
  {
    name: "consultas-sin-dominio",
    severity: "error",
    comment:
      "Una consulta por pantalla no importa el dominio de su módulo (ADR-005): lee y devuelve objetos planos; las reglas de negocio viven en los casos de uso.",
    from: { path: "^src/modulos/[^/]+/consultas/" },
    to: { path: "^src/modulos/[^/]+/dominio/" },
  },
  {
    name: "empresas-no-conoce-identidad",
    severity: "error",
    comment:
      "Identidad ya importa empresas/publico: si empresas importara identidad se formaría un ciclo. Lo que empresas necesita de ahí (el guard, los estados) vive en capacidades y en contexto (H6, B.0).",
    from: { path: "^src/modulos/empresas/" },
    to: { path: "^src/modulos/identidad/" },
  },
];

module.exports = { reglas };
