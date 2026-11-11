import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { esNivelDeCompra, type NivelDeCompra } from "../dominio/niveles";
import type { Remito } from "../dominio/registrar-compra";
import type { ComprasDb } from "./esquema";
import { esUuid } from "./filas";

export type EstadoDeRecepcion = "CONFIRMADA" | "ANULADA";

export type Recepcion = Readonly<{
  id: string;
  sucursalId: string;
  proveedorId: string;
  numero: number;
  nivel: NivelDeCompra;
  esAtajo: boolean;
  remito: Remito | null;
  hechoEn: Date;
  registradoEn: Date;
  /** La jornada de la sucursal (zona de la empresa y hora de corte), fijada por la base. */
  fechaNegocio: string;
  estado: EstadoDeRecepcion;
  claveIdempotencia: string;
  huella: string;
  registradoPor: string;
  anuladaPor: string | null;
  anuladaEn: Date | null;
  motivoDeAnulacion: string | null;
  version: number;
}>;

export type AltaDeRecepcion = Readonly<{
  sucursalId: SucursalId;
  proveedorId: string;
  nivel: NivelDeCompra;
  esAtajo: boolean;
  remito: Remito | null;
  hechoEn: Date;
  clave: string;
  huella: string;
  registradoPor: PersonaId;
}>;

export type LineaDeRecepcion = Readonly<{
  numero: number;
  productoId: string;
  presentacionId: string | null;
  unidadDeCompraId: string;
  cantidadDeCompra: string;
  dePesoVariable: boolean;
  pesoReal: string | null;
  /** Lo que entra al stock, en la unidad base del producto (texto decimal de 4 decimales). */
  cantidadEnStock: string;
  precioPorTipo: "PRESENTACION" | "UNIDAD" | null;
  unidadDePrecioId: string | null;
  precio: string | null;
  importe: string | null;
  costoPorUnidadDeStock: string | null;
  depositoId: string | null;
  movimientoId: string | null;
}>;

export type FiltroDeCompras = Readonly<{
  /** `TODAS` o las sucursales del alcance del actor; una lista vacía no ve nada. */
  sucursales: "TODAS" | readonly string[];
  proveedorId: string | null;
  estado: EstadoDeRecepcion | null;
  /** Fechas de negocio, `YYYY-MM-DD`, ambas inclusive. */
  desde: string | null;
  hasta: string | null;
  despuesDe: Readonly<{ fechaNegocio: string; id: string }> | null;
  limite: number;
}>;

export type FilaDeListaDeCompras = Recepcion &
  Readonly<{
    /** El estado del comprobante de esta recepción (el más vigente), o `null` si no tiene. */
    comprobanteEstado: "REGISTRADO" | "ANULADO" | null;
  }>;

/**
 * Las recepciones de compras (E9 §3.3). El alta es idempotente: `insertar` usa `ON CONFLICT DO NOTHING` sin objetivo (cubre la clave, el remito y el número) y
 * devuelve `undefined` si chocó; quien llama decide qué fue (repetición, remito repetido, o carrera por el número, que se reintenta). La línea solo entra en la
 * transacción de su cabecera (disparador) y nunca se modifica ni se borra; lo único que cambia de una recepción es su anulación.
 */
export interface RepositorioDeRecepciones {
  porClave(empresa: EmpresaId, clave: string): Promise<Recepcion | null>;
  /** La recepción CONFIRMADA de ese proveedor con ese remito (la anulada libera el número). */
  porRemito(
    empresa: EmpresaId,
    proveedorId: string,
    puntoDeVenta: number,
    numero: number,
  ): Promise<Recepcion | null>;
  obtener(empresa: EmpresaId, id: string): Promise<Recepcion | null>;
  bloquear(empresa: EmpresaId, id: string): Promise<Recepcion | null>;
  insertar(empresa: EmpresaId, alta: AltaDeRecepcion): Promise<string | undefined>;
  insertarLineas(
    empresa: EmpresaId,
    recepcionId: string,
    lineas: readonly LineaDeRecepcion[],
  ): Promise<void>;
  lineasDe(empresa: EmpresaId, recepcionId: string): Promise<readonly LineaDeRecepcion[]>;
  /** `false` si ya no estaba CONFIRMADA. */
  anular(
    empresa: EmpresaId,
    id: string,
    anulacion: Readonly<{ por: PersonaId; en: Date; motivo: string }>,
  ): Promise<boolean>;
  listar(empresa: EmpresaId, filtro: FiltroDeCompras): Promise<readonly FilaDeListaDeCompras[]>;
  /** Las recepciones confirmadas con al menos una línea sin precio («Sin precio»), de las sucursales del alcance. */
  sinPrecio(
    empresa: EmpresaId,
    sucursales: "TODAS" | readonly string[],
    limite: number,
  ): Promise<readonly Recepcion[]>;
}

