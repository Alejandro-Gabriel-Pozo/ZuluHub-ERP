import type { ColumnType, Generated } from "kysely";
import { COLUMNAS_DE_LOTES, type TablasDeLotes } from "./esquema-de-lotes";
import type { TablasDeCatalogoQueLeeStock } from "./tablas";

/**
 * Las tablas de stock (0030 y los costos de 0031). Los decimales (`numeric`) llegan y se escriben como TEXTO: nunca se pasan por `number` (ADR-006). Las fechas de
 * negocio (`date`) las devuelve `pg` como `Date` a la medianoche local, que corre un día según el huso: se leen SIEMPRE con `::text` y se
 * escriben como texto con `::date` (los repositorios lo hacen; ninguna lectura usa `selectAll` sobre una tabla con `date`). Un test compara
 * estas columnas con el catálogo de la base (`stock-persistencia.test.ts`).
 */

/** Una columna `date` que escribe la aplicación solo en un caso (la salida por venta) y que en los demás completa la base. */
type FechaDeNegocioDelLibro = ColumnType<string, string | null, never>;

export type StockDb = TablasDeCatalogoQueLeeStock &
  TablasDeLotes & {
    deposito: {
      /** Lo manda la aplicación (idempotencia del alta); si no lo manda, lo genera la base. */
      id: Generated<string>;
      empresa_id: string;
      sucursal_id: string;
      nombre: string;
      nombre_clave: string;
      uso: string;
      de_venta: Generated<boolean>;
      activo: Generated<boolean>;
      creado_en: Generated<Date>;
      actualizado_en: Generated<Date>;
      version: Generated<number>;
    };
    articulo_de_stock: {
      /** Lo genera la base: el alta es idempotente por producto (única por empresa y producto). */
      id: Generated<string>;
      empresa_id: string;
      producto_id: string;
      unidad_de_stock_id: string;
      dimension: string;
      activo: Generated<boolean>;
      creado_en: Generated<Date>;
      actualizado_en: Generated<Date>;
      version: Generated<number>;
    };
    motivo_de_movimiento: {
      clase: string;
      codigo: string;
      entra_con_costo: Generated<boolean>;
      entrega_mercaderia: Generated<boolean>;
    };
    conteo_fisico: {
      /** Lo manda la aplicación: es la idempotencia de abrirlo. */
      id: Generated<string>;
      empresa_id: string;
      deposito_id: string;
      estado: Generated<string>;
      abierto_por: string;
      abierto_en: Date;
      resuelto_por: string | null;
      resuelto_en: Date | null;
      motivo: string | null;
      creado_en: Generated<Date>;
      actualizado_en: Generated<Date>;
      version: Generated<number>;
    };
    movimiento_de_stock: {
      /** Lo genera la base: la identidad de un movimiento es su clave de idempotencia (o su origen). */
      id: Generated<string>;
      empresa_id: string;
      clase: string;
      motivo: string;
      detalle: string | null;
      origen_tipo: Generated<string>;
      origen_id: string | null;
      deposito_id: string;
      accion: string;
      anula_a: string | null;
      conteo_id: string | null;
      clave_idempotencia: string;
      huella: string;
      hecho_en: Date;
      /** Lo fija la base (`now()`): la aplicación no lo manda. */
      registrado_en: Generated<Date>;
      /** Lo fija la base con la fórmula de la jornada; solo la salida por venta manda la del ticket. */
      fecha_negocio: FechaDeNegocioDelLibro;
      registrado_por: string;
    };
    renglon_de_movimiento: {
      empresa_id: string;
      movimiento_id: string;
      numero: number;
      deposito_id: string;
      articulo_id: string;
      /** Con signo, en la unidad de stock del artículo. */
      cantidad: string;
      composicion_id: string | null;
      confirmo_negativo: Generated<boolean>;
      /** Copias de la cabecera: las completa la base. */
      hecho_en: Generated<Date>;
      fecha_negocio: Generated<string>;
    };
    /** Solo la escribe el disparador de los renglones: la aplicación nunca la inserta ni la cambia. */
    saldo_de_stock: {
      empresa_id: string;
      deposito_id: string;
      articulo_id: string;
      existencia: string;
    };
    conteo_registro: {
      /** Lo manda la aplicación: es la idempotencia del registro. */
      id: string;
      empresa_id: string;
      conteo_id: string;
      articulo_id: string;
      cantidad_contada: string;
      /** La fija la base: la existencia del depósito en ese momento. */
      existencia_al_registrar: Generated<string>;
      registrado_por: string;
      registrado_en: Date;
      /** `bigint` (identity): `pg` lo devuelve como texto. */
      orden: Generated<string>;
    };
    composicion: {
      /** Lo genera la base. */
      id: Generated<string>;
      empresa_id: string;
      producto_id: string;
      numero: number;
      rinde: string;
      creada_por: string;
      creada_en: Date;
      registrada_en: Generated<Date>;
      /** E6 (0032): los pasos de la ficha de cocina (texto de una línea) o `null`. */
      pasos: string | null;
    };
    componente_de_composicion: {
      empresa_id: string;
      composicion_id: string;
      numero: number;
      articulo_id: string | null;
      compuesto_id: string | null;
      cantidad: string;
      unidad_id: string;
      dimension: string;
      perdida: Generated<string>;
    };
    /** El promedio móvil ponderado por (depósito, artículo) (0031). La moneda la fija la base (`ARS`). */
    costo_de_articulo: {
      empresa_id: string;
      deposito_id: string;
      articulo_id: string;
      /** Texto decimal exacto, 6 decimales. */
      costo_unitario: string;
      /** Texto decimal exacto, 4 decimales: las unidades que tienen costo. */
      cantidad_valorizada: string;
      moneda: Generated<string>;
    };
    /** El costo congelado de cada renglón del libro (0031): solo inserción. `costo_unitario` nulo si y solo si `SIN_COSTO`. */
    costo_de_renglon: {
      empresa_id: string;
      movimiento_id: string;
      numero: number;
      estado: string;
      costo_unitario: string | null;
    };
  };

