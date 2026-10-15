/**
 * Esquema de base de los planes (migración `0007_marcas_y_planes.sql`, tablas `plan`, `version_de_plan`,
 * `plan_de_tenant`, `ajuste_de_perilla` y `modulo_de_empresa`). Lo comparan las pruebas de integración
 * contra la base real: si una restricción cambia en el SQL, esta lista tiene que cambiar con ella. La
 * escritura de planes, asignaciones, ajustes y módulos es de los casos de uso de plataforma (M5); acá
 * solo viven sus traducciones.
 */

/** Columnas de `plan`, en el orden de la base. */
export const COLUMNAS_DE_PLAN = [
  "id",
  "codigo",
  "estado",
  "creado_en",
  "actualizado_en",
  "version",
] as const;

/** Columnas de `version_de_plan`, en el orden de la base. */
export const COLUMNAS_DE_VERSION_DE_PLAN = [
  "id",
  "plan_id",
  "numero",
  "estado",
  "nombre_comercial",
  "modulos",
  "perillas",
  "motivo",
  "publicada_en",
  "publicada_por",
  "creado_en",
  "actualizado_en",
  "version",
] as const;

/** Columnas de `plan_de_tenant`, en el orden de la base. */
export const COLUMNAS_DE_PLAN_DE_TENANT = [
  "id",
  "tenant_id",
  "numero",
  "version_de_plan_id",
  "vigente_desde",
  "origen",
  "reemplaza_programada",
  "motivo",
  "asignado_por",
  "creado_en",
] as const;

/** Columnas de `ajuste_de_perilla`, en el orden de la base. */
export const COLUMNAS_DE_AJUSTE_DE_PERILLA = [
  "id",
  "tenant_id",
  "empresa_id",
  "perilla",
  "numero",
  "valor",
  "vigente_desde",
  "reemplaza_programada",
  "motivo",
  "asignado_por",
  "creado_en",
] as const;

/** Columnas de `modulo_de_empresa`, en el orden de la base. */
export const COLUMNAS_DE_MODULO_DE_EMPRESA = [
  "empresa_id",
  "modulo",
  "activo",
  "creado_en",
  "actualizado_en",
  "version",
] as const;

/**
 * Restricción de las tablas de planes → motivo tipado (ADR-004). Un test exige que no falte ninguna y que
 * no sobre ninguna. Regla de qué se traduce: un motivo solo si el motivo del dominio puro (§B.11) NO lleva
 * datos que la base no tiene; los que llevan (`VALOR_DE_PERILLA_INVALIDO { perilla }`,
 * `MODULO_DESCONOCIDO { modulo }`) los decide el dominio ANTES de escribir, y si la base igual los
 * rechaza es un defecto: sale como el error de persistencia tipado (`NO_TRADUCIDA`), nunca disfrazado.
 *
 * Los números consecutivos (`plan_de_tenant_numero_uk` y su disparador, lo mismo para los ajustes) son
 * el `numeroEsperado` hecho restricción: dos cambios simultáneos desde el mismo punto, uno gana y el otro
 * es `VERSION_DESACTUALIZADA` (§B.5.5). El de las versiones de plan (`version_de_plan_numero_*`) no es un
 * motivo del usuario: bajo SERIALIZABLE el adaptador reintenta y la segunda publicación ve el número
 * siguiente.
 *
 * Los nombres marcados «lo lanza un disparador» no son restricciones del catálogo: los lanzan
 * `plan_validar_cambio`, `version_de_plan_validar_alta`, `version_de_plan_validar_cambio`,
 * `plan_de_tenant_validar_alta` y `ajuste_de_perilla_validar_alta` con `CONSTRAINT = '...'`
 * (SQLSTATE 23514).
 */
