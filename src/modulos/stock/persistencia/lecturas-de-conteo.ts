import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { ClaseDeMovimiento } from "../dominio/movimiento";
import type { StockDb } from "./esquema";
import { esUuid } from "./filas";
import { claseDeMovimientoGuardada } from "./modelo";

/**
 * Lo que la revisión de un conteo lee del libro (E5 conteo con hora, §2.3 y §3.1): cuánto había en un artículo a la hora en que se contó, qué se movió
 * después y los renglones posteriores uno por uno (los candidatos del «ver detalle»). Solo `select`. Comparan INSTANTES (`hecho_en`, cuándo ocurrió),
 * nunca `fecha_negocio`: una venta de las 03:45 con corte 04:00 es posterior a un conteo de las 03:30 aunque las dos sean de la misma jornada (CF-D7).
 */

/** Una pregunta de la revisión: cuánto había de este artículo a esta hora. */
export type ConsultaDeHora = Readonly<{ articuloId: string; hora: Date }>;

/**
 * La suma con signo de los renglones del artículo en el depósito, partida por la hora: `hastaLaHora` (`hecho_en <= hora`) es lo que el sistema creía
 * a esa hora; `despuesDeLaHora` (`hecho_en > hora`) es lo movido desde entonces. Texto decimal exacto; sin movimientos, ambas «0».
 */
export type SumasAlrededorDeLaHora = Readonly<{ hastaLaHora: string; despuesDeLaHora: string }>;

/** Un renglón del libro posterior a la hora de un conteo, con lo que hace falta para mostrarlo y para marcarlo. */
export type RenglonPosterior = Readonly<{
  movimientoId: string;
  numero: number;
  clase: ClaseDeMovimiento;
  motivo: string;
  origenTipo: string;
  origenId: string | null;
  hechoEn: Date;
  registradoPor: PersonaId;
  /** Texto decimal exacto, con signo, en la unidad de stock. */
  cantidad: string;
}>;

export type FiltroDePosteriores = Readonly<{
  depositoId: string;
  articuloId: string;
  /** Solo lo que ocurrió DESPUÉS de este instante (`hecho_en > desde`). */
  desde: Date;
  /** `RESTA`: solo los de cantidad negativa (explican un faltante); `SUMA`: los de cantidad positiva (explican un sobrante). */
  sentido: "RESTA" | "SUMA";
  /** Paginación por cursor: lo que viene después de esta terna `(hecho_en, movimiento, renglón)`. */
  despuesDe?: Readonly<{ hechoEn: Date; movimientoId: string; numero: number }> | undefined;
  limite: number;
}>;

export interface LecturasDeConteo {
  /** Por artículo pedido (todos figuran, también los que nunca se movieron). Una sola sentencia: las dos sumas salen de la misma foto. */
  sumasAlrededorDeLaHora(
    empresa: EmpresaId,
    depositoId: string,
    consultas: readonly ConsultaDeHora[],
  ): Promise<Map<string, SumasAlrededorDeLaHora>>;
  /** Los renglones posteriores a la hora, del sentido pedido, por `(hecho_en, movimiento, renglón)`; paginado por cursor. */
  renglonesPosteriores(
    empresa: EmpresaId,
    filtro: FiltroDePosteriores,
  ): Promise<RenglonPosterior[]>;
  /**
   * Los renglones del artículo en el depósito con esas claves `(movimiento, renglón)`; los que no existen (o son de otro depósito, artículo o empresa)
   * no figuran. Quien marca verifica contra esto, nunca contra lo que mandó la pantalla.
   */
  renglonesPorClave(
    empresa: EmpresaId,
    depositoId: string,
    articuloId: string,
    claves: readonly Readonly<{ movimientoId: string; numero: number }>[],
  ): Promise<RenglonPosterior[]>;
}

type FilaDeRenglon = {
  movimiento_id: string;
  numero: number;
  clase: string;
  motivo: string;
  origen_tipo: string;
  origen_id: string | null;
  hecho_en: Date;
  registrado_por: string;
  cantidad: string;
};

