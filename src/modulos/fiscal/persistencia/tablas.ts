import type { ColumnType, Generated } from "kysely";
import type { COLUMNAS_DE_FISCAL } from "./esquema";

/**
 * Tablas fiscales tal como las ve Kysely (migraciones 0006 y 0009). Las columnas son las de
 * `COLUMNAS_DE_FISCAL`, que un test compara con el catálogo de la base real; el tipo del final hace
 * que el compilador exija que ambas listas digan lo mismo.
 *
 * Cuatro cosas a tener en cuenta al leer o escribir:
 *  - `ultimo_numero` y `numero_en_curso` son `bigint` en la base y `pg` los devuelve como TEXTO: el
 *    repositorio los convierte (el dominio usa `bigint`) y los escribe como texto.
 *  - `inicio_actividades` es `date`: `pg` lo devolvería como un `Date` a la medianoche local, que
 *    corre un día según el huso. Se lee siempre con `to_char(..., 'YYYY-MM-DD')`.
 *  - Dinero y cantidades (`numeric`) viajan como TEXTO decimal, nunca como `number` (ADR-006): `pg` ya
 *    los devuelve como texto y se escriben como texto. Los `bytea` (la clave y la credencial cifradas) son
 *    `Uint8Array`; el `jsonb` de los mensajes de ARCA se escribe como texto JSON y se lee ya parseado.
 *  - Las tablas de la facturación (`comprobante` y siguientes) son de 0009; las leen y escriben solo los
 *    repositorios de comprobantes, intentos y certificados.
 */