export const ERRORES_DE_PLANES_POR_RESTRICCION = {
  plan_pkey: "NO_TRADUCIDA",
  plan_codigo_ck: "CODIGO_DE_PLAN_INVALIDO",
  plan_estado_ck: "NO_TRADUCIDA",
  plan_codigo_uk: "CODIGO_DE_PLAN_OCUPADO",
  plan_inmutable: "NO_TRADUCIDA", // lo lanza un disparador
  plan_transicion_invalida: "NO_TRADUCIDA", // lo lanza un disparador
  version_de_plan_pkey: "NO_TRADUCIDA",
  version_de_plan_plan_id_fkey: "PLAN_NO_ENCONTRADO",
  version_de_plan_numero_ck: "NO_TRADUCIDA",
  version_de_plan_estado_ck: "NO_TRADUCIDA",
  version_de_plan_nombre_ck: "NOMBRE_DE_PLAN_INVALIDO",
  version_de_plan_modulos_ck: "NO_TRADUCIDA",
  version_de_plan_perillas_ck: "NO_TRADUCIDA",
  version_de_plan_numero_uk: "NO_TRADUCIDA",
  version_de_plan_publicada_ck: "NO_TRADUCIDA",
  version_de_plan_borrador_uk: "VERSION_DESACTUALIZADA",
  version_de_plan_plan_retirado: "PLAN_RETIRADO", // lo lanza un disparador
  version_de_plan_transicion_invalida: "NO_TRADUCIDA", // lo lanza un disparador
  version_de_plan_inmutable: "NO_TRADUCIDA", // lo lanza un disparador
  version_de_plan_publicada_inmutable: "NO_TRADUCIDA", // lo lanza un disparador
  version_de_plan_numero_invalido: "NO_TRADUCIDA", // lo lanza un disparador
  plan_de_tenant_pkey: "NO_TRADUCIDA",
  plan_de_tenant_tenant_id_fkey: "TENANT_NO_ENCONTRADO",
  plan_de_tenant_version_de_plan_id_fkey: "NO_TRADUCIDA",
  plan_de_tenant_numero_ck: "NO_TRADUCIDA",
  plan_de_tenant_origen_ck: "NO_TRADUCIDA",
  plan_de_tenant_motivo_ck: "MOTIVO_OBLIGATORIO",
  plan_de_tenant_asignado_por_ck: "NO_TRADUCIDA",
  plan_de_tenant_numero_uk: "VERSION_DESACTUALIZADA",
  plan_de_tenant_vigencia_ck: "VIGENCIA_RETROACTIVA",
  plan_de_tenant_numero_invalido: "VERSION_DESACTUALIZADA", // lo lanza un disparador
  plan_de_tenant_version_no_publicada: "VERSION_DE_PLAN_NO_PUBLICADA", // lo lanza un disparador
  ajuste_de_perilla_pkey: "NO_TRADUCIDA",
  ajuste_de_perilla_tenant_id_fkey: "TENANT_NO_ENCONTRADO",
  ajuste_de_perilla_empresa_id_fkey: "EMPRESA_NO_ENCONTRADA",
  ajuste_de_perilla_perilla_ck: "NO_TRADUCIDA",
  ajuste_de_perilla_numero_ck: "NO_TRADUCIDA",
  ajuste_de_perilla_valor_ck: "NO_TRADUCIDA",
  ajuste_de_perilla_motivo_ck: "MOTIVO_OBLIGATORIO",
  ajuste_de_perilla_asignado_por_ck: "NO_TRADUCIDA",
  ajuste_de_perilla_numero_uk: "VERSION_DESACTUALIZADA",
  ajuste_de_perilla_vigencia_ck: "VIGENCIA_RETROACTIVA",
  ajuste_de_perilla_empresa_de_otro_tenant: "EMPRESA_DE_OTRO_TENANT", // lo lanza un disparador
  ajuste_de_perilla_numero_invalido: "VERSION_DESACTUALIZADA", // lo lanza un disparador
  modulo_de_empresa_pkey: "NO_TRADUCIDA",
  modulo_de_empresa_empresa_id_fkey: "EMPRESA_NO_ENCONTRADA",
  modulo_de_empresa_modulo_ck: "NO_TRADUCIDA",
} as const satisfies Readonly<Record<string, string>>;

/** Los nombres que lanzan los disparadores de las tablas de planes con `ERRCODE '23514'`. */
export const RESTRICCIONES_DE_DISPARADORES_DE_PLANES = [
  "plan_inmutable",
  "plan_transicion_invalida",
  "version_de_plan_plan_retirado",
  "version_de_plan_transicion_invalida",
  "version_de_plan_inmutable",
  "version_de_plan_publicada_inmutable",
  "version_de_plan_numero_invalido",
  "plan_de_tenant_numero_invalido",
  "plan_de_tenant_version_no_publicada",
  "ajuste_de_perilla_empresa_de_otro_tenant",
  "ajuste_de_perilla_numero_invalido",
] as const satisfies readonly (keyof typeof ERRORES_DE_PLANES_POR_RESTRICCION)[];

type Mapa = typeof ERRORES_DE_PLANES_POR_RESTRICCION;

/** Todo motivo al que puede traducirse una restricción de las tablas de planes. */
export type ErrorDePlanesPorRestriccion = Exclude<Mapa[keyof Mapa], "NO_TRADUCIDA">;
