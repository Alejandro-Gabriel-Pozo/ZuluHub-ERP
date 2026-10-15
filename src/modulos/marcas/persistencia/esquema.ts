/**
 * Esquema de base de las marcas (migración `0007_marcas_y_planes.sql`, tablas `dominio`, `marca` y
 * `version_de_marca`). Lo comparan las pruebas de integración contra la base real: si una columna o una
 * restricción cambia en el SQL, estas listas tienen que cambiar con ella. La escritura de marcas y
 * versiones es de los casos de uso de plataforma (M5); acá solo viven sus traducciones.
 */

/** Columnas de `dominio`, en el orden de la base. */
export const COLUMNAS_DE_DOMINIO = [
  "id",
  "host",
  "superficie",
  "duenio_marca_id",
  "duenio_empresa_id",
  "marca_id",
  "titular",
  "es_canonico",
  "estado",
  "verificado_en",
  "motivo",
  "registrado_por",
  "creado_en",
  "actualizado_en",
  "version",
] as const;

/**
 * Restricción de `dominio` → motivo tipado (ADR-004). Un test exige que no falte ninguna y que no sobre
 * ninguna: una restricción nueva sin traducir hace fallar la prueba. `NO_TRADUCIDA`: no tiene un motivo
 * propio (el dominio puro decide antes, o la fija la base y no el usuario); si salta, es un defecto y
 * sale como el error de persistencia tipado, nunca disfrazado. Los motivos que coinciden con uno del
 * dominio puro (`ciclo-de-dominio.ts`, por ejemplo `DOMINIO_CANONICO`) son ese mismo motivo.
 *
 * Los nombres marcados «lo lanza un disparador» no son restricciones del catálogo: los lanza
 * `dominio_validar_alta` o `dominio_validar_cambio` con `CONSTRAINT = '...'` (SQLSTATE 23514), y una
 * prueba compara esa lista con el código de las funciones.
 */
export const ERRORES_DE_DOMINIO_POR_RESTRICCION = {
  dominio_pkey: "NO_TRADUCIDA",
  dominio_host_ck: "HOST_INVALIDO",
  dominio_superficie_ck: "SUPERFICIE_INVALIDA",
  dominio_titular_ck: "TITULAR_INVALIDO",
  dominio_estado_ck: "NO_TRADUCIDA",
  dominio_registrado_por_ck: "NO_TRADUCIDA",
  dominio_duenio_ck: "NO_TRADUCIDA", // también lo lanza un disparador
  dominio_marca_duena_ck: "NO_TRADUCIDA",
  dominio_superficie_duenio_ck: "SUPERFICIE_NO_ADMITIDA_PARA_EMPRESA",
  dominio_canonico_ck: "CANONICO_SOLO_DE_MARCA",
  dominio_verificacion_ck: "NO_TRADUCIDA",
  dominio_duenio_marca_id_fkey: "MARCA_NO_ENCONTRADA",
  dominio_duenio_empresa_id_fkey: "EMPRESA_NO_ENCONTRADA", // también lo lanza un disparador
  dominio_marca_id_fkey: "NO_TRADUCIDA", // la marca la fija el disparador desde el dueño
  dominio_host_uk: "HOST_DUPLICADO",
  dominio_canonico_uk: "YA_TIENE_CANONICO",
  dominio_nace_pendiente: "NO_TRADUCIDA", // lo lanza un disparador
  dominio_marca_retirada: "MARCA_RETIRADA", // lo lanza un disparador
  dominio_inmutable: "NO_TRADUCIDA", // lo lanza un disparador
  dominio_retirado_inmutable: "DOMINIO_RETIRADO", // lo lanza un disparador
  dominio_transicion_invalida: "TRANSICION_DE_DOMINIO_INVALIDA", // lo lanza un disparador
  dominio_canonico_no_se_retira: "DOMINIO_CANONICO", // lo lanza un disparador
  dominio_verificacion_inmutable: "FECHA_DE_VERIFICACION_INMUTABLE", // lo lanza un disparador
} as const satisfies Readonly<Record<string, string>>;

/** Los nombres que lanzan los disparadores de `dominio` con `ERRCODE '23514'` (o `'23503'`, el de la empresa). */
export const RESTRICCIONES_DE_DISPARADORES_DE_DOMINIO = [
  "dominio_nace_pendiente",
  "dominio_duenio_ck",
  "dominio_duenio_empresa_id_fkey",
  "dominio_marca_retirada",
  "dominio_inmutable",
  "dominio_retirado_inmutable",
  "dominio_transicion_invalida",
  "dominio_canonico_no_se_retira",
  "dominio_verificacion_inmutable",
] as const satisfies readonly (keyof typeof ERRORES_DE_DOMINIO_POR_RESTRICCION)[];

type Mapa = typeof ERRORES_DE_DOMINIO_POR_RESTRICCION;

/** Todo motivo al que puede traducirse una restricción de `dominio`. */
export type ErrorDeDominioPorRestriccion = Exclude<Mapa[keyof Mapa], "NO_TRADUCIDA">;

// ---------------------------------------------------------------------------------------------------
// Marcas y versiones de marca
// ---------------------------------------------------------------------------------------------------

/** Columnas de `marca`, en el orden de la base. */
export const COLUMNAS_DE_MARCA = [
  "id",
  "codigo",
  "es_principal",
  "marca_padre_id",
  "nivel",
  "estado",
  "creado_en",
  "actualizado_en",
  "version",
] as const;

