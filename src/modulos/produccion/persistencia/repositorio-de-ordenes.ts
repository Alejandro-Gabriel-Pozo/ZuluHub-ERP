import { sql, type Kysely } from "kysely";
import type { AlcanceDeSucursales } from "../../../capacidades/permisos/alcance";
import type { EmpresaId, PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { esEstadoDeOrden, type EstadoDeOrden } from "../dominio/orden";
import { esUuid } from "./filas";
import type { ProduccionDb } from "./esquema";
import type { EstadoDeCosto, OrdenGuardada, RenglonDeOrdenGuardado } from "./modelo";

export type AltaDeOrden = Readonly<{
  /** Lo manda la pantalla: es la idempotencia del alta. */
  id: string;
  productoId: string;
  articuloId: string;
  composicionId: string;
  depositoId: string;
  depositoDestinoId: string;
  cantidadEsperada: string;
  abiertaPor: PersonaId;
  abiertaEn: Date;
}>;

export type AltaDeRenglonDeOrden = Readonly<{
  numero: number;
  articuloId: string;
  composicionId: string | null;
  cantidadEsperada: string;
}>;

export type DatosDeCierre = Readonly<{
  cantidadObtenida: string;
  loteId: string | null;
  vence: string | null;
  costoUnitario: string | null;
  costoEstado: EstadoDeCosto;
  movimientoDeConsumoId: string;
  movimientoDeProductoId: string;
  cerradaPor: PersonaId;
  cerradaEn: Date;
}>;

export type FiltroDeOrdenes = Readonly<{
  alcance: AlcanceDeSucursales;
  estado?: EstadoDeOrden | undefined;
  sucursalId?: SucursalId | undefined;
  /** Solo esa orden (para saber si está en el alcance). */
  ordenId?: string | undefined;
  limite: number;
}>;

/**
 * Las órdenes de producción (0033). El NÚMERO lo fija la base al insertar (`RETURNING numero`); `bloquear` toma la fila `FOR UPDATE`: dos acciones sobre la
 * misma orden se serializan y la segunda relee el estado. Cerrar, cancelar y anular escriben SOLO las columnas que la base concede, y la base verifica
 * que los movimientos del libro ya estén en la misma transacción (por eso se actualiza AL FINAL: DEC-0109, S-19). Todo el SQL va con la empresa del
 * contexto; ningún método borra.
 */
export interface RepositorioDeOrdenes {
  obtener(empresa: EmpresaId, id: string): Promise<OrdenGuardada | null>;
  bloquear(empresa: EmpresaId, id: string): Promise<OrdenGuardada | null>;
  insertar(empresa: EmpresaId, alta: AltaDeOrden): Promise<OrdenGuardada>;
  insertarRenglones(
    empresa: EmpresaId,
    ordenId: string,
    renglones: readonly AltaDeRenglonDeOrden[],
  ): Promise<void>;
  renglonesDe(empresa: EmpresaId, ordenId: string): Promise<readonly RenglonDeOrdenGuardado[]>;
  /** Carga lo REAL de un renglón (una sola vez, con la orden abierta). */
  cargarReal(
    empresa: EmpresaId,
    ordenId: string,
    numero: number,
    cantidadReal: string,
  ): Promise<void>;
  cerrar(empresa: EmpresaId, id: string, datos: DatosDeCierre): Promise<OrdenGuardada>;
  cancelar(
    empresa: EmpresaId,
    id: string,
    datos: Readonly<{ motivo: string; por: PersonaId; en: Date }>,
  ): Promise<OrdenGuardada>;
  anular(
    empresa: EmpresaId,
    id: string,
    datos: Readonly<{
      motivo: string;
      anulacionDeConsumoId: string;
      anulacionDeProductoId: string;
      por: PersonaId;
      en: Date;
    }>,
  ): Promise<OrdenGuardada>;
  /** Las órdenes cuyos DOS depósitos están en el alcance, de la más nueva a la más vieja. */
  listar(empresa: EmpresaId, filtro: FiltroDeOrdenes): Promise<readonly OrdenGuardada[]>;
}

type Fila = {
  id: string;
  numero: number;
  estado: string;
  producto_id: string;
  articulo_id: string;
  composicion_id: string;
  deposito_id: string;
  deposito_destino_id: string;
  cantidad_esperada: string;
  cantidad_obtenida: string | null;
  lote_id: string | null;
  vence: string | null;
  costo_unitario: string | null;
  costo_estado: string | null;
  movimiento_de_consumo_id: string | null;
  movimiento_de_producto_id: string | null;
  anulacion_de_consumo_id: string | null;
  anulacion_de_producto_id: string | null;
  motivo: string | null;
  abierta_por: string;
  abierta_en: Date;
  cerrada_por: string | null;
  cerrada_en: Date | null;
  cancelada_por: string | null;
  cancelada_en: Date | null;
  anulada_por: string | null;
  anulada_en: Date | null;
  hecho_en: Date | null;
  fecha_de_negocio: string | null;
  version: number;
};

const COLUMNAS = sql`o.id, o.numero, o.estado, o.producto_id, o.articulo_id, o.composicion_id, o.deposito_id, o.deposito_destino_id,
  o.cantidad_esperada::text as cantidad_esperada, o.cantidad_obtenida::text as cantidad_obtenida, o.lote_id, o.vence::text as vence,
  o.costo_unitario::text as costo_unitario, o.costo_estado, o.movimiento_de_consumo_id, o.movimiento_de_producto_id,
  o.anulacion_de_consumo_id, o.anulacion_de_producto_id, o.motivo, o.abierta_por, o.abierta_en, o.cerrada_por, o.cerrada_en,
  o.cancelada_por, o.cancelada_en, o.anulada_por, o.anulada_en, o.hecho_en, o.fecha_de_negocio::text as fecha_de_negocio, o.version`;

function aOrden(f: Fila): OrdenGuardada {
  if (!esEstadoDeOrden(f.estado))
    throw new RangeError(`producción: estado de orden desconocido «${f.estado}»`);
  const costoEstado: EstadoDeCosto | null =
    f.costo_estado === null
      ? null
      : f.costo_estado === "SIN_COSTO" || f.costo_estado === "DEFINITIVO"
        ? f.costo_estado
        : (() => {
            throw new RangeError(`producción: estado de costo desconocido «${f.costo_estado}»`);
          })();
  return {
    id: f.id,
    numero: f.numero,
    estado: f.estado,
    productoId: f.producto_id,
    articuloId: f.articulo_id,
    composicionId: f.composicion_id,
    depositoId: f.deposito_id,
    depositoDestinoId: f.deposito_destino_id,
    cantidadEsperada: f.cantidad_esperada,
    cantidadObtenida: f.cantidad_obtenida,
    loteId: f.lote_id,
    vence: f.vence,
    costoUnitario: f.costo_unitario,
    costoEstado,
    movimientoDeConsumoId: f.movimiento_de_consumo_id,
    movimientoDeProductoId: f.movimiento_de_producto_id,
    anulacionDeConsumoId: f.anulacion_de_consumo_id,
    anulacionDeProductoId: f.anulacion_de_producto_id,
    motivo: f.motivo,
    abiertaPor: f.abierta_por,
    abiertaEn: f.abierta_en,
    cerradaPor: f.cerrada_por,
    cerradaEn: f.cerrada_en,
    canceladaPor: f.cancelada_por,
    canceladaEn: f.cancelada_en,
    anuladaPor: f.anulada_por,
    anuladaEn: f.anulada_en,
    hechoEn: f.hecho_en,
    fechaDeNegocio: f.fecha_de_negocio,
    version: f.version,
  };
}

export function crearRepositorioDeOrdenes(db: Kysely<ProduccionDb>): RepositorioDeOrdenes {
  const leer = async (empresa: EmpresaId, id: string, bloquear: boolean) => {
    if (!esUuid(id)) return null;
    const { rows } = await sql<Fila>`
      select ${COLUMNAS} from orden_de_produccion o
       where o.empresa_id = ${empresa} and o.id = ${id}
       ${bloquear ? sql`for update` : sql``}`.execute(db);
    return rows[0] === undefined ? null : aOrden(rows[0]);
  };
  /** Después de un UPDATE se relee la fila (la base fija la versión, la fecha y la hora). */
  const releer = async (empresa: EmpresaId, id: string): Promise<OrdenGuardada> => {
    const orden = await leer(empresa, id, false);
    if (orden === null) throw new Error("la orden recién escrita no es visible");
    return orden;
  };
  return {
    obtener: (empresa, id) => leer(empresa, id, false),
    bloquear: (empresa, id) => leer(empresa, id, true),
    async insertar(empresa, alta) {
      await sql`
        insert into orden_de_produccion (id, empresa_id, producto_id, articulo_id, composicion_id, deposito_id, deposito_destino_id,
                                         cantidad_esperada, abierta_por, abierta_en)
        values (${alta.id}, ${empresa}, ${alta.productoId}, ${alta.articuloId}, ${alta.composicionId}, ${alta.depositoId},
                ${alta.depositoDestinoId}, ${alta.cantidadEsperada}::numeric, ${alta.abiertaPor}, ${alta.abiertaEn})`.execute(
        db,
      );
      return releer(empresa, alta.id);
    },
    async insertarRenglones(empresa, ordenId, renglones) {
      if (renglones.length === 0) return;
      await sql`
        insert into renglon_de_orden (empresa_id, orden_id, numero, articulo_id, composicion_id, cantidad_esperada)
        values ${sql.join(
          renglones.map(
            (r) =>
              sql`(${empresa}, ${ordenId}, ${r.numero}, ${r.articuloId}, ${r.composicionId}, ${r.cantidadEsperada}::numeric)`,
          ),
        )}`.execute(db);
    },
    async renglonesDe(empresa, ordenId) {
      if (!esUuid(ordenId)) return [];
      const { rows } = await sql<{
        numero: number;
        articulo_id: string;
        composicion_id: string | null;
        cantidad_esperada: string;
        cantidad_real: string | null;
      }>`
        select numero, articulo_id, composicion_id, cantidad_esperada::text as cantidad_esperada, cantidad_real::text as cantidad_real
          from renglon_de_orden where empresa_id = ${empresa} and orden_id = ${ordenId} order by numero`.execute(
        db,
      );
      return rows.map((r) => ({
        numero: r.numero,
        articuloId: r.articulo_id,
        composicionId: r.composicion_id,
        cantidadEsperada: r.cantidad_esperada,
        cantidadReal: r.cantidad_real,
      }));
    },
    async cargarReal(empresa, ordenId, numero, cantidadReal) {
      await sql`
        update renglon_de_orden set cantidad_real = ${cantidadReal}::numeric
         where empresa_id = ${empresa} and orden_id = ${ordenId} and numero = ${numero}`.execute(
        db,
      );
    },
    async cerrar(empresa, id, d) {
      await sql`
        update orden_de_produccion set estado = 'CERRADA', cantidad_obtenida = ${d.cantidadObtenida}::numeric, lote_id = ${d.loteId},
               vence = ${d.vence}::date, costo_unitario = ${d.costoUnitario}::numeric, costo_estado = ${d.costoEstado},
               movimiento_de_consumo_id = ${d.movimientoDeConsumoId}, movimiento_de_producto_id = ${d.movimientoDeProductoId},
               cerrada_por = ${d.cerradaPor}, cerrada_en = ${d.cerradaEn}
         where empresa_id = ${empresa} and id = ${id} and estado = 'ABIERTA'`.execute(db);
      return releer(empresa, id);
    },
    async cancelar(empresa, id, d) {
      await sql`
        update orden_de_produccion set estado = 'CANCELADA', motivo = ${d.motivo}, cancelada_por = ${d.por}, cancelada_en = ${d.en}
         where empresa_id = ${empresa} and id = ${id} and estado = 'ABIERTA'`.execute(db);
      return releer(empresa, id);
    },
    async anular(empresa, id, d) {
      await sql`
        update orden_de_produccion set estado = 'ANULADA', motivo = ${d.motivo}, anulacion_de_consumo_id = ${d.anulacionDeConsumoId},
               anulacion_de_producto_id = ${d.anulacionDeProductoId}, anulada_por = ${d.por}, anulada_en = ${d.en}
         where empresa_id = ${empresa} and id = ${id} and estado = 'CERRADA'`.execute(db);
      return releer(empresa, id);
    },
    async listar(empresa, filtro) {
      if (filtro.alcance !== "TODAS" && filtro.alcance.length === 0) return [];
      const { rows } = await sql<Fila>`
        select ${COLUMNAS} from orden_de_produccion o
          join deposito d1 on d1.empresa_id = o.empresa_id and d1.id = o.deposito_id
          join deposito d2 on d2.empresa_id = o.empresa_id and d2.id = o.deposito_destino_id
         where o.empresa_id = ${empresa}
           ${filtro.estado === undefined ? sql`` : sql`and o.estado = ${filtro.estado}`}
           ${filtro.alcance === "TODAS" ? sql`` : sql`and d1.sucursal_id in (${sql.join([...filtro.alcance])}) and d2.sucursal_id in (${sql.join([...filtro.alcance])})`}
           ${filtro.ordenId === undefined ? sql`` : sql`and o.id = ${filtro.ordenId}::uuid`}
           ${filtro.sucursalId === undefined ? sql`` : sql`and (d1.sucursal_id = ${filtro.sucursalId}::uuid or d2.sucursal_id = ${filtro.sucursalId}::uuid)`}
         order by o.numero desc
         limit ${filtro.limite}`.execute(db);
      return rows.map(aOrden);
    },
  };
}