const aRenglonPosterior = (f: FilaDeRenglon): RenglonPosterior => ({
  movimientoId: f.movimiento_id,
  numero: f.numero,
  clase: claseDeMovimientoGuardada(f.clase),
  motivo: f.motivo,
  origenTipo: f.origen_tipo,
  origenId: f.origen_id,
  hechoEn: f.hecho_en,
  registradoPor: f.registrado_por as PersonaId,
  cantidad: f.cantidad,
});

export function crearLecturasDeConteo(db: Kysely<StockDb>): LecturasDeConteo {
  return {
    async sumasAlrededorDeLaHora(empresa, depositoId, consultas) {
      const resultado = new Map<string, SumasAlrededorDeLaHora>();
      const validas = consultas.filter((c) => esUuid(c.articuloId));
      if (!esUuid(depositoId) || validas.length === 0) return resultado;
      const tuplas = validas.map(
        (c) => sql`(${c.articuloId}::uuid, ${c.hora.toISOString()}::timestamptz)`,
      );
      const { rows } = await sql<{ articulo_id: string; hasta: string; despues: string }>`
        select q.articulo_id,
               coalesce(sum(r.cantidad) filter (where r.hecho_en <= q.hora), 0)::text as hasta,
               coalesce(sum(r.cantidad) filter (where r.hecho_en > q.hora), 0)::text as despues
          from (values ${sql.join(tuplas)}) as q(articulo_id, hora)
          left join renglon_de_movimiento r
            on r.empresa_id = ${empresa} and r.deposito_id = ${depositoId}::uuid and r.articulo_id = q.articulo_id
         group by q.articulo_id`.execute(db);
      for (const f of rows) {
        resultado.set(f.articulo_id, { hastaLaHora: f.hasta, despuesDeLaHora: f.despues });
      }
      return resultado;
    },
    async renglonesPosteriores(empresa, filtro) {
      if (!esUuid(filtro.depositoId) || !esUuid(filtro.articuloId)) return [];
      const signo = filtro.sentido === "RESTA" ? sql`r.cantidad < 0` : sql`r.cantidad > 0`;
      const despues =
        filtro.despuesDe === undefined
          ? sql``
          : sql`and (r.hecho_en, r.movimiento_id, r.numero) >
                    (${filtro.despuesDe.hechoEn.toISOString()}::timestamptz, ${filtro.despuesDe.movimientoId}::uuid,
                     ${filtro.despuesDe.numero}::integer)`;
      const { rows } = await sql<FilaDeRenglon>`
        select r.movimiento_id, r.numero, m.clase, m.motivo, m.origen_tipo, m.origen_id, r.hecho_en, m.registrado_por,
               r.cantidad::text as cantidad
          from renglon_de_movimiento r
          join movimiento_de_stock m on m.id = r.movimiento_id and m.empresa_id = r.empresa_id
         where r.empresa_id = ${empresa} and r.deposito_id = ${filtro.depositoId}::uuid and r.articulo_id = ${filtro.articuloId}::uuid
           and r.hecho_en > ${filtro.desde.toISOString()}::timestamptz and ${signo} ${despues}
         order by r.hecho_en, r.movimiento_id, r.numero
         limit ${filtro.limite}`.execute(db);
      return rows.map(aRenglonPosterior);
    },
    async renglonesPorClave(empresa, depositoId, articuloId, claves) {
      const validas = claves.filter((c) => esUuid(c.movimientoId) && Number.isInteger(c.numero));
      if (!esUuid(depositoId) || !esUuid(articuloId) || validas.length === 0) return [];
      const tuplas = validas.map((c) => sql`(${c.movimientoId}::uuid, ${c.numero}::integer)`);
      const { rows } = await sql<FilaDeRenglon>`
        select r.movimiento_id, r.numero, m.clase, m.motivo, m.origen_tipo, m.origen_id, r.hecho_en, m.registrado_por,
               r.cantidad::text as cantidad
          from renglon_de_movimiento r
          join movimiento_de_stock m on m.id = r.movimiento_id and m.empresa_id = r.empresa_id
         where r.empresa_id = ${empresa} and r.deposito_id = ${depositoId}::uuid and r.articulo_id = ${articuloId}::uuid
           and (r.movimiento_id, r.numero) in (${sql.join(tuplas)})
         order by r.hecho_en, r.movimiento_id, r.numero`.execute(db);
      return rows.map(aRenglonPosterior);
    },
  };
}
