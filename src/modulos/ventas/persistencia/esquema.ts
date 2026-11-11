import type { Generated } from "kysely";
import type { EstadoDeCuenta, EstadoDeLinea, EstadoDeTicket } from "../dominio/estados";

/**
 * Las tablas de ventas (0028). Los decimales llegan como TEXTO (`numeric` de Postgres): nunca se pasan por `number` (ADR-006). `fecha_negocio`
 * es un `date`: el controlador lo entregaría como un `Date` a medianoche local (con el corrimiento de un día que eso trae), así que se LEE
 * siempre como texto (`::text`, `YYYY-MM-DD`). Un test compara estas columnas con el catálogo de la base (`ventas-persistencia.test.ts`).
 */
export type VentasDb = {
  /** 0029 (E1): el puntero de cada ticket al comprobante que lo facturó. Solo `vigente` y `no_vigente_en` se actualizan. */
  documento_de_ticket: {
    id: string;
    empresa_id: string;
    ticket_id: string;
    ejemplar_id: string;
    intento: number;
    clave: string;
    comprobante_id: string;
    vigente: Generated<boolean>;
    creado_en: Date;
    creado_por: string;
    no_vigente_en: Date | null;
  };
  aplicacion_de_cobro: {
    empresa_id: string;
    cobranza_id: string;
    orden: number;
    cobro_id: string;
    cuenta_de_cobro_id: string | null;
    importe: string;
    creado_en: Generated<Date>;
  };
  cobranza_de_ticket: {
    id: string;
    empresa_id: string;
    ticket_id: string;
    ejemplar_id: string;
    caja_id: string;
    clave: string;
    huella: string;
    destino: Generated<string>;
    resultado: Readonly<Record<string, unknown>> | null;
    creada_por: string;
    creada_en: Date;
    creado_en: Generated<Date>;
  };
  cuenta_consumo: {
    id: string;
    empresa_id: string;
    sucursal_id: string;
    ancla_tipo: string | null;
    ancla_id: string | null;
    etiqueta: string | null;
    estado: Generated<EstadoDeCuenta>;
    moneda: Generated<string>;
    total_provisorio: Generated<string>;
    ultima_posicion: Generated<number>;
    momento_de_stock: Generated<string>;
    abierta_por: string;
    abierta_en: Date;
    resuelta_por: string | null;
    resuelta_en: Date | null;
    motivo: string | null;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  ejemplar_grupo: {
    empresa_id: string;
    ejemplar_id: string;
    orden: number;
    total: string;
    emisor_id: string | null;
  };
  ejemplar_linea: {
    empresa_id: string;
    ejemplar_id: string;
    grupo_orden: number;
    linea_cuenta_id: string;
    cantidad: string;
    importe: string;
  };
  linea_cuenta: {
    id: string;
    empresa_id: string;
    cuenta_id: string;
    posicion: number;
    producto_id: string;
    descripcion: string;
    variante_opcion_id: string | null;
    variante_nombre: string | null;
    precio_id: string | null;
    origen_del_precio: string;
    moneda: Generated<string>;
    precio_base: string;
    precio_unitario: string;
    cantidad: string;
    unidad_de_venta: string;
    paso_de_cantidad: string;
    alicuota: string;
    controla_stock: Generated<boolean>;
    estado: Generated<EstadoDeLinea>;
    anulada_por: string | null;
    anulada_en: Date | null;
    motivo_de_anulacion: string | null;
    creada_por: string;
    creada_en: Date;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
    /** La versión de la opción de la variante que se vendió (0036): de ella sale el factor de tamaño del consumo de stock. Nula en las líneas anteriores. */
    variante_version_de_opcion_id: string | null;
  };
  linea_cuenta_opcion: {
    empresa_id: string;
    linea_id: string;
    orden: number;
    opcion_id: string;
    version_de_opcion_id: string;
    grupo_id: string;
    nombre_de_grupo: string;
    nombre: string;
    clase: string;
    recargo: string;
    origen_del_recargo: string;
    creado_en: Generated<Date>;
  };
  numerador_ticket: {
    empresa_id: string;
    sucursal_id: string;
    ultimo: Generated<number>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  ticket: {
    id: Generated<string>;
    empresa_id: string;
    sucursal_id: string;
    cuenta_id: string;
    numero: number;
    fecha_negocio: Generated<string>;
    estado: EstadoDeTicket;
    moneda: Generated<string>;
    total: string;
    sesion_de_caja_id: string | null;
    ejemplar_vigente: Generated<number>;
    emitido_por: string;
    emitido_en: Date;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  ticket_correccion: {
    id: string;
    empresa_id: string;
    ticket_id: string;
    ejemplar_base_id: string;
    ejemplar_nuevo_id: string;
    tipo: string;
    motivo: string;
    clave: string;
    huella: string;
    resultado: Readonly<Record<string, unknown>>;
    hecha_por: string;
    hecha_en: Date;
    fecha_negocio: Generated<string>;
    creado_en: Generated<Date>;
  };
  ticket_ejemplar: {
    id: string;
    empresa_id: string;
    ticket_id: string;
    numero_de_ejemplar: number;
    tipo: string;
    total: string;
    ejemplar_base_id: string | null;
    creado_por: string;
    creado_en: Date;
  };
};

/** Tablas y columnas del módulo, en el orden de la base; un test las compara con el catálogo. */
export const COLUMNAS_DE_VENTAS = {
  documento_de_ticket: [
    "id",
    "empresa_id",
    "ticket_id",
    "ejemplar_id",
    "intento",
    "clave",
    "comprobante_id",
    "vigente",
    "creado_en",
    "creado_por",
    "no_vigente_en",
  ],
  aplicacion_de_cobro: [
    "empresa_id",
    "cobranza_id",
    "orden",
    "cobro_id",
    "cuenta_de_cobro_id",
    "importe",
    "creado_en",
  ],
  cobranza_de_ticket: [
    "id",
    "empresa_id",
    "ticket_id",
    "ejemplar_id",
    "caja_id",
    "clave",
    "huella",
    "destino",
    "resultado",
    "creada_por",
    "creada_en",
    "creado_en",
  ],
  cuenta_consumo: [
    "id",
    "empresa_id",
    "sucursal_id",
    "ancla_tipo",
    "ancla_id",
    "etiqueta",
    "estado",
    "moneda",
    "total_provisorio",
    "ultima_posicion",
    "momento_de_stock",
    "abierta_por",
    "abierta_en",
    "resuelta_por",
    "resuelta_en",
    "motivo",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  ejemplar_grupo: ["empresa_id", "ejemplar_id", "orden", "total", "emisor_id"],
  ejemplar_linea: [
    "empresa_id",
    "ejemplar_id",
    "grupo_orden",
    "linea_cuenta_id",
    "cantidad",
    "importe",
  ],
  linea_cuenta: [
    "id",
    "empresa_id",
    "cuenta_id",
    "posicion",
    "producto_id",
    "descripcion",
    "variante_opcion_id",
    "variante_nombre",
    "precio_id",
    "origen_del_precio",
    "moneda",
    "precio_base",
    "precio_unitario",
    "cantidad",
    "unidad_de_venta",
    "paso_de_cantidad",
    "alicuota",
    "controla_stock",
    "estado",
    "anulada_por",
    "anulada_en",
    "motivo_de_anulacion",
    "creada_por",
    "creada_en",
    "creado_en",
    "actualizado_en",
    "version",
    "variante_version_de_opcion_id",
  ],
  linea_cuenta_opcion: [
    "empresa_id",
    "linea_id",
    "orden",
    "opcion_id",
    "version_de_opcion_id",
    "grupo_id",
    "nombre_de_grupo",
    "nombre",
    "clase",
    "recargo",
    "origen_del_recargo",
    "creado_en",
  ],
  numerador_ticket: [
    "empresa_id",
    "sucursal_id",
    "ultimo",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  ticket: [
    "id",
    "empresa_id",
    "sucursal_id",
    "cuenta_id",
    "numero",
    "fecha_negocio",
    "estado",
    "moneda",
    "total",
    "sesion_de_caja_id",
    "ejemplar_vigente",
    "emitido_por",
    "emitido_en",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  ticket_correccion: [
    "id",
    "empresa_id",
    "ticket_id",
    "ejemplar_base_id",
    "ejemplar_nuevo_id",
    "tipo",
    "motivo",
    "clave",
    "huella",
    "resultado",
    "hecha_por",
    "hecha_en",
    "fecha_negocio",
    "creado_en",
  ],
  ticket_ejemplar: [
    "id",
    "empresa_id",
    "ticket_id",
    "numero_de_ejemplar",
    "tipo",
    "total",
    "ejemplar_base_id",
    "creado_por",
    "creado_en",
  ],
} as const;
