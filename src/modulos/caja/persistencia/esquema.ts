import type { Generated } from "kysely";
import type { TipoDeCuenta, TipoDeMedio } from "../estados";

/**
 * Tablas de configuración de caja (0027): `caja`, `medio_de_pago` y `cuenta_de_cobro`. Los tramos siguientes suman acá las de la
 * operación (`sesion_caja`, `movimiento_caja`, `cobro`, `arqueo_*`) y sus columnas y restricciones a los mapas de abajo.
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
};
