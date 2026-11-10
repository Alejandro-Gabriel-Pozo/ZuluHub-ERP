/**
 * Los vocabularios cerrados de caja (E3 §3.1, §3.3 y §3.6). Viven fuera de `dominio/` porque los nombran también las consultas y la
 * persistencia, que no importan el dominio (regla `consultas-sin-dominio`, ADR-005); el dominio los importa de acá. Cada lista repite
 * un CHECK de `0027_caja.sql` (`sesion_caja_estado_ck`, `movimiento_caja_clase_ck`, `medio_de_pago_tipo_ck`,
 * `cuenta_de_cobro_tipo_ck`, `conciliacion_de_jornada_estado_ck`): una prueba de integración las compara. Previene que el código y la
 * base acepten valores distintos.
 */
export const ESTADOS_DE_SESION = ["ABIERTA", "EN_CIERRE", "CERRADA"] as const;
export type EstadoDeSesion = (typeof ESTADOS_DE_SESION)[number];

/** Sin `DEVOLUCION`: no hay devoluciones ni saldo a favor (decisión 152). */
export const CLASES_DE_MOVIMIENTO = [
  "FONDO_INICIAL",
  "COBRO",
  "INGRESO_MANUAL",
  "EGRESO_MANUAL",
  "AJUSTE",
  "ANULACION",
] as const;
export type ClaseDeMovimiento = (typeof CLASES_DE_MOVIMIENTO)[number];

export const TIPOS_DE_MEDIO = [
  "EFECTIVO",
  "TARJETA_DEBITO",
  "TARJETA_CREDITO",
  "TRANSFERENCIA",
  "QR",
  "OTRO",
] as const;
export type TipoDeMedio = (typeof TIPOS_DE_MEDIO)[number];

export const TIPOS_DE_CUENTA = ["TERMINAL", "QR", "CUENTA_BANCARIA"] as const;
export type TipoDeCuenta = (typeof TIPOS_DE_CUENTA)[number];

/** Los datos opcionales de un cobro (decisión 129). Los nombres son los de `datosQuePide` del puerto de cobrar (e3 §3.5). */
export const DATOS_DEL_COBRO = ["cupon", "ultimos4", "marca", "cuotas", "dni"] as const;
export type DatoDelCobro = (typeof DATOS_DEL_COBRO)[number];

/** Cómo se sabe el total de una línea de la conciliación (e3b §4.4). El efectivo es siempre `CONTADO`. */
export const ESTADOS_DE_CONTEO = ["CONTADO", "DECLARADO", "CONFORME", "SIN_DATO"] as const;
export type EstadoDeConteo = (typeof ESTADOS_DE_CONTEO)[number];
