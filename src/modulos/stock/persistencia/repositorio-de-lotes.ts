import { sql, type Kysely } from "kysely";
import type { AlcanceDeSucursales } from "../../../capacidades/permisos/alcance";
import type { EmpresaId, PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
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

export type AltaDeReasignacion = Readonly<{
  id: string;
  depositoId: string;
  articuloId: string;
  /** `null`: la apertura de un control (todo entra al «sin asignar»; puede ser negativa). */
  loteOrigenId: string | null;
  loteDestinoId: string;
  /** Con signo, texto decimal exacto (positiva si hay origen). */
  cantidad: string;
  motivo: string;
  clave: string;
  por: PersonaId;
  en: Date;
}>;

export type ReasignacionGuardada = Readonly<{
  id: string;
  depositoId: string;
  articuloId: string;
  loteOrigenId: string | null;
  loteDestinoId: string;
  cantidad: string;
  motivo: string;
}>;

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

export interface RepositorioDeLotes {
  /** El control con `SELECT … FOR UPDATE` (serializa dos cambios del mismo control); `null` si el artículo nunca lo tuvo. */
  bloquearControl(empresa: EmpresaId, articuloId: string): Promise<ControlDeLote | null>;
  crearControl(
    empresa: EmpresaId,
    datos: Readonly<{ articuloId: string; modo: ModoDeControl; conCalidad: boolean }>,
  ): Promise<void>;
  cambiarControl(
    empresa: EmpresaId,
    articuloId: string,
    cambios: Readonly<{ modo: ModoDeControl; conCalidad: boolean; activo: boolean }>,
  ): Promise<ControlDeLote>;
  /** La existencia del libro (`saldo_de_stock`) del artículo por depósito, en unidades mínimas. */
  existenciaDelLibroPorDeposito(
    empresa: EmpresaId,
    articuloId: string,
  ): Promise<Map<string, bigint>>;
  /** La suma de los saldos de lote del artículo por depósito, en unidades mínimas. */
  sumaDeLotesPorDeposito(empresa: EmpresaId, articuloId: string): Promise<Map<string, bigint>>;
  /** El lote con `SELECT … FOR UPDATE`; `null` si no existe o es de otra empresa. */
  bloquearLote(empresa: EmpresaId, id: string): Promise<LoteGuardado | null>;
  /** Cambia las fechas del lote (la base sube la versión). */
  corregirFechas(
    empresa: EmpresaId,
    id: string,
    fechas: Readonly<{ fechaDeElaboracion: string | null; fechaDeVencimiento: string | null }>,
  ): Promise<LoteGuardado>;
  registrarReasignacion(empresa: EmpresaId, alta: AltaDeReasignacion): Promise<void>;
  reasignacionPorClave(empresa: EmpresaId, clave: string): Promise<ReasignacionGuardada | null>;
  /** El saldo del lote en el depósito (0 si nunca tuvo), bloqueando la fila si existe (`FOR UPDATE`). */
  bloquearSaldoDeLote(empresa: EmpresaId, depositoId: string, loteId: string): Promise<bigint>;
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

const enAlcance = (alcance: AlcanceDeSucursales): boolean =>
  alcance === "TODAS" || alcance.length > 0;
const aUnidades = (texto: string): bigint => BigInt(texto.replace(".", ""));

export function crearRepositorioDeLotes(db: Kysely<StockDb>): RepositorioDeLotes {
  const aControl = (f: {
    articulo_id: string;
    modo: string;
    con_calidad: boolean;
    activo: boolean;
    version: number;
  }): ControlDeLote => {
    if (f.modo !== "LOTE" && f.modo !== "LOTE_Y_VENCIMIENTO") {
      throw new RangeError(`stock: modo de control de lote desconocido «${f.modo}»`);
    }
    return {
      articuloId: f.articulo_id,
      modo: f.modo,
      conCalidad: f.con_calidad,
      activo: f.activo,
      version: f.version,
    };
  };
  return {
    async bloquearControl(empresa, articuloId) {
      if (!esUuid(articuloId)) return null;
      const fila = await db
        .selectFrom("control_de_lote")
        .select(["articulo_id", "modo", "con_calidad", "activo", "version"])
        .where("empresa_id", "=", empresa)
        .where("articulo_id", "=", articuloId)
        .forUpdate()
        .executeTakeFirst();
      return fila === undefined ? null : aControl(fila);
    },
    async crearControl(empresa, datos) {
      await db
        .insertInto("control_de_lote")
        .values({
          empresa_id: empresa,
          articulo_id: datos.articuloId,
          modo: datos.modo,
          con_calidad: datos.conCalidad,
        })
        .execute();
    },
    async cambiarControl(empresa, articuloId, cambios) {
      const fila = await db
        .updateTable("control_de_lote")
        .set({ modo: cambios.modo, con_calidad: cambios.conCalidad, activo: cambios.activo })
        .where("empresa_id", "=", empresa)
        .where("articulo_id", "=", articuloId)
        .returning(["articulo_id", "modo", "con_calidad", "activo", "version"])
        .executeTakeFirstOrThrow();
      return aControl(fila);
    },
    async existenciaDelLibroPorDeposito(empresa, articuloId) {
      const mapa = new Map<string, bigint>();
      if (!esUuid(articuloId)) return mapa;
      const { rows } = await sql<{ deposito_id: string; existencia: string }>`
        select deposito_id, existencia::text as existencia from saldo_de_stock
         where empresa_id = ${empresa} and articulo_id = ${articuloId}`.execute(db);
      for (const f of rows) mapa.set(f.deposito_id, aUnidades(f.existencia));
      return mapa;
    },
    async sumaDeLotesPorDeposito(empresa, articuloId) {
      const mapa = new Map<string, bigint>();
      if (!esUuid(articuloId)) return mapa;
      const { rows } = await sql<{ deposito_id: string; suma: string }>`
        select deposito_id, sum(existencia)::text as suma from saldo_de_lote
         where empresa_id = ${empresa} and articulo_id = ${articuloId}
         group by deposito_id`.execute(db);
      for (const f of rows) mapa.set(f.deposito_id, aUnidades(f.suma));
      return mapa;
    },
    async bloquearLote(empresa, id) {
      if (!esUuid(id)) return null;
      const { rows } = await sql<FilaDeLote>`
        select ${COLUMNAS_DE_LOTE} from lote where empresa_id = ${empresa} and id = ${id} for update`.execute(
        db,
      );
      return rows[0] === undefined ? null : aLote(rows[0]);
    },
    async corregirFechas(empresa, id, fechas) {
      await sql`
        update lote set fecha_de_elaboracion = ${fechas.fechaDeElaboracion}::date,
                        fecha_de_vencimiento = ${fechas.fechaDeVencimiento}::date
         where empresa_id = ${empresa} and id = ${id}`.execute(db);
      const { rows } = await sql<FilaDeLote>`
        select ${COLUMNAS_DE_LOTE} from lote where empresa_id = ${empresa} and id = ${id}`.execute(
        db,
      );
      if (rows[0] === undefined) throw new Error("el lote corregido no es visible");
      return aLote(rows[0]);
    },
    async registrarReasignacion(empresa, alta) {
      await db
        .insertInto("reasignacion_de_lote")
        .values({
          id: alta.id,
          empresa_id: empresa,
          deposito_id: alta.depositoId,
          articulo_id: alta.articuloId,
          lote_origen_id: alta.loteOrigenId,
          lote_destino_id: alta.loteDestinoId,
          cantidad: alta.cantidad,
          motivo: alta.motivo,
          clave_idempotencia: alta.clave,
          por: alta.por,
          en: alta.en,
        })
        .execute();
    },
    async reasignacionPorClave(empresa, clave) {
      const { rows } = await sql<{
        id: string;
        deposito_id: string;
        articulo_id: string;
        lote_origen_id: string | null;
        lote_destino_id: string;
        cantidad: string;
        motivo: string;
      }>`
        select id, deposito_id, articulo_id, lote_origen_id, lote_destino_id, cantidad::text as cantidad, motivo
          from reasignacion_de_lote where empresa_id = ${empresa} and clave_idempotencia = ${clave}`.execute(
        db,
      );
      const f = rows[0];
      return f === undefined
        ? null
        : {
            id: f.id,
            depositoId: f.deposito_id,
            articuloId: f.articulo_id,
            loteOrigenId: f.lote_origen_id,
            loteDestinoId: f.lote_destino_id,
            cantidad: f.cantidad,
            motivo: f.motivo,
          };
    },
    async bloquearSaldoDeLote(empresa, depositoId, loteId) {
      if (!esUuid(depositoId) || !esUuid(loteId)) return 0n;
      const { rows } = await sql<{ existencia: string }>`
        select existencia::text as existencia from saldo_de_lote
         where empresa_id = ${empresa} and deposito_id = ${depositoId} and lote_id = ${loteId} for update`.execute(
        db,
      );
      return rows[0] === undefined ? 0n : aUnidades(rows[0].existencia);
    },
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