/** Columnas de `version_de_marca`, en el orden de la base. */
export const COLUMNAS_DE_VERSION_DE_MARCA = [
  "id",
  "marca_id",
  "numero",
  "estado",
  "vigente_desde",
  "nombre_visible",
  "tema",
  "logo",
  "vocabulario",
  "modulos_iniciales",
  "plan_por_defecto_id",
  "reemplaza_programada",
  "motivo",
  "confirmada_en",
  "confirmada_por",
  "creado_en",
  "actualizado_en",
  "version",
] as const;

/**
 * Restricción de `marca` y de `version_de_marca` → motivo tipado (ADR-004). Un test exige que no falte
 * ninguna y que no sobre ninguna. Regla de qué se traduce: un motivo solo si el motivo del dominio puro
 * (§B.11) NO lleva datos que la base no tiene; los que llevan (`TEMA_INVALIDO { token }`,
 * `ASPECTO_INVALIDO { token }`, `TEXTO_INVALIDO { texto }`, `MODULO_DESCONOCIDO { modulo }`) los decide el
 * dominio ANTES de escribir, y
 * si la base igual los rechaza es un defecto: sale como el error de persistencia tipado
 * (`NO_TRADUCIDA`), nunca disfrazado con un motivo al que le faltan los datos.
 *
 * Los nombres marcados «lo lanza un disparador» no son restricciones del catálogo: los lanzan
 * `marca_validar_alta`, `marca_validar_cambio`, `version_de_marca_validar_alta` y
 * `version_de_marca_validar_cambio` con `CONSTRAINT = '...'` (SQLSTATE 23514). Dos confirmaciones
 * simultáneas de una marca chocan en el número (`version_de_marca_numero_uk` o su disparador): bajo
 * SERIALIZABLE el adaptador reintenta y la segunda ve el número siguiente, así que no es un motivo para
 * el usuario.
 */
export const ERRORES_DE_MARCAS_POR_RESTRICCION = {
  marca_pkey: "NO_TRADUCIDA",
  marca_codigo_ck: "CODIGO_DE_MARCA_INVALIDO",
  marca_nivel_ck: "NIVEL_DE_MARCA_NO_HABILITADO",
  marca_estado_ck: "NO_TRADUCIDA",
  marca_principal_ck: "NO_TRADUCIDA",
  marca_codigo_uk: "CODIGO_DE_MARCA_OCUPADO",
  marca_principal_uk: "NO_TRADUCIDA",
  marca_marca_padre_id_fkey: "MARCA_PADRE_NO_ENCONTRADA",
  marca_padre_retirada: "MARCA_PADRE_RETIRADA", // lo lanza un disparador
  marca_inmutable: "NO_TRADUCIDA", // lo lanza un disparador
  marca_transicion_invalida: "NO_TRADUCIDA", // lo lanza un disparador
  version_de_marca_pkey: "NO_TRADUCIDA",
  version_de_marca_numero_ck: "NO_TRADUCIDA",
  version_de_marca_estado_ck: "NO_TRADUCIDA",
  version_de_marca_nombre_ck: "NOMBRE_DE_MARCA_INVALIDO",
  version_de_marca_tema_ck: "NO_TRADUCIDA",
  version_de_marca_aspecto_ck: "NO_TRADUCIDA",
  version_de_marca_logo_ck: "LOGO_INVALIDO",
  version_de_marca_vocabulario_ck: "NO_TRADUCIDA",
  version_de_marca_modulos_ck: "NO_TRADUCIDA",
  version_de_marca_confirmada_ck: "NO_TRADUCIDA",
  version_de_marca_vigencia_ck: "VIGENCIA_RETROACTIVA",
  version_de_marca_numero_uk: "NO_TRADUCIDA",
  version_de_marca_borrador_uk: "VERSION_DESACTUALIZADA",
  version_de_marca_marca_id_fkey: "MARCA_NO_ENCONTRADA",
  version_de_marca_plan_por_defecto_id_fkey: "PLAN_NO_ENCONTRADO",
  version_de_marca_marca_retirada: "MARCA_RETIRADA", // lo lanza un disparador
  version_de_marca_transicion_invalida: "NO_TRADUCIDA", // lo lanza un disparador
  version_de_marca_inmutable: "NO_TRADUCIDA", // lo lanza un disparador
  version_de_marca_confirmada_inmutable: "NO_TRADUCIDA", // lo lanza un disparador
  version_de_marca_numero_invalido: "NO_TRADUCIDA", // lo lanza un disparador
} as const satisfies Readonly<Record<string, string>>;

/** Los nombres que lanzan los disparadores de `marca` y `version_de_marca` con `ERRCODE '23514'`. */
export const RESTRICCIONES_DE_DISPARADORES_DE_MARCAS = [
  "marca_padre_retirada",
  "marca_inmutable",
  "marca_transicion_invalida",
  "version_de_marca_marca_retirada",
  "version_de_marca_transicion_invalida",
  "version_de_marca_inmutable",
  "version_de_marca_confirmada_inmutable",
  "version_de_marca_numero_invalido",
] as const satisfies readonly (keyof typeof ERRORES_DE_MARCAS_POR_RESTRICCION)[];

type MapaDeMarcas = typeof ERRORES_DE_MARCAS_POR_RESTRICCION;

/** Todo motivo al que puede traducirse una restricción de `marca` o `version_de_marca`. */
export type ErrorDeMarcaPorRestriccion = Exclude<MapaDeMarcas[keyof MapaDeMarcas], "NO_TRADUCIDA">;