/** Las columnas de cada tabla propia de stock, en el orden de la base. Lo comprueba `stock-persistencia.test.ts`. */
export const COLUMNAS_DE_STOCK = {
  deposito: [
    "id",
    "empresa_id",
    "sucursal_id",
    "nombre",
    "nombre_clave",
    "uso",
    "de_venta",
    "activo",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  articulo_de_stock: [
    "id",
    "empresa_id",
    "producto_id",
    "unidad_de_stock_id",
    "dimension",
    "activo",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  motivo_de_movimiento: ["clase", "codigo", "entra_con_costo", "entrega_mercaderia"],
  conteo_fisico: [
    "id",
    "empresa_id",
    "deposito_id",
    "estado",
    "abierto_por",
    "abierto_en",
    "resuelto_por",
    "resuelto_en",
    "motivo",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  movimiento_de_stock: [
    "id",
    "empresa_id",
    "clase",
    "motivo",
    "detalle",
    "origen_tipo",
    "origen_id",
    "deposito_id",
    "accion",
    "anula_a",
    "conteo_id",
    "clave_idempotencia",
    "huella",
    "hecho_en",
    "registrado_en",
    "fecha_negocio",
    "registrado_por",
  ],
  renglon_de_movimiento: [
    "empresa_id",
    "movimiento_id",
    "numero",
    "deposito_id",
    "articulo_id",
    "cantidad",
    "composicion_id",
    "confirmo_negativo",
    "hecho_en",
    "fecha_negocio",
  ],
  saldo_de_stock: ["empresa_id", "deposito_id", "articulo_id", "existencia"],
  conteo_registro: [
    "id",
    "empresa_id",
    "conteo_id",
    "articulo_id",
    "cantidad_contada",
    "existencia_al_registrar",
    "registrado_por",
    "registrado_en",
    "orden",
  ],
  composicion: [
    "id",
    "empresa_id",
    "producto_id",
    "numero",
    "rinde",
    "creada_por",
    "creada_en",
    "registrada_en",
    "pasos",
  ],
  componente_de_composicion: [
    "empresa_id",
    "composicion_id",
    "numero",
    "articulo_id",
    "compuesto_id",
    "cantidad",
    "unidad_id",
    "dimension",
    "perdida",
  ],
  costo_de_articulo: [
    "empresa_id",
    "deposito_id",
    "articulo_id",
    "costo_unitario",
    "cantidad_valorizada",
    "moneda",
  ],
  costo_de_renglon: ["empresa_id", "movimiento_id", "numero", "estado", "costo_unitario"],
  ...COLUMNAS_DE_LOTES,
} as const satisfies {
  [
    Tabla in keyof Omit<StockDb, keyof TablasDeCatalogoQueLeeStock>
  ]: readonly (keyof StockDb[Tabla])[];
};