/** Una columna `date`: se lee con `to_char(..., 'YYYY-MM-DD')` y se escribe como texto `YYYY-MM-DD`. */
type Fecha = string;
/** Una columna `jsonb`: se escribe como texto JSON (un arreglo de JS se mandaría como arreglo de Postgres). */
type Json = ColumnType<unknown, string, string>;
export type FiscalDb = {
  /**
   * Solo lectura y solo tres columnas: el CUIT del emisor principal ES `empresa.cuit` (spec §B.2) y
   * el repositorio de emisores lo une. Esta tabla es del módulo de empresas; acá no se escribe.
   */
  empresa: {
    id: string;
    cuit: string;
    estado: string;
  };
  provincia: {
    codigo: string;
    nombre: string;
    codigo_arca: number | null;
  };
  emisor: {
    id: Generated<string>;
    empresa_id: string;
    es_principal: boolean;
    activo: Generated<boolean>;
    cuit: string | null;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  domicilio: {
    id: Generated<string>;
    empresa_id: string;
    calle: string;
    numero: string;
    piso: string | null;
    departamento: string | null;
    localidad: string;
    provincia: string;
    codigo_postal: string | null;
    creado_en: Generated<Date>;
  };
  datos_fiscales: {
    id: Generated<string>;
    empresa_id: string;
    emisor_id: string;
    estado: Generated<string>;
    numero: number | null;
    razon_social: string | null;
    condicion_iva: string | null;
    domicilio_fiscal_id: string | null;
    inicio_actividades: string | null;
    iibb_numero: string | null;
    iibb_condicion: string | null;
    vigente_desde: Date | null;
    confirmada_en: Date | null;
    confirmada_por: string | null;
    motivo: string | null;
    creado_por: string;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  regla_emisor: {
    id: Generated<string>;
    empresa_id: string;
    estado: Generated<string>;
    numero: number | null;
    permitir_eleccion_manual: Generated<boolean>;
    vigente_desde: Date | null;
    confirmada_en: Date | null;
    confirmada_por: string | null;
    motivo: string | null;
    creado_por: string;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  punto_de_venta: {
    id: Generated<string>;
    empresa_id: string;
    emisor_id: string;
    sucursal_id: string;
    domicilio_id: string | null;
    numero: number;
    estado: Generated<string>;
    verificacion_arca: Generated<string>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
    /** 0009: HOMOLOGACION o PRODUCCION. Lo lee la facturación (F3); T4 no lo usa. */
    ambiente: Generated<string>;
  };
  serie_comprobante: {
    empresa_id: string;
    punto_de_venta_id: string;
    emisor_id: string;
    tipo_comprobante: string;
    ultimo_numero: string;
    estado: Generated<string>;
    numero_en_curso: string | null;
    solicitud_en_curso: string | null;
    en_curso_hasta: Date | null;
    motivo_bloqueo: string | null;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
    /** 0009: parte de la clave de la serie. Sin valor por defecto: se dice siempre. */
    ambiente: string;
  };

  /**
   * 0009: el comprobante fiscal. El contenido nace completo y no cambia nunca; solo se mueven las
   * columnas de estado (`estado` a `motivo_descarte`), y la base impone las transiciones.
   */
  comprobante: {
    id: string;
    empresa_id: string;
    emisor_id: string;
    punto_de_venta_id: string;
    ambiente: string;
    origen_tipo: string;
    origen_id: string;
    clase: string;
    tipo_comprobante: string;
    concepto: string;
    servicio_desde: Fecha | null;
    servicio_hasta: Fecha | null;
    vencimiento_pago: Fecha | null;
    moneda: string;
    modo_de_precio: string;
    total: string;
    neto_gravado: string;
    iva: string;
    exento: string;
    no_gravado: string;
    datos_fiscales_id: string;
    emisor_cuit: string;
    emisor_razon_social: string;
    emisor_condicion_iva: string;
    emisor_domicilio_fiscal: string;
    emisor_inicio_actividades: Fecha;
    emisor_iibb_numero: string | null;
    emisor_iibb_condicion: string | null;
    punto_de_venta_numero: number;
    punto_de_venta_domicilio: string;
    receptor_parte_id: string | null;
    receptor_nombre: string | null;
    receptor_documento_tipo: string;
    receptor_documento_numero: string | null;
    receptor_condicion_iva: string;
    receptor_domicilio: string | null;
    comprobante_asociado_id: string | null;
    motivo: string | null;
    estado: Generated<string>;
    envios: Generated<number>;
    numero_reservado: string | null;
    fecha_emision: Fecha | null;
    numero: string | null;
    cae: string | null;
    cae_vence: Fecha | null;
    autorizado_en: Date | null;
    resuelto_por: string | null;
    motivo_descarte: string | null;
    huella: string;
    version_de_representacion: Generated<number>;
    creado_por: string;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
    /** 0016: la sucursal del punto de venta al emitirse. La copia la base en el alta (la aplicación no la manda) y no cambia nunca. */
    sucursal_id: Generated<string>;
  };
  /** 0009: los renglones del comprobante, de solo inserción. `posicion` desde 1. */
  comprobante_linea: {
    empresa_id: string;
    comprobante_id: string;
    posicion: number;
    descripcion: string;
    cantidad: string;
    precio_unitario: string;
    descuento: string | null;
    alicuota: string | null;
    importe: string;
  };
  /** 0009: el desglose por alícuota que se informa a ARCA, de solo inserción. */
  comprobante_alicuota: {
    empresa_id: string;
    comprobante_id: string;
    alicuota: string;
    total: string;
    neto: string;
    iva: string;
  };
  /**
   * 0009: el certificado de ARCA. La clave privada vive acá CIFRADA (`clave_*`): nada que no sea el
   * repositorio de certificados la nombra ni la devuelve.
   */
  certificado_arca: {
    id: string;
    empresa_id: string;
    emisor_id: string;
    ambiente: string;
    alias: string;
    cuit_titular: string;
    estado: Generated<string>;
    pedido_pem: string;
    certificado_pem: string | null;
    huella_sha256: string | null;
    vence_en: Date | null;
    autorizacion_verificada_en: Date | null;
    clave_cifrada: Uint8Array;
    clave_nonce: Uint8Array;
    clave_etiqueta: Uint8Array;
    clave_kid: string;
    creado_por: string;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  /** 0009: la credencial de acceso a ARCA (WSAA) cifrada. Es un caché que se actualiza en el lugar. */
  acceso_arca: {
    empresa_id: string;
    certificado_id: string;
    servicio: string;
    credencial_cifrada: Uint8Array | null;
    credencial_nonce: Uint8Array | null;
    credencial_etiqueta: Uint8Array | null;
    credencial_kid: string | null;
    generado_en: Date | null;
    expira_en: Date | null;
    renovando_hasta: Date | null;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  /** 0009: cada llamada a ARCA por un comprobante, de solo inserción. */
  intento_arca: {
    id: string;
    empresa_id: string;
    comprobante_id: string;
    operacion: string;
    numero: string | null;
    desenlace: string;
    mensajes: Json;
    respuesta: string | null;
    huella_pedido: string | null;
    iniciado_en: Date;
    duracion_ms: number;
  };
};

type Tabla = keyof typeof COLUMNAS_DE_FISCAL;
type Iguales<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Verificación en tiempo de compilación: para cada tabla fiscal, las columnas de `FiscalDb` son
 * exactamente las de `COLUMNAS_DE_FISCAL`. Si una lista cambia sin la otra, esto no compila.
 */
export type ColumnasCoinciden = {
  [T in Tabla]: Iguales<keyof FiscalDb[T], (typeof COLUMNAS_DE_FISCAL)[T][number]>;
}[Tabla] extends true
  ? true
  : never;
export const COLUMNAS_COINCIDEN: ColumnasCoinciden = true;
