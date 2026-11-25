/**
 * Los errores de negocio del libro de saldos. Cada uno nace en el dominio (antes de escribir) o lo traduce la persistencia desde la restricción
 * de la base que lo repite (`persistencia/errores-por-restriccion.ts`). El libro NO autoriza: quien lo llama usa su propio guard antes.
 */
export const ERRORES_DEL_LIBRO = [
  "ACTOR_REQUERIDO",
  "PARTE_NO_ENCONTRADA",
  "PARTE_INACTIVA",
  "PARTE_ANONIMIZADA",
  "CLASE_NO_ADMITIDA",
  "SIGNO_DEL_IMPORTE_INVALIDO",
  "IMPORTE_INVALIDO",
  "MONEDA_NO_ADMITIDA",
  "ORIGEN_INVALIDO",
  "REFERENCIA_INVALIDA",
  "VENCIMIENTO_INVALIDO",
  "VENCIMIENTO_NO_ADMITIDO",
  "FECHA_INVALIDA",
  "DETALLE_INVALIDO",
  "DETALLE_OBLIGATORIO",
  "DETALLE_NO_ADMITIDO",
  "CLAVE_INVALIDA",
  "CLAVE_REUTILIZADA",
  "CLAVE_YA_USADA",
  "ORIGEN_YA_REGISTRADO",
  "ASIENTO_NO_ENCONTRADO",
  "ASIENTO_YA_ANULADO",
  "ASIENTO_ANULADO",
  "ASIENTO_CON_IMPUTACIONES",
  "ESPEJO_INVALIDO",
  "IMPUTACION_INVALIDA",
  "CREDITO_INSUFICIENTE",
  "DESHACER_SUPERA_LO_IMPUTADO",
  "DISTRIBUCION_INVALIDA",
  "SUCURSAL_NO_ENCONTRADA",
  "IMPORTE_SUPERA_LO_ADEUDADO",
] as const;

export type ErrorDelLibro = (typeof ERRORES_DEL_LIBRO)[number];
