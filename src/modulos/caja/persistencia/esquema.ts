import type { Generated } from "kysely";
import type { ClaseDeMovimiento, EstadoDeSesion, TipoDeCuenta, TipoDeMedio } from "../estados";

/**
 * Tablas de caja (0027): la configuración (`caja`, `medio_de_pago`, `cuenta_de_cobro`) y la operación (`sesion_caja`, `movimiento_caja`,
 * `arqueo_caja`, `arqueo_billete`, y `cobro`, que solo se LEE acá para saber el origen de un cobro: lo escribe el tramo del puerto de
 * cobrar). Las fechas (`date`) y las horas (`time`) se leen y escriben como texto; los importes (`numeric`) también: nunca `number`.
 */
export type CajaDb = {
  caja: {
    id: Generated<string>;
    empresa_id: string;
    sucursal_id: string;
    nombre: string;
    activa: Generated<boolean>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  medio_de_pago: {
    id: Generated<string>;
    empresa_id: string;
    tipo: TipoDeMedio;
    nombre: string | null;
    activo: Generated<boolean>;
    pide_cupon: Generated<boolean>;
    pide_ultimos4: Generated<boolean>;
    pide_marca: Generated<boolean>;
    pide_cuotas: Generated<boolean>;
    pide_dni: Generated<boolean>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  cuenta_de_cobro: {
    id: Generated<string>;
    empresa_id: string;
    tipo: TipoDeCuenta;
    nombre: string;
    identificador_externo: string | null;
    sucursal_id: string;
    activa: Generated<boolean>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  sesion_caja: {
    id: Generated<string>;
    empresa_id: string;
    caja_id: string;
    estado: Generated<EstadoDeSesion>;
    fecha_negocio: string;
    hora_de_corte: string;
    zona_horaria: string;
    abierta_en: Date;
    abierta_por: string;
    cierre_iniciado_en: Date | null;
    cierre_iniciado_por: string | null;
    cerrada_en: Date | null;
    cerrada_por: string | null;
    observacion: string | null;
    clave_idempotencia: string;
    huella: string;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  movimiento_caja: {
    id: Generated<string>;
    empresa_id: string;
    sesion_id: string;
    clase: ClaseDeMovimiento;
    medio_de_pago_id: string;
    cuenta_de_cobro_id: string | null;
    moneda: Generated<string>;
    importe: string;
    motivo: string | null;
    anula_a: string | null;
    corrige_jornada: string | null;
    registrado_en: Date;
    registrado_por: string;
    clave_idempotencia: string | null;
    huella: string | null;
    creado_en: Generated<Date>;
  };
  cobro: {
    movimiento_id: string;
    empresa_id: string;
    origen_tipo: string;
    origen_id: string;
    origen_orden: number;
    cupon: string | null;
    ultimos4: string | null;
    marca_de_tarjeta_id: string | null;
    cuotas: number | null;
    dni: string | null;
    creado_en: Generated<Date>;
  };
  arqueo_caja: {
    empresa_id: string;
    sesion_id: string;
    medio_de_pago_id: string;
    cuenta_de_cobro_id: string | null;
    moneda: Generated<string>;
    esperado: string;
    contado: string | null;
    contado_monedas: string | null;
    conforme: Generated<boolean>;
    conforme_por: string | null;
    conforme_en: Date | null;
    diferencia: Generated<string | null>;
    creado_en: Generated<Date>;
  };
  arqueo_billete: {
    empresa_id: string;
    sesion_id: string;
    denominacion: number;
    cantidad: number;
    creado_en: Generated<Date>;
  };
};

/** Tablas y columnas del módulo, en el orden de la base; un test las compara con el catálogo de la base. */
export const COLUMNAS_DE_CAJA = {
  caja: [
    "id",
    "empresa_id",
    "sucursal_id",
    "nombre",
    "activa",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  medio_de_pago: [
    "id",
    "empresa_id",
    "tipo",
    "nombre",
    "activo",
    "pide_cupon",
    "pide_ultimos4",
    "pide_marca",
    "pide_cuotas",
    "pide_dni",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  cuenta_de_cobro: [
    "id",
    "empresa_id",
    "tipo",
    "nombre",
    "identificador_externo",
    "sucursal_id",
    "activa",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  sesion_caja: [
    "id",
    "empresa_id",
    "caja_id",
    "estado",
    "fecha_negocio",
    "hora_de_corte",
    "zona_horaria",
    "abierta_en",
    "abierta_por",
    "cierre_iniciado_en",
    "cierre_iniciado_por",
    "cerrada_en",
    "cerrada_por",
    "observacion",
    "clave_idempotencia",
    "huella",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  movimiento_caja: [
    "id",
    "empresa_id",
    "sesion_id",
    "clase",
    "medio_de_pago_id",
    "cuenta_de_cobro_id",
    "moneda",
    "importe",
    "motivo",
    "anula_a",
    "corrige_jornada",
    "registrado_en",
    "registrado_por",
    "clave_idempotencia",
    "huella",
    "creado_en",
  ],
  cobro: [
    "movimiento_id",
    "empresa_id",
    "origen_tipo",
    "origen_id",
    "origen_orden",
    "cupon",
    "ultimos4",
    "marca_de_tarjeta_id",
    "cuotas",
    "dni",
    "creado_en",
  ],
  arqueo_caja: [
    "empresa_id",
    "sesion_id",
    "medio_de_pago_id",
    "cuenta_de_cobro_id",
    "moneda",
    "esperado",
    "contado",
    "contado_monedas",
    "conforme",
    "conforme_por",
    "conforme_en",
    "diferencia",
    "creado_en",
  ],
  arqueo_billete: ["empresa_id", "sesion_id", "denominacion", "cantidad", "creado_en"],
} as const;

/** Restricción de la base → error de negocio (ADR-004). Un test exige que no falte ninguna ni sobre ninguna. */
export const ERRORES_DE_CAJA_POR_RESTRICCION: Readonly<Record<string, string>> = {
  // caja
  caja_pkey: "NO_TRADUCIDA",
  caja_empresa_fkey: "NO_TRADUCIDA",
  caja_sucursal_fkey: "SUCURSAL_NO_ENCONTRADA",
  caja_id_empresa_uk: "NO_TRADUCIDA",
  caja_nombre_ck: "NOMBRE_DE_CAJA_INVALIDO",
  caja_nombre_uk: "CAJA_DUPLICADA",
  // Los lanzan los disparadores de la tabla (`caja_validar_cambio`): son la red de seguridad de la base.
  caja_sucursal_inmutable: "NO_TRADUCIDA",
  caja_con_sesion_vigente: "CAJA_CON_SESION_VIGENTE",
  // medio_de_pago
  medio_de_pago_pkey: "NO_TRADUCIDA",
  medio_de_pago_empresa_fkey: "NO_TRADUCIDA",
  medio_de_pago_id_empresa_uk: "NO_TRADUCIDA",
  medio_de_pago_tipo_ck: "TIPO_DE_MEDIO_INVALIDO",
  medio_de_pago_nombre_ck: "NOMBRE_DE_MEDIO_INVALIDO",
  medio_de_pago_efectivo_activo_ck: "EFECTIVO_NO_SE_DESACTIVA",
  // Sin traducción: el error de negocio lleva el dato (`DATO_NO_ADMITIDO_POR_EL_MEDIO { dato }`) y lo decide el dominio antes.
  medio_de_pago_datos_ck: "NO_TRADUCIDA",
  medio_de_pago_efectivo_uk: "EFECTIVO_YA_EXISTE",
  medio_de_pago_nombre_uk: "MEDIO_DUPLICADO",
  medio_de_pago_sin_nombre_uk: "MEDIO_DUPLICADO",
  medio_de_pago_tipo_inmutable: "NO_TRADUCIDA",
  // cuenta_de_cobro
  cuenta_de_cobro_pkey: "NO_TRADUCIDA",
  cuenta_de_cobro_empresa_fkey: "NO_TRADUCIDA",
  cuenta_de_cobro_sucursal_fkey: "SUCURSAL_NO_ENCONTRADA",
  cuenta_de_cobro_id_empresa_uk: "NO_TRADUCIDA",
  cuenta_de_cobro_tipo_ck: "TIPO_DE_CUENTA_INVALIDO",
  cuenta_de_cobro_nombre_ck: "NOMBRE_DE_CUENTA_INVALIDO",
  cuenta_de_cobro_identificador_ck: "IDENTIFICADOR_EXTERNO_INVALIDO",
  cuenta_de_cobro_nombre_uk: "CUENTA_DUPLICADA",
  cuenta_de_cobro_tipo_inmutable: "NO_TRADUCIDA",
  // sesion_caja
  sesion_caja_pkey: "NO_TRADUCIDA",
  sesion_caja_empresa_fkey: "NO_TRADUCIDA",
  sesion_caja_caja_fkey: "CAJA_NO_ENCONTRADA",
  sesion_caja_abierta_por_fkey: "NO_TRADUCIDA",
  sesion_caja_iniciado_por_fkey: "NO_TRADUCIDA",
  sesion_caja_cerrada_por_fkey: "NO_TRADUCIDA",
  sesion_caja_id_empresa_uk: "NO_TRADUCIDA",
  // Dos aperturas con la misma clave a la vez: el reintento serializable ve la sesión ya hecha y devuelve `yaExistia`.
  sesion_caja_clave_uk: "NO_TRADUCIDA",
  sesion_caja_estado_ck: "NO_TRADUCIDA",
  sesion_caja_fecha_ck: "NO_TRADUCIDA",
  sesion_caja_hora_de_corte_ck: "NO_TRADUCIDA",
  sesion_caja_zona_horaria_ck: "NO_TRADUCIDA",
  sesion_caja_clave_ck: "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
  sesion_caja_huella_ck: "NO_TRADUCIDA",
  sesion_caja_cierre_ck: "NO_TRADUCIDA",
  sesion_caja_observacion_ck: "OBSERVACION_INVALIDA",
  // Dos aperturas de la misma caja a la vez: el reintento serializable ve la sesión vigente y devuelve `CAJA_YA_ABIERTA { sesionId }`
  // (el error lleva el id: no se traduce desde la restricción).
  sesion_caja_vigente_uk: "NO_TRADUCIDA",
  // Los lanzan los disparadores (`sesion_caja_validar_alta`, `_validar_cambio` y `_verificar_cierre`): son la red de seguridad de la base.
  sesion_caja_actor_invalido: "NO_TRADUCIDA",
  sesion_caja_caja_inactiva: "CAJA_INACTIVA",
  sesion_caja_sucursal_inactiva: "SUCURSAL_INACTIVA",
  sesion_caja_sello_invalido: "NO_TRADUCIDA",
  sesion_caja_fecha_negocio_invalida: "NO_TRADUCIDA",
  sesion_caja_jornada_no_abierta: "NO_TRADUCIDA",
  sesion_caja_inmutable: "NO_TRADUCIDA",
  sesion_caja_cerrada_congelada: "SESION_CERRADA",
  sesion_caja_transicion_invalida: "NO_TRADUCIDA",
  sesion_caja_arqueo_incompleto: "NO_TRADUCIDA",
  sesion_caja_arqueo_no_cuadra: "NO_TRADUCIDA",
  sesion_caja_conteo_no_cuadra: "NO_TRADUCIDA",
  sesion_caja_conforme_invalido: "NO_TRADUCIDA",
  // movimiento_caja
  movimiento_caja_pkey: "NO_TRADUCIDA",
  movimiento_caja_empresa_fkey: "NO_TRADUCIDA",
  movimiento_caja_sesion_fkey: "SESION_NO_ENCONTRADA",
  movimiento_caja_medio_fkey: "MEDIO_NO_ENCONTRADO",
  movimiento_caja_cuenta_fkey: "CUENTA_DE_COBRO_NO_ENCONTRADA",
  movimiento_caja_registrado_por_fkey: "NO_TRADUCIDA",
  movimiento_caja_id_empresa_uk: "NO_TRADUCIDA",
  movimiento_caja_id_sesion_uk: "NO_TRADUCIDA",
  movimiento_caja_anula_fkey: "NO_TRADUCIDA",
  // Dos anulaciones del mismo movimiento a la vez: el reintento serializable ve la anulación y devuelve `MOVIMIENTO_YA_ANULADO`.
  movimiento_caja_anula_uk: "MOVIMIENTO_YA_ANULADO",
  movimiento_caja_clave_uk: "NO_TRADUCIDA",
  movimiento_caja_fondo_uk: "NO_TRADUCIDA",
  movimiento_caja_clase_ck: "NO_TRADUCIDA",
  movimiento_caja_moneda_ck: "NO_TRADUCIDA",
  movimiento_caja_tope_ck: "IMPORTE_INVALIDO",
  movimiento_caja_signo_ck: "IMPORTE_INVALIDO",
  movimiento_caja_anulacion_ck: "NO_TRADUCIDA",
  movimiento_caja_motivo_requerido_ck: "MOTIVO_INVALIDO",
  movimiento_caja_motivo_ck: "MOTIVO_INVALIDO",
  movimiento_caja_corrige_jornada_ck: "NO_TRADUCIDA",
  movimiento_caja_clave_ck: "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
  movimiento_caja_huella_ck: "NO_TRADUCIDA",
  movimiento_caja_idempotencia_ck: "NO_TRADUCIDA",
  // Los lanza `movimiento_caja_validar_alta` (y el diferido de los cobros): red de seguridad de la base. Los que llevan un dato en el
  // error (`MOVIMIENTO_CON_ORIGEN { origenTipo, origenId }`) o dependen del estado exacto de la sesión no se traducen desde acá.
  movimiento_caja_actor_invalido: "NO_TRADUCIDA",
  movimiento_caja_sesion_no_abierta: "NO_TRADUCIDA",
  movimiento_caja_jornada_no_abierta: "NO_TRADUCIDA",
  movimiento_caja_anulacion_con_origen: "NO_TRADUCIDA",
  movimiento_caja_anulacion_invalida: "NO_TRADUCIDA",
  movimiento_caja_solo_efectivo: "NO_TRADUCIDA",
  movimiento_caja_corrige_jornada_inexistente: "JORNADA_A_CORREGIR_NO_ENCONTRADA",
  movimiento_caja_corrige_jornada_no_cerrada: "JORNADA_A_CORREGIR_NO_CERRADA",
  movimiento_caja_corrige_jornada_no_anterior: "JORNADA_A_CORREGIR_NO_ANTERIOR",
  movimiento_caja_sin_documento: "NO_TRADUCIDA",
  // arqueo_caja y arqueo_billete
  arqueo_caja_uk: "NO_TRADUCIDA",
  arqueo_caja_empresa_fkey: "NO_TRADUCIDA",
  arqueo_caja_sesion_fkey: "NO_TRADUCIDA",
  arqueo_caja_medio_fkey: "NO_TRADUCIDA",
  arqueo_caja_cuenta_fkey: "NO_TRADUCIDA",
  arqueo_caja_conforme_por_fkey: "NO_TRADUCIDA",
  arqueo_caja_moneda_ck: "NO_TRADUCIDA",
  arqueo_caja_contado_ck: "NO_TRADUCIDA",
  arqueo_caja_monedas_ck: "NO_TRADUCIDA",
  arqueo_caja_conforme_ck: "NO_TRADUCIDA",
  // Los lanzan `arqueo_caja_validar_alta` y el diferido: el dominio ya los decide antes (red de seguridad de la base).
  arqueo_caja_actor_invalido: "NO_TRADUCIDA",
  arqueo_caja_efectivo_conforme: "CONFORME_NO_ADMITIDO_EN_EFECTIVO",
  arqueo_caja_efectivo_sin_contar: "CONTEO_DE_EFECTIVO_FALTANTE",
  arqueo_caja_monedas_solo_efectivo: "NO_TRADUCIDA",
  arqueo_caja_sesion_invalida: "NO_TRADUCIDA",
  arqueo_billete_pkey: "NO_TRADUCIDA",
  arqueo_billete_empresa_fkey: "NO_TRADUCIDA",
  arqueo_billete_sesion_fkey: "NO_TRADUCIDA",
  arqueo_billete_denominacion_ck: "NO_TRADUCIDA",
  arqueo_billete_cantidad_ck: "NO_TRADUCIDA",
};
