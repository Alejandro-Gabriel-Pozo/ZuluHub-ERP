import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import { esCalidadDeLote, type CalidadDeLote } from "../dominio/calidad";
import type { LoteCandidato } from "../dominio/lotes";
import type { StockDb } from "./esquema";
import { esUuid } from "./filas";

/**
 * Los lotes (0032, E6): control por artículo, el lote con su identidad, los lotes de cada renglón del libro y los candidatos de una salida.
 * Las fechas (`date`) se leen con `::text` y se escriben con `::date`; los decimales, como texto (ADR-006). El saldo por lote NO se escribe
 * acá: lo escriben los disparadores de `renglon_de_lote` y de `reasignacion_de_lote` (la base).
 */
export type ModoDeControl = "LOTE" | "LOTE_Y_VENCIMIENTO";

export type ControlDeLote = Readonly<{
  articuloId: string;
  modo: ModoDeControl;
  conCalidad: boolean;
  activo: boolean;
  version: number;
}>;

export type LoteGuardado = Readonly<{
  id: string;
  articuloId: string;
  codigo: string;
  referenciaDeOrigen: string | null;
  fechaDeElaboracion: string | null;
  fechaDeVencimiento: string | null;
  esSinAsignar: boolean;
  calidad: CalidadDeLote | null;
  fechaDePrimerIngreso: string;
  version: number;
}>;

export type AltaDeLote = Readonly<{
  id: string;
  articuloId: string;
  codigo: string;
  referenciaDeOrigen: string | null;
  fechaDeElaboracion: string | null;
  fechaDeVencimiento: string | null;
  esSinAsignar: boolean;
  fechaDePrimerIngreso: string;
  creadoPor: PersonaId;
  creadoEn: Date;
}>;

export type RenglonDeLoteGuardado = Readonly<{
  renglonNumero: number;
  depositoId: string;
  articuloId: string;
  composicionId: string | null;
  loteId: string;
  /** Con signo, texto decimal exacto. */
  cantidad: string;
}>;

export interface RepositorioDeLotes {
  /** El control de cada artículo (activo o no); el que no figura no lleva lotes. */
  controlesDe(
    empresa: EmpresaId,
    articuloIds: readonly string[],
  ): Promise<Map<string, ControlDeLote>>;
  /** El lote «sin asignar» del artículo, o `null` si no lleva control. */
  sinAsignar(empresa: EmpresaId, articuloId: string): Promise<string | null>;
  /**
   * Busca el lote por su identidad (artículo, código, origen) o lo crea. `INSERT … ON CONFLICT DO NOTHING` y después lectura: dos entradas
   * del mismo lote a la vez no duplican (el único de identidad lo sostiene). `creado`: lo creó esta llamada.
   */
  buscarOCrear(
    empresa: EmpresaId,
    alta: AltaDeLote,
  ): Promise<Readonly<{ lote: LoteGuardado; creado: boolean }>>;
  obtener(empresa: EmpresaId, id: string): Promise<LoteGuardado | null>;
  /** Los lotes del artículo con su existencia en el depósito (el «sin asignar» siempre figura), listos para elegir. Bloquea los lotes `FOR SHARE`. */
  candidatos(empresa: EmpresaId, depositoId: string, articuloId: string): Promise<LoteCandidato[]>;
  insertarRenglonesDeLote(
    empresa: EmpresaId,
    filas: ReadonlyArray<
      Readonly<{ movimientoId: string; renglonNumero: number; loteId: string; cantidad: string }>
    >,
  ): Promise<void>;
  /** Los lotes de cada renglón de un movimiento, con la identidad del renglón (para repetirlos en una anulación). */
  renglonesDeLoteDe(empresa: EmpresaId, movimientoId: string): Promise<RenglonDeLoteGuardado[]>;
  /** Una fila de la historia de calidad (la base copia el estado al lote). */
  registrarCalidad(
    empresa: EmpresaId,
    datos: Readonly<{
      loteId: string;
      estado: CalidadDeLote;
      motivo: string;
      por: PersonaId;
      en: Date;
    }>,
  ): Promise<void>;
}