const COLUMNAS = [
  "id",
  "sucursal_id",
  "proveedor_id",
  "numero",
  "nivel",
  "es_atajo",
  "remito_punto_de_venta",
  "remito_numero",
  "hecho_en",
  "registrado_en",
  "estado",
  "clave_idempotencia",
  "huella",
  "registrado_por",
  "anulada_por",
  "anulada_en",
  "motivo_de_anulacion",
  "version",
  sql<string | null>`remito_fecha::text`.as("remito_fecha"),
  sql<string>`fecha_negocio::text`.as("fecha_negocio"),
] as const;

type FilaDeRecepcion = {
  id: string;
  sucursal_id: string;
  proveedor_id: string;
  numero: number;
  nivel: string;
  es_atajo: boolean;
  remito_punto_de_venta: number | null;
  remito_numero: number | null;
  remito_fecha: string | null;
  hecho_en: Date;
  registrado_en: Date;
  fecha_negocio: string;
  estado: string;
  clave_idempotencia: string;
  huella: string;
  registrado_por: string;
  anulada_por: string | null;
  anulada_en: Date | null;
  motivo_de_anulacion: string | null;
  version: number;
};

function aRecepcion(f: FilaDeRecepcion): Recepcion {
  if (!esNivelDeCompra(f.nivel)) throw new RangeError(`nivel de compra desconocido: ${f.nivel}`);
  if (f.estado !== "CONFIRMADA" && f.estado !== "ANULADA") {
    throw new RangeError(`estado de recepción desconocido: ${f.estado}`);
  }
  const remito =
    f.remito_punto_de_venta === null || f.remito_numero === null || f.remito_fecha === null
      ? null
      : { puntoDeVenta: f.remito_punto_de_venta, numero: f.remito_numero, fecha: f.remito_fecha };
  return {
    id: f.id,
    sucursalId: f.sucursal_id,
    proveedorId: f.proveedor_id,
    numero: f.numero,
    nivel: f.nivel,
    esAtajo: f.es_atajo,
    remito,
    hechoEn: f.hecho_en,
    registradoEn: f.registrado_en,
    fechaNegocio: f.fecha_negocio,
    estado: f.estado,
    claveIdempotencia: f.clave_idempotencia,
    huella: f.huella,
    registradoPor: f.registrado_por,
    anuladaPor: f.anulada_por,
    anuladaEn: f.anulada_en,
    motivoDeAnulacion: f.motivo_de_anulacion,
    version: f.version,
  };
}

const COLUMNAS_DE_LINEA = [
  "numero",
  "producto_id",
  "presentacion_id",
  "unidad_de_compra_id",
  "cantidad_de_compra",
  "de_peso_variable",
  "peso_real",
  "cantidad_en_stock",
  "precio_por_tipo",
  "unidad_de_precio_id",
  "precio",
  "importe",
  "costo_por_unidad_de_stock",
  "deposito_id",
  "movimiento_id",
] as const;

