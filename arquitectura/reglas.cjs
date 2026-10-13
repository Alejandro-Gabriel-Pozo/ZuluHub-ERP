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
    to: {
      path: "^src/modulos/[^/]+/",
      // R-W5: `formas.ts` (esquemas Zod de la forma de un dato) es la otra entrada admitida: la
      // pantalla la importa sin arrastrar `publico.ts` y, con él, la persistencia.
      pathNot: "^src/modulos/[^/]+/(publico|formas)\\.ts$",
    },
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
    name: "permisos-plataforma-sin-empresa",
    severity: "error",
    comment:
      "Los catálogos de permisos son independientes (H5): el de plataforma no importa la matriz de roles de empresa.",
    from: { path: "^src/capacidades/permisos/plataforma\\.ts$" },
    to: { path: "^src/capacidades/permisos/empresa\\.ts$" },
  },
  {
    name: "permisos-empresa-sin-plataforma",
    severity: "error",
    comment:
      "Los catálogos de permisos son independientes (H5): el de empresa no importa la matriz de roles de plataforma.",
    from: { path: "^src/capacidades/permisos/empresa\\.ts$" },
    to: { path: "^src/capacidades/permisos/plataforma\\.ts$" },
  },
  {
    name: "guard-generico-sin-catalogos",
    severity: "error",
    comment:
      "El guard y exigirAccion son genéricos: reciben el catálogo y la matriz como parámetro y no importan ninguna matriz concreta (empresa ni plataforma).",
    from: { path: "^src/capacidades/permisos/(guard|exigir)\\.ts$" },
    to: { path: "^src/capacidades/permisos/(empresa|plataforma)\\.ts$" },
  },
  {
    name: "modulos-sin-permisos-de-plataforma",
    severity: "error",
    comment:
      "La matriz de permisos de plataforma es de la plataforma (H5): ni los módulos de negocio ni las consultas de grupo la importan.",
    from: { path: "^src/(modulos|consultas-de-grupo)/" },
    to: { path: "^src/capacidades/permisos/plataforma\\.ts$" },
  },
  {
    name: "plataforma-sin-framework",
    severity: "error",
    comment:
      "El dominio y los casos de uso de plataforma (y el dominio de captación) no importan Zod, React ni Next (H5; alta por solicitud R-C6).",
    from: { path: "^src/plataforma/(dominio|captacion/dominio|casos-de-uso)/" },
    to: { path: FRAMEWORK },
  },
  {
    name: "plataforma-dominio-sin-puertos-ni-exigir",
    severity: "error",
    comment:
      "El dominio de plataforma (y el de captación) es puro: no conoce puertos ni exigirAccion (que carga al actor de forma asíncrona). Eso es de los casos de uso.",
    from: { path: "^src/plataforma/(captacion/)?dominio/" },
    to: { path: "^src/puertos/|^src/capacidades/permisos/exigir\\.ts$" },
  },
  {
    name: "plataforma-dominio-sin-guard",
    severity: "error",
    comment:
      "El dominio de plataforma no autoriza: el guard se pide en el caso de uso, dentro de la transacción (ADR-003). Única excepción: soporte/explicar, que repite la decisión del guard real a propósito, solo lectura.",
    from: {
      path: "^src/plataforma/(captacion/)?dominio/",
      pathNot: "^src/plataforma/dominio/soporte/explicar(\\.test)?\\.ts$",
    },
    to: { path: "^src/capacidades/permisos/guard\\.ts$" },
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
  {
    name: "grupo-solo-escribe-su-auditoria",
    severity: "error",
    comment:
      "Las consultas de grupo son de solo lectura (R3, ADR-005): de los puertos solo conocen las transacciones, la carga de autorización de grupo y el registro de acceso de grupo, que es la única escritura permitida (D11 de H6). Cualquier otro puerto (auditoría de empresa o de plataforma, trabajos, idempotencia, correo) queda prohibido por nombre.",
    from: { path: "^src/consultas-de-grupo/" },
    to: {
      path: "^src/puertos/",
      pathNot:
        "^src/puertos/(transacciones|autorizacion-de-grupo|auditoria-de-acceso-de-grupo)\\.ts$",
    },
  },
  {
    name: "permisos-grupo-sin-otros-catalogos",
    severity: "error",
    comment:
      "Los catálogos de permisos son independientes (H6): el de grupo no importa la matriz de empresa ni la de plataforma.",
    from: { path: "^src/capacidades/permisos/grupo\\.ts$" },
    to: { path: "^src/capacidades/permisos/(empresa|plataforma)\\.ts$" },
  },
  {
    name: "permisos-sin-grupo",
    severity: "error",
    comment:
      "Los catálogos de permisos son independientes (H6): ni el de empresa ni el de plataforma, ni el guard genérico ni exigirAccion, importan la matriz de grupo.",
    from: { path: "^src/capacidades/permisos/(empresa|plataforma|guard|exigir)\\.ts$" },
    to: { path: "^src/capacidades/permisos/grupo\\.ts$" },
  },
  {
    name: "negocio-sin-permisos-de-grupo",
    severity: "error",
    comment:
      "La matriz de permisos de grupo es de la vista de grupo (H6): ni los módulos de negocio ni la plataforma la importan.",
    from: { path: "^src/(modulos|plataforma)/" },
    to: { path: "^src/capacidades/permisos/grupo\\.ts$" },
  },
  {
    name: "dominio-sin-persistencia",
    severity: "error",
    comment:
      "El dominio es puro: no conoce la persistencia de su módulo (tablas, repositorios ni traducción de restricciones). La dependencia va de la persistencia al dominio, nunca al revés (ADR-004, H7 T4).",
    from: { path: "^src/modulos/[^/]+/dominio/" },
    to: { path: "^src/modulos/[^/]+/persistencia/" },
  },
  {
    name: "persistencia-sin-casos-de-uso",
    severity: "error",
    comment:
      "La persistencia no conoce a quien la usa: no importa los casos de uso ni las consultas de su módulo. Los casos de uso reciben los repositorios por su contrato (H7 T4).",
    from: { path: "^src/modulos/[^/]+/persistencia/" },
    to: { path: "^src/modulos/[^/]+/(casos-de-uso|consultas)/" },
  },
  {
    name: "capacidades-de-planes-fuera-del-dominio",
    severity: "error",
    comment:
      "Los derechos de uso y los niveles (capacidades/planes) se piden en el caso de uso, dentro de la transacción (marcas y planes §B.5.8): el dominio de negocio no pregunta por el plan. Única excepción: el dominio del propio módulo de planes, que decide las asignaciones y los ajustes.",
    from: {
      path: "^src/(modulos/[^/]+|plataforma(/captacion)?)/dominio/",
      pathNot: "^src/modulos/planes/dominio/",
    },
    to: { path: "^src/capacidades/planes/" },
  },
  {
    name: "planes-sin-marcas",
    severity: "error",
    comment:
      "La dependencia va de marcas a planes (marcas y planes §D): el módulo de planes no conoce el de marcas.",
    from: { path: "^src/modulos/planes/" },
    to: { path: "^src/modulos/marcas/" },
  },
  {
    name: "modulos-sin-planes",
    severity: "error",
    comment:
      "Ningún otro módulo importa el módulo de planes (marcas y planes §D): preguntan por sus derechos con capacidades/planes y los puertos. Solo marcas, que depende de planes.",
    from: { path: "^src/modulos/", pathNot: "^src/modulos/(planes|marcas)/" },
    to: { path: "^src/modulos/planes/" },
  },
  {
    name: "modulos-sin-marcas",
    severity: "error",
    comment:
      "Ningún otro módulo de negocio importa modulos/marcas (marcas y planes, §D «Arquitectura»): la marca es presentación y puerta, no una dependencia de negocio. Lo que un módulo necesita (los textos, los derechos de uso) lo toma de capacidades y de los puertos. La puerta web, la plataforma y las consultas sí entran por su publico.ts.",
    from: { path: "^src/modulos/", pathNot: "^src/modulos/marcas/" },
    to: { path: "^src/modulos/marcas/" },
  },
  {
    // R-W6. Previene: íconos sueltos sin nombre accesible ([02] §4.3) y un juego de íconos repartido por
    // toda la web (cambiarlo tocaría cada pantalla). Chequeo: la violación inyectada de reglas.test.ts.
    name: "iconos-solo-por-su-puerta",
    severity: "error",
    comment:
      "`lucide-react` solo se importa desde apps/web/ui/iconos/ (R-W6): ahí cada ícono sale del catálogo cerrado y con su nombre accesible o declarado decorativo.",
    from: { path: "^(src|apps)/", pathNot: "^apps/web/ui/iconos/" },
    to: { path: "^(node_modules/)?lucide-react(/|$)" },
  },
  {
    // R-W7. Previene: un componente que sabe de un módulo o de una pantalla ([01] §3.1): la interfaz base
    // (capas 1 a 5) no conoce ningún módulo ni la composición. Chequeo: la violación inyectada de reglas.test.ts.
    name: "ui-sin-pantallas-ni-modulos",
    severity: "error",
    comment:
      "apps/web/ui/** (capas 1 a 5) no importa apps/web/pantallas/**, apps/web/servidor/** ni src/modulos/** (R-W7): la interfaz base no conoce ninguna pantalla ni módulo.",
    from: { path: "^apps/web/ui/" },
    to: { path: "^apps/web/(pantallas|servidor)/|^src/modulos/" },
  },
  {
    name: "composicion-solo-desde-servidor-de-apps",
    severity: "error",
    comment:
      "R-W2. Ningún .tsx ni archivo de apps/** importa src/composicion salvo apps/web/servidor/** (que es solo servidor). Previene que un componente arme adaptadores y, con ellos, secretos.",
    from: { path: "\\.tsx$|^apps/", pathNot: "^apps/web/servidor/" },
    to: { path: "^src/composicion/" },
  },
  {
    name: "cliente-sin-servidor",
    severity: "error",
    comment:
      'R-W4. Los archivos de cliente (*.cliente.tsx; todo archivo con "use client" lleva ese sufijo) no importan publico.ts de ningún módulo, ni la composición, ni los adaptadores, ni apps/*/servidor. Previene persistencia y pg en el paquete del navegador (hallazgo H5 del spec de la web). Las formas (formas.ts) sí se pueden importar.',
    from: { path: "\\.cliente\\.tsx$" },
    to: {
      path: "^src/modulos/[^/]+/publico\\.ts$|^src/(composicion|adaptadores)/|^apps/[^/]+/servidor/",
    },
  },
  {
    name: "formas-sin-negocio",
    severity: "error",
    comment:
      "R-W5. formas.ts de un módulo solo importa zod y primitivas: son esquemas de la forma de un dato, sin negocio. Previene que la pantalla tenga que importar publico.ts (con persistencia) solo para tener la forma, o que la forma decida reglas que son del dominio.",
    from: { path: "^src/modulos/[^/]+/formas\\.ts$" },
    to: { pathNot: "^src/primitivas/|^(node_modules/)?zod(/|$)" },
  },
  {
    name: "fiscal-sin-negocio-ajeno",
    severity: "error",
    comment:
      "El facturador funciona solo (facturación §B.0 y §B.9): fiscal no importa ventas, caja, catálogo, clientes ni stock, ni siquiera por su publico.ts. Quien factura le da renglones, un receptor y un origen opaco. Previene que fiscal dependa de un módulo que lo usa y rompa la separación; si se elimina, falla la violación inyectada de esta regla.",
    from: { path: "^src/modulos/fiscal/" },
    to: { path: "^src/modulos/(ventas|caja|catalogo|clientes|stock)/" },
  },
  {
    // R-W4b. Next obliga a que el límite de errores se llame `error.tsx` (y `global-error.tsx`) y lleve la
    // directiva de cliente, así que no puede llevar el sufijo `.cliente.tsx` de R-W4. Estos archivos solo
    // reexportan el componente (lo exige la prueba de convenciones) y valen lo mismo que uno de cliente.
    // Previene: persistencia, composición o `pg` en el paquete del navegador por la puerta de los errores.
    // Chequeo: la violación inyectada de reglas.test.ts.
    name: "error-de-next-sin-servidor",
    severity: "error",
    comment:
      "R-W4b. Los error.tsx / global-error.tsx de apps/*/app (clientes por obligación de Next) no importan publico.ts de ningún módulo, ni la composición, ni los adaptadores, ni apps/*/servidor.",
    from: {
      path: "^apps/[^/]+/app/(global-)?error\\.tsx$|^apps/[^/]+/app/.+/(global-)?error\\.tsx$",
    },
    to: {
      path: "^src/modulos/[^/]+/publico\\.ts$|^src/(composicion|adaptadores)/|^apps/[^/]+/servidor/",
    },
  },
];

module.exports = { reglas };
