import { sql, type Kysely } from "kysely";
import type { AlcanceDeSucursales } from "../../../capacidades/permisos/alcance";
import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import type { StockDb } from "./esquema";
import { esUuid } from "./filas";
import { aLote, type FilaDeLote, type LoteGuardado } from "./repositorio-de-lotes";

/**
 * Las lecturas de lotes que piden las consultas (E6 §3.5): los saldos por lote y depósito, y lo que movió a un lote. Solo leen; separado de
 * `repositorio-de-lotes.ts` por tamaño. Las fechas (`date`) se leen con `::text`; los decimales, como texto (ADR-006).
 */
/** El saldo de un lote en un depósito, con lo que hace falta para mostrarlo y para decidir lo disponible (el uso del depósito y su sucursal). */
export type SaldoDeLoteLeido = Readonly<{
  lote: LoteGuardado;
  depositoId: string;
  sucursalId: SucursalId;
  uso: "NORMAL" | "CUARENTENA" | "RECHAZO";
  /** Texto decimal exacto, en la unidad de stock del artículo. */
  existencia: string;
}>;

export type FiltroDeSaldosDeLote = Readonly<{
  alcance: AlcanceDeSucursales;
  articuloIds?: readonly string[] | undefined;
  depositoId?: string | undefined;
  sucursalId?: SucursalId | undefined;
  /** Solo los saldos distintos de cero (lo que «tiene existencia»). */
  conExistencia?: boolean | undefined;
}>;

export type MovimientoDeLote = Readonly<{
  movimientoId: string;
  clase: string;
  motivo: string;
  origenTipo: string;
  origenId: string | null;
  depositoId: string;
  hechoEn: Date;
  fechaDeNegocio: string;
  /** Con signo: lo que el movimiento sumó (+) o restó (−) a este lote. */
  cantidad: string;
}>;

export interface LecturasDeLotes {
  /** Los saldos de lote que el alcance deja ver, por vencimiento (los que no vencen al final), primer ingreso y lote. */
  saldosDeLote(
    empresa: EmpresaId,
    filtro: FiltroDeSaldosDeLote,
  ): Promise<readonly SaldoDeLoteLeido[]>;
  /** Los renglones del libro que tocaron al lote, del más nuevo al más viejo, en los depósitos del alcance. */
  movimientosDelLote(
    empresa: EmpresaId,
    alcance: AlcanceDeSucursales,
    loteId: string,
    limite: number,
  ): Promise<readonly MovimientoDeLote[]>;
}

const enAlcance = (alcance: AlcanceDeSucursales): boolean =>
  alcance === "TODAS" || alcance.length > 0;

export function crearLecturasDeLotes(db: Kysely<StockDb>): LecturasDeLotes {
  return {
    async saldosDeLote(empresa, filtro) {
      if (!enAlcance(filtro.alcance)) return [];
      const articulos = (filtro.articuloIds ?? []).filter(esUuid);
      if (filtro.articuloIds !== undefined && articulos.length === 0) return [];
      if (filtro.depositoId !== undefined && !esUuid(filtro.depositoId)) return [];
      const { rows } = await sql<
        FilaDeLote & { deposito_id: string; sucursal_id: string; uso: string; saldo: string }
      >`
        select l.id, l.articulo_id, l.codigo, l.referencia_de_origen, l.fecha_de_elaboracion::text as fecha_de_elaboracion,
               l.fecha_de_vencimiento::text as fecha_de_vencimiento, l.es_sin_asignar, l.calidad,
               l.fecha_de_primer_ingreso::text as fecha_de_primer_ingreso, l.version,
               s.deposito_id, d.sucursal_id, d.uso, s.existencia::text as saldo
          from saldo_de_lote s
          join lote l on l.empresa_id = s.empresa_id and l.id = s.lote_id
          join deposito d on d.empresa_id = s.empresa_id and d.id = s.deposito_id
         where s.empresa_id = ${empresa}
           ${filtro.alcance === "TODAS" ? sql`` : sql`and d.sucursal_id in (${sql.join([...filtro.alcance])})`}
           ${filtro.sucursalId === undefined ? sql`` : sql`and d.sucursal_id = ${filtro.sucursalId}::uuid`}
           ${filtro.depositoId === undefined ? sql`` : sql`and s.deposito_id = ${filtro.depositoId}::uuid`}
           ${articulos.length === 0 ? sql`` : sql`and s.articulo_id in (${sql.join(articulos.map((a) => sql`${a}::uuid`))})`}
           ${filtro.conExistencia === true ? sql`and s.existencia <> 0` : sql``}
         order by l.articulo_id, l.es_sin_asignar, l.fecha_de_vencimiento nulls last, l.fecha_de_primer_ingreso, l.id, s.deposito_id`.execute(
        db,
      );
      return rows.map((f) => ({
        lote: aLote(f),
        depositoId: f.deposito_id,
        sucursalId: f.sucursal_id as SucursalId,
        uso:
          f.uso === "NORMAL" || f.uso === "CUARENTENA" || f.uso === "RECHAZO"
            ? f.uso
            : (() => {
                throw new RangeError(`stock: uso de depósito desconocido «${f.uso}»`);
              })(),
        existencia: f.saldo,
      }));
    },
    async movimientosDelLote(empresa, alcance, loteId, limite) {
      if (!enAlcance(alcance) || !esUuid(loteId)) return [];
      const { rows } = await sql<{
        movimiento_id: string;
        clase: string;
        motivo: string;
        origen_tipo: string;
        origen_id: string | null;
        deposito_id: string;
        hecho_en: Date;
        fecha_negocio: string;
        cantidad: string;
      }>`
        select m.id as movimiento_id, m.clase, m.motivo, m.origen_tipo, m.origen_id, r.deposito_id, m.hecho_en,
               m.fecha_negocio::text as fecha_negocio, l.cantidad::text as cantidad
          from renglon_de_lote l
          join renglon_de_movimiento r
            on r.empresa_id = l.empresa_id and r.movimiento_id = l.movimiento_id and r.numero = l.renglon_numero
          join movimiento_de_stock m on m.empresa_id = l.empresa_id and m.id = l.movimiento_id
          join deposito d on d.empresa_id = r.empresa_id and d.id = r.deposito_id
         where l.empresa_id = ${empresa} and l.lote_id = ${loteId}
           ${alcance === "TODAS" ? sql`` : sql`and d.sucursal_id in (${sql.join([...alcance])})`}
         order by m.hecho_en desc, m.registrado_en desc, m.id desc, r.numero
         limit ${limite}`.execute(db);
      return rows.map((f) => ({
        movimientoId: f.movimiento_id,
        clase: f.clase,
        motivo: f.motivo,
        origenTipo: f.origen_tipo,
        origenId: f.origen_id,
        depositoId: f.deposito_id,
        hechoEn: f.hecho_en,
        fechaDeNegocio: f.fecha_negocio,
        cantidad: f.cantidad,
      }));
    },
  };
}
