import type { Generated } from "kysely";
import type { ClaseDeMovimiento, EstadoDeSesion, TipoDeCuenta, TipoDeMedio } from "../estados";

/**
 * Tablas de caja (0027): la configuración (`caja`, `medio_de_pago`, `cuenta_de_cobro`) y la operación (`sesion_caja`, `movimiento_caja`,
 * `arqueo_caja`, `arqueo_billete` y `cobro`, que escribe el puerto de cobrar) y, de solo lectura para la app, `valor_de_lista` (las marcas de
 * tarjeta) y `correccion_de_medio` (el medio vigente de un cobro; la corrección la escribe el tramo siguiente). Las fechas (`date`) y las horas (`time`) se leen y escriben como texto; los importes (`numeric`) también: nunca `number`.
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
  /** Lista del sistema, global (sin `empresa_id`): la app solo la lee. Hoy la usa el cobro (marcas de tarjeta). */
  valor_de_lista: {
    id: Generated<string>;
    lista: "MARCAS_DE_TARJETA" | "MOTIVOS_DE_RECHAZO";
    nombre: string;
    activo: Generated<boolean>;
    fija: Generated<boolean>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  correccion_de_medio: {
    id: Generated<string>;
    empresa_id: string;
    cobro_id: string;
    secuencia: number;
    sucursal_id: string;
    fecha_negocio: string;
    medio_antes_id: string;
    cuenta_antes_id: string | null;
    medio_despues_id: string;
    cuenta_despues_id: string | null;
    motivo: string;
    corregido_en: Date;
    corregido_por: string;
    clave_idempotencia: string;
    huella: string;
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
  valor_de_lista: [
    "id",
    "lista",
    "nombre",
    "activo",
    "fija",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  correccion_de_medio: [
    "id",
    "empresa_id",
    "cobro_id",
    "secuencia",
    "sucursal_id",
    "fecha_negocio",
    "medio_antes_id",
    "cuenta_antes_id",
    "medio_despues_id",
    "cuenta_despues_id",
    "motivo",
    "corregido_en",
    "corregido_por",
    "clave_idempotencia",
    "huella",
    "creado_en",
  ],
} as const;