type FilaDeLote = {
  id: string;
  articulo_id: string;
  codigo: string;
  referencia_de_origen: string | null;
  fecha_de_elaboracion: string | null;
  fecha_de_vencimiento: string | null;
  es_sin_asignar: boolean;
  calidad: string | null;
  fecha_de_primer_ingreso: string;
  version: number;
};

const aLote = (f: FilaDeLote): LoteGuardado => ({
  id: f.id,
  articuloId: f.articulo_id,
  codigo: f.codigo,
  referenciaDeOrigen: f.referencia_de_origen,
  fechaDeElaboracion: f.fecha_de_elaboracion,
  fechaDeVencimiento: f.fecha_de_vencimiento,
  esSinAsignar: f.es_sin_asignar,
  calidad: f.calidad === null ? null : calidadGuardada(f.calidad),
  fechaDePrimerIngreso: f.fecha_de_primer_ingreso,
  version: f.version,
});

function calidadGuardada(texto: string): CalidadDeLote {
  if (!esCalidadDeLote(texto))
    throw new RangeError(`stock: calidad de lote desconocida «${texto}»`);
  return texto;
}

const COLUMNAS_DE_LOTE = sql`id, articulo_id, codigo, referencia_de_origen, fecha_de_elaboracion::text as fecha_de_elaboracion,
  fecha_de_vencimiento::text as fecha_de_vencimiento, es_sin_asignar, calidad, fecha_de_primer_ingreso::text as fecha_de_primer_ingreso, version`;

