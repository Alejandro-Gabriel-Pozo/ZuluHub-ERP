import type { Generated } from "kysely";
import type { Severidad } from "../aporte-al-cierre";
import type { EstadoDeJornada } from "../estados";

/**
 * Tablas del módulo (0026). `fecha_negocio` es un `date`: el controlador lo entregaría como un `Date` a medianoche local (con el
 * corrimiento de un día que eso trae), así que se LEE siempre como texto (`::text`, `YYYY-MM-DD`) y se ESCRIBE como texto.
 */
export type CierreDb = {
  jornada_de_sucursal: {
    empresa_id: string;
    sucursal_id: string;
    fecha_negocio: string;
    estado: Generated<EstadoDeJornada>;
    auditoria_iniciada_en: Date | null;
    auditoria_iniciada_por: string | null;
    cerrada_en: Date | null;
    cerrada_por: string | null;
    huella_de_cierre: string | null;
    observacion: string | null;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  control_de_jornada_cerrada: {
    empresa_id: string;
    sucursal_id: string;
    fecha_negocio: string;
    modulo: string;
    clave: string;
    severidad: Severidad;
    cantidad: number;
    reconocido: boolean;
    reconocido_en: Date | null;
    reconocido_por: string | null;
    texto: string | null;
    creado_en: Generated<Date>;
  };
};

/** Tablas y columnas del módulo; un test compara estas columnas con el catálogo de la base. */
export const COLUMNAS_DE_CIERRE = {
  jornada_de_sucursal: [
    "empresa_id",
    "sucursal_id",
    "fecha_negocio",
    "estado",
    "auditoria_iniciada_en",
    "auditoria_iniciada_por",
    "cerrada_en",
    "cerrada_por",
    "huella_de_cierre",
    "observacion",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  control_de_jornada_cerrada: [
    "empresa_id",
    "sucursal_id",
    "fecha_negocio",
    "modulo",
    "clave",
    "severidad",
    "cantidad",
    "reconocido",
    "reconocido_en",
    "reconocido_por",
    "texto",
    "creado_en",
  ],
} as const;

/** Restricción de la base → error de negocio (ADR-004). Un test exige que no falte ninguna. */
export const ERRORES_DE_CIERRE_POR_RESTRICCION: Readonly<Record<string, string>> = {
  jornada_de_sucursal_pkey: "NO_TRADUCIDA",
  jornada_sucursal_fkey: "SUCURSAL_NO_ENCONTRADA",
  jornada_iniciada_por_fkey: "NO_TRADUCIDA",
  jornada_cerrada_por_fkey: "NO_TRADUCIDA",
  jornada_estado_ck: "NO_TRADUCIDA",
  jornada_fecha_ck: "FECHA_INVALIDA",
  jornada_estado_marcas_ck: "NO_TRADUCIDA",
  jornada_huella_ck: "NO_TRADUCIDA",
  jornada_observacion_ck: "OBSERVACION_INVALIDA",
  // Los lanzan los disparadores (`jornada_validar_cambio`, `control_de_jornada_validar_alta`): son la red de seguridad de la base.
  jornada_inmutable: "NO_TRADUCIDA",
  jornada_cerrada_congelada: "JORNADA_CERRADA",
  jornada_persona_del_contexto: "NO_TRADUCIDA",
  jornada_transicion_invalida: "NO_TRADUCIDA",
  control_de_jornada_cerrada_pkey: "NO_TRADUCIDA",
  control_jornada_fkey: "NO_TRADUCIDA",
  control_reconocido_por_fkey: "NO_TRADUCIDA",
  control_modulo_ck: "NO_TRADUCIDA",
  control_clave_ck: "NO_TRADUCIDA",
  control_severidad_ck: "NO_TRADUCIDA",
  control_cantidad_ck: "NO_TRADUCIDA",
  control_reconocido_ck: "NO_TRADUCIDA",
  control_texto_ck: "NO_TRADUCIDA",
  control_solo_al_cerrar: "NO_TRADUCIDA",
};
