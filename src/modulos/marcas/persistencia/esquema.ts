/**
 * Esquema de base de los dominios (migración `0007_marcas_y_planes.sql`, tabla `dominio`). Lo comparan las
 * pruebas de integración contra la base real: si una columna o una restricción cambia en el SQL, estas
 * listas tienen que cambiar con ella. Marcas, versiones y planes todavía no tienen persistencia (M5).
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