export function crearRepositorioDeLotes(db: Kysely<StockDb>): RepositorioDeLotes {
  return {
    async controlesDe(empresa, articuloIds) {
      const ids = [...new Set(articuloIds)].filter(esUuid);
      const controles = new Map<string, ControlDeLote>();
      if (ids.length === 0) return controles;
      const filas = await db
        .selectFrom("control_de_lote")
        .select(["articulo_id", "modo", "con_calidad", "activo", "version"])
        .where("empresa_id", "=", empresa)
        .where("articulo_id", "in", ids)
        .execute();
      for (const f of filas) {
        if (f.modo !== "LOTE" && f.modo !== "LOTE_Y_VENCIMIENTO") {
          throw new RangeError(`stock: modo de control de lote desconocido «${f.modo}»`);
        }
        controles.set(f.articulo_id, {
          articuloId: f.articulo_id,
          modo: f.modo,
          conCalidad: f.con_calidad,
          activo: f.activo,
          version: f.version,
        });
      }
      return controles;
    },
    async sinAsignar(empresa, articuloId) {
      if (!esUuid(articuloId)) return null;
      const fila = await db
        .selectFrom("lote")
        .select("id")
        .where("empresa_id", "=", empresa)
        .where("articulo_id", "=", articuloId)
        .where("es_sin_asignar", "=", true)
        .executeTakeFirst();
      return fila?.id ?? null;
    },
    async buscarOCrear(empresa, alta) {
      const insertada = await sql<{ id: string }>`
        insert into lote (id, empresa_id, articulo_id, codigo, referencia_de_origen, fecha_de_elaboracion, fecha_de_vencimiento,
                          es_sin_asignar, fecha_de_primer_ingreso, creado_por, creado_en)
        values (${alta.id}, ${empresa}, ${alta.articuloId}, ${alta.codigo}, ${alta.referenciaDeOrigen}, ${alta.fechaDeElaboracion}::date,
                ${alta.fechaDeVencimiento}::date, ${alta.esSinAsignar}, ${alta.fechaDePrimerIngreso}::date, ${alta.creadoPor}, ${alta.creadoEn})
        on conflict do nothing
        returning id`.execute(db);
      const { rows } = await sql<FilaDeLote>`
        select ${COLUMNAS_DE_LOTE} from lote
         where empresa_id = ${empresa} and articulo_id = ${alta.articuloId} and codigo = ${alta.codigo}
           and referencia_de_origen is not distinct from ${alta.referenciaDeOrigen}`.execute(db);
      const fila = rows[0];
      if (fila === undefined) throw new Error("el lote recién escrito no es visible");
      return { lote: aLote(fila), creado: insertada.rows.length > 0 };
    },
    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const { rows } =
        await sql<FilaDeLote>`select ${COLUMNAS_DE_LOTE} from lote where empresa_id = ${empresa} and id = ${id}`.execute(
          db,
        );
      return rows[0] === undefined ? null : aLote(rows[0]);
    },
    async candidatos(empresa, depositoId, articuloId) {
      if (!esUuid(depositoId) || !esUuid(articuloId)) return [];
      const { rows } = await sql<{
        id: string;
        es_sin_asignar: boolean;
        vence: string | null;
        calidad: string | null;
        primer_ingreso: string;
        existencia: string | null;
      }>`
        select l.id, l.es_sin_asignar, l.fecha_de_vencimiento::text as vence, l.calidad,
               l.fecha_de_primer_ingreso::text as primer_ingreso, s.existencia::text as existencia
          from lote l
          left join saldo_de_lote s
            on s.empresa_id = l.empresa_id and s.lote_id = l.id and s.deposito_id = ${depositoId}
         where l.empresa_id = ${empresa} and l.articulo_id = ${articuloId}
         order by l.fecha_de_vencimiento nulls last, l.fecha_de_primer_ingreso, l.id
           for share of l`.execute(db);
      return rows.map((f) => ({
        loteId: f.id,
        esSinAsignar: f.es_sin_asignar,
        vence: f.vence,
        calidad: f.calidad === null ? null : calidadGuardada(f.calidad),
        primerIngreso: f.primer_ingreso,
        existencia: BigInt((f.existencia ?? "0").replace(".", "")),
      }));
    },
    async insertarRenglonesDeLote(empresa, filas) {
      if (filas.length === 0) return;
      await db
        .insertInto("renglon_de_lote")
        .values(
          filas.map((f) => ({
            empresa_id: empresa,
            movimiento_id: f.movimientoId,
            renglon_numero: f.renglonNumero,
            lote_id: f.loteId,
            cantidad: f.cantidad,
          })),
        )
        .execute();
    },
    async renglonesDeLoteDe(empresa, movimientoId) {
      if (!esUuid(movimientoId)) return [];
      const { rows } = await sql<{
        renglon_numero: number;
        deposito_id: string;
        articulo_id: string;
        composicion_id: string | null;
        lote_id: string;
        cantidad: string;
      }>`
        select l.renglon_numero, r.deposito_id, r.articulo_id, r.composicion_id, l.lote_id, l.cantidad::text as cantidad
          from renglon_de_lote l
          join renglon_de_movimiento r
            on r.empresa_id = l.empresa_id and r.movimiento_id = l.movimiento_id and r.numero = l.renglon_numero
         where l.empresa_id = ${empresa} and l.movimiento_id = ${movimientoId}
         order by l.renglon_numero, l.lote_id`.execute(db);
      return rows.map((f) => ({
        renglonNumero: f.renglon_numero,
        depositoId: f.deposito_id,
        articuloId: f.articulo_id,
        composicionId: f.composicion_id,
        loteId: f.lote_id,
        cantidad: f.cantidad,
      }));
    },
    async registrarCalidad(empresa, datos) {
      await db
        .insertInto("calidad_de_lote")
        .values({
          empresa_id: empresa,
          lote_id: datos.loteId,
          estado: datos.estado,
          motivo: datos.motivo,
          por: datos.por,
          en: datos.en,
        })
        .execute();
    },
  };
}