export function crearRepositorioDeRecepciones(db: Kysely<ComprasDb>): RepositorioDeRecepciones {
  async function leer(empresa: EmpresaId, id: string, bloquear: boolean) {
    if (!esUuid(id)) return null;
    let consulta = db
      .selectFrom("recepcion")
      .select(COLUMNAS)
      .where("empresa_id", "=", empresa)
      .where("id", "=", id);
    if (bloquear) consulta = consulta.forUpdate();
    const fila = await consulta.executeTakeFirst();
    return fila === undefined ? null : aRecepcion(fila);
  }
  return {
    async porClave(empresa, clave) {
      const fila = await db
        .selectFrom("recepcion")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aRecepcion(fila);
    },
    async porRemito(empresa, proveedorId, puntoDeVenta, numero) {
      const fila = await db
        .selectFrom("recepcion")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("proveedor_id", "=", proveedorId)
        .where("remito_punto_de_venta", "=", puntoDeVenta)
        .where("remito_numero", "=", numero)
        .where("estado", "=", "CONFIRMADA")
        .executeTakeFirst();
      return fila === undefined ? null : aRecepcion(fila);
    },
    obtener: (empresa, id) => leer(empresa, id, false),
    bloquear: (empresa, id) => leer(empresa, id, true),
    async insertar(empresa, alta) {
      const fila = await db
        .insertInto("recepcion")
        .values({
          empresa_id: empresa,
          sucursal_id: alta.sucursalId,
          proveedor_id: alta.proveedorId,
          nivel: alta.nivel,
          es_atajo: alta.esAtajo,
          remito_punto_de_venta: alta.remito?.puntoDeVenta ?? null,
          remito_numero: alta.remito?.numero ?? null,
          remito_fecha: alta.remito?.fecha ?? null,
          hecho_en: alta.hechoEn,
          clave_idempotencia: alta.clave,
          huella: alta.huella,
          registrado_por: alta.registradoPor,
        })
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      return fila?.id;
    },
    async insertarLineas(empresa, recepcionId, lineas) {
      if (lineas.length === 0) return;
      await db
        .insertInto("linea_de_recepcion")
        .values(
          lineas.map((l) => ({
            empresa_id: empresa,
            recepcion_id: recepcionId,
            numero: l.numero,
            producto_id: l.productoId,
            presentacion_id: l.presentacionId,
            unidad_de_compra_id: l.unidadDeCompraId,
            cantidad_de_compra: l.cantidadDeCompra,
            de_peso_variable: l.dePesoVariable,
            peso_real: l.pesoReal,
            cantidad_en_stock: l.cantidadEnStock,
            precio_por_tipo: l.precioPorTipo,
            unidad_de_precio_id: l.unidadDePrecioId,
            precio: l.precio,
            importe: l.importe,
            costo_por_unidad_de_stock: l.costoPorUnidadDeStock,
            deposito_id: l.depositoId,
            movimiento_id: l.movimientoId,
          })),
        )
        .execute();
    },
    async lineasDe(empresa, recepcionId) {
      if (!esUuid(recepcionId)) return [];
      const filas = await db
        .selectFrom("linea_de_recepcion")
        .select(COLUMNAS_DE_LINEA)
        .where("empresa_id", "=", empresa)
        .where("recepcion_id", "=", recepcionId)
        .orderBy("numero")
        .execute();
      return filas.map((f) => ({
        numero: f.numero,
        productoId: f.producto_id,
        presentacionId: f.presentacion_id,
        unidadDeCompraId: f.unidad_de_compra_id,
        cantidadDeCompra: f.cantidad_de_compra,
        dePesoVariable: f.de_peso_variable,
        pesoReal: f.peso_real,
        cantidadEnStock: f.cantidad_en_stock,
        precioPorTipo:
          f.precio_por_tipo === "PRESENTACION" || f.precio_por_tipo === "UNIDAD"
            ? f.precio_por_tipo
            : null,
        unidadDePrecioId: f.unidad_de_precio_id,
        precio: f.precio,
        importe: f.importe,
        costoPorUnidadDeStock: f.costo_por_unidad_de_stock,
        depositoId: f.deposito_id,
        movimientoId: f.movimiento_id,
      }));
    },
    async anular(empresa, id, anulacion) {
      const fila = await db
        .updateTable("recepcion")
        .set({
          estado: "ANULADA",
          anulada_por: anulacion.por,
          anulada_en: anulacion.en,
          motivo_de_anulacion: anulacion.motivo,
        })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "CONFIRMADA")
        .returning("id")
        .executeTakeFirst();
      return fila !== undefined;
    },
    async listar(empresa, filtro) {
      if (filtro.sucursales !== "TODAS" && filtro.sucursales.length === 0) return [];
      let consulta = db
        .selectFrom("recepcion")
        .select([
          ...COLUMNAS,
          sql<
            string | null
          >`(select c.estado from linea_de_comprobante l join comprobante_de_proveedor c on c.id = l.comprobante_id and c.empresa_id = l.empresa_id
              where l.empresa_id = recepcion.empresa_id and l.recepcion_id = recepcion.id
              order by (c.estado = 'REGISTRADO') desc, c.registrado_en desc limit 1)`.as(
            "comprobante_estado",
          ),
        ])
        .where("empresa_id", "=", empresa);
      if (filtro.sucursales !== "TODAS") {
        consulta = consulta.where("sucursal_id", "in", [...filtro.sucursales]);
      }
      if (filtro.proveedorId !== null)
        consulta = consulta.where("proveedor_id", "=", filtro.proveedorId);
      if (filtro.estado !== null) consulta = consulta.where("estado", "=", filtro.estado);
      if (filtro.desde !== null)
        consulta = consulta.where(sql`fecha_negocio`, ">=", sql`${filtro.desde}::date`);
      if (filtro.hasta !== null)
        consulta = consulta.where(sql`fecha_negocio`, "<=", sql`${filtro.hasta}::date`);
      if (filtro.despuesDe !== null) {
        const c = filtro.despuesDe;
        consulta = consulta.where(
          sql<boolean>`(fecha_negocio, id) < (${c.fechaNegocio}::date, ${c.id}::uuid)`,
        );
      }
      const filas = await consulta
        .orderBy(sql`fecha_negocio`, "desc")
        .orderBy("id", "desc")
        .limit(filtro.limite)
        .execute();
      return filas.map((f) => ({
        ...aRecepcion(f),
        comprobanteEstado:
          f.comprobante_estado === "REGISTRADO" || f.comprobante_estado === "ANULADO"
            ? f.comprobante_estado
            : null,
      }));
    },
    async sinPrecio(empresa, sucursales, limite) {
      if (sucursales !== "TODAS" && sucursales.length === 0) return [];
      let consulta = db
        .selectFrom("recepcion")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("estado", "=", "CONFIRMADA")
        .where(
          sql<boolean>`exists (select 1 from linea_de_recepcion l where l.empresa_id = recepcion.empresa_id and l.recepcion_id = recepcion.id and l.precio is null)`,
        );
      if (sucursales !== "TODAS") consulta = consulta.where("sucursal_id", "in", [...sucursales]);
      const filas = await consulta
        .orderBy(sql`fecha_negocio`, "desc")
        .orderBy("id", "desc")
        .limit(limite)
        .execute();
      return filas.map(aRecepcion);
    },
  };
}
