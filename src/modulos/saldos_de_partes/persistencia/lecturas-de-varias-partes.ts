import { sql, type Kysely } from "kysely";
import { importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { esUuidCanonico, type EmpresaId } from "../../../primitivas/identificadores/marca";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { Sentido } from "../dominio/clases";
import { estaVencida } from "../dominio/vencida";
import type { SaldosDb } from "./esquema";

/**
 * Las lecturas del libro que abarcan VARIAS partes a la vez (CC-4: la lista de clientes con cuenta y la exportación) y las partidas abiertas que comparten con las de UNA parte. Viven acá
 * para que `repositorio-de-saldos.ts` no pase el tope de líneas; todo filtra por la empresa y solo lee.
 */
/** Un asiento con algo pendiente: un cargo (suma) por saldar, o un saldo a favor (resta) por aplicar. `pendiente` = `tope` − `imputado`, siempre > 0. */
export type PartidaAbierta = Readonly<{
  asientoId: string;
  clase: string;
  venceEl: FechaCivil | null;
  registradoEn: Date;
  referenciaTipo: string | null;
  referenciaId: string | null;
  tope: Importe;
  imputado: Importe;
  pendiente: Importe;
}>;

/**
 * Un cargo con algo por saldar. `vencida` se MARCA y no bloquea nada: `venceEl` anterior a la fecha de hoy (sin vencimiento, nunca). La regla es `estaVencida`
 * del dominio (una sola); se aplica acá porque las consultas no importan el dominio (ADR-005).
 */
export type CargoPendiente = PartidaAbierta & Readonly<{ vencida: boolean }>;

/** De qué lado se piden las partidas abiertas: los cargos (importe > 0) o los saldos a favor (importe < 0). */
export type LadoDePartida = "CARGOS" | "CREDITOS";

/**
 * Un movimiento del libro tal como lo necesitan los reportes de varias partes a la vez (CC-4): el asiento con su signo, de dónde viene (`origen*`, el del asiento ORIGINAL aunque la fila sea su
 * anulación), lo que le queda por saldar (`pendiente`, solo un cargo vigente; cero en el resto), si está anulado (el original anulado y su espejo) y los centros de costo (sucursales) de su
 * distribución; `null` = «sin centro».
 */
export type MovimientoDelLibro = Readonly<{
  asientoId: string;
  parteId: string;
  clase: string;
  naturaleza: "ORIGINAL" | "ANULACION";
  importe: Importe;
  pendiente: Importe;
  anulado: boolean;
  fechaNegocio: FechaCivil;
  registradoEn: Date;
  venceEl: FechaCivil | null;
  origenTipo: string;
  origenId: string;
  sucursales: readonly (string | null)[];
}>;

/** El saldo de una parte en un sentido (ARS): lo lee la lista de clientes con cuenta. */
export type SaldoDeParte = Readonly<{ parteId: string; saldo: Importe }>;

/** Un cargo con algo por saldar y de quién es: lo agrega la lista de clientes con cuenta. */
export type CargoPendienteDeParte = CargoPendiente &
  Readonly<{
    parteId: string;
    fechaNegocio: FechaCivil;
    /** De dónde viene el cargo (el ticket que lo originó): solo lectura, para que quien muestra la deuda pueda vincular la fila con su origen. */
    origenTipo: string;
    origenId: string;
  }>;

/** Lo que lee el libro de VARIAS partes a la vez (CC-4). */
export interface LecturasDeVariasPartes {
  /**
   * CC-4: todos los movimientos de varias partes a la vez, por parte y orden de registro (los espejos de anulación incluidos). Lee a lo sumo `limite + 1` filas: quien llama compara con `limite` y
   * rechaza el pedido entero en vez de armar un archivo a medias. La suma de los importes de una parte es EXACTAMENTE `saldoDeParte`.
   */
  movimientosDeLasPartes(
    empresa: EmpresaId,
    sentido: Sentido,
    parteIds: readonly string[],
    limite: number,
  ): Promise<MovimientoDelLibro[]>;
  /** CC-4: el saldo de cada una de esas partes (las que nunca tuvieron asientos salen con saldo cero). */
  saldosDeLasPartes(
    empresa: EmpresaId,
    sentido: Sentido,
    parteIds: readonly string[],
  ): Promise<SaldoDeParte[]>;
  /** CC-4: los cargos con algo por saldar de esas partes, cada uno con su «vencida» a `hoy`. */
  cargosAbiertosDeLasPartes(
    empresa: EmpresaId,
    sentido: Sentido,
    parteIds: readonly string[],
    hoy: FechaCivil,
  ): Promise<CargoPendienteDeParte[]>;
}

export function crearLecturasDeVariasPartes(db: Kysely<SaldosDb>): LecturasDeVariasPartes {
  return {
    async cargosAbiertosDeLasPartes(empresa, sentido, parteIds, hoy) {
      const partidas = await partidasAbiertas(db, empresa, parteIds, sentido, "CARGOS");
      return partidas.map((p) => ({ ...p, vencida: estaVencida(p.venceEl, hoy) }));
    },

    async saldosDeLasPartes(empresa, sentido, parteIds) {
      const ids = parteIds.filter(esUuidCanonico);
      if (ids.length === 0) return [];
      const filas = await db
        .selectFrom("saldo_de_parte as s")
        .select(["s.parte_id as parte_id", sql<string>`s.saldo::text`.as("saldo")])
        .where("s.empresa_id", "=", empresa)
        .where(sql<boolean>`s.parte_id = any(${ids}::uuid[])`)
        .where("s.sentido", "=", sentido)
        .where("s.moneda", "=", ARS)
        .execute();
      const conSaldo = new Map(filas.map((f) => [f.parte_id, f.saldo]));
      return ids.map((id) => ({
        parteId: id,
        saldo: importeDesdeTexto(ARS, conSaldo.get(id) ?? "0.00"),
      }));
    },

    async movimientosDeLasPartes(empresa, sentido, parteIds, limite) {
      const ids = parteIds.filter(esUuidCanonico);
      if (ids.length === 0) return [];
      const filas = await db
        .selectFrom("asiento_de_saldo as a")
        .leftJoin("saldo_de_asiento as s", (j) =>
          j.onRef("s.empresa_id", "=", "a.empresa_id").onRef("s.asiento_id", "=", "a.id"),
        )
        // El espejo de una anulación sale con el origen del asiento que anula: «de dónde viene» el movimiento es lo mismo para el par.
        .leftJoin("asiento_de_saldo as o", (j) =>
          j.onRef("o.empresa_id", "=", "a.empresa_id").onRef("o.id", "=", "a.anula_a"),
        )
        .select([
          "a.id as id",
          "a.parte_id as parte_id",
          "a.clase as clase",
          "a.naturaleza as naturaleza",
          sql<string>`a.importe::text`.as("importe"),
          sql<string>`case when a.naturaleza = 'ORIGINAL' and a.importe > 0 and s.anulado = false then (s.tope - s.importe_imputado)::text else '0.00' end`.as(
            "pendiente",
          ),
          sql<boolean>`(a.naturaleza = 'ANULACION' or coalesce(s.anulado, false))`.as("anulado"),
          sql<string>`a.fecha_negocio::text`.as("fecha_negocio"),
          "a.registrado_en as registrado_en",
          sql<string | null>`a.vence_el::text`.as("vence_el"),
          sql<string>`coalesce(o.origen_tipo, a.origen_tipo)`.as("origen_tipo"),
          sql<string>`coalesce(o.origen_id, a.origen_id)::text`.as("origen_id"),
          sql<
            (string | null)[]
          >`(select coalesce(array_agg(d.sucursal_id::text order by d.sucursal_id nulls last), '{}'::text[]) from distribucion_de_asiento d where d.empresa_id = a.empresa_id and d.asiento_id = a.id)`.as(
            "sucursales",
          ),
        ])
        .where("a.empresa_id", "=", empresa)
        .where(sql<boolean>`a.parte_id = any(${ids}::uuid[])`)
        .where("a.sentido", "=", sentido)
        .where("a.moneda", "=", ARS)
        .orderBy("a.parte_id")
        .orderBy("a.registrado_en")
        .orderBy("a.id")
        .limit(limite + 1)
        .execute();
      return filas.map((f) => ({
        asientoId: f.id,
        parteId: f.parte_id,
        clase: f.clase,
        naturaleza: f.naturaleza,
        importe: importeDesdeTexto(ARS, f.importe),
        pendiente: importeDesdeTexto(ARS, f.pendiente),
        anulado: f.anulado,
        fechaNegocio: f.fecha_negocio as FechaCivil,
        registradoEn: f.registrado_en,
        venceEl: f.vence_el === null ? null : (f.vence_el as FechaCivil),
        origenTipo: f.origen_tipo,
        origenId: f.origen_id,
        sucursales: f.sucursales,
      }));
    },
  };
}

/** La partida sin los datos de más que solo usan las lecturas de varias partes (`parteId`, `fechaNegocio`). */
export function aPartida(p: PartidaAbierta): PartidaAbierta {
  return {
    asientoId: p.asientoId,
    clase: p.clase,
    venceEl: p.venceEl,
    registradoEn: p.registradoEn,
    referenciaTipo: p.referenciaTipo,
    referenciaId: p.referenciaId,
    tope: p.tope,
    imputado: p.imputado,
    pendiente: p.pendiente,
  };
}

/** Los cargos o los saldos a favor de la parte con algo pendiente (los anulados y los espejos no cuentan), por vencimiento (sin vencimiento al final) y antigüedad. */
export async function partidasAbiertas(
  db: Kysely<SaldosDb>,
  empresa: EmpresaId,
  parteIds: readonly string[],
  sentido: Sentido,
  lado: LadoDePartida,
): Promise<
  (PartidaAbierta &
    Readonly<{
      parteId: string;
      fechaNegocio: FechaCivil;
      origenTipo: string;
      origenId: string;
    }>)[]
> {
  const ids = parteIds.filter(esUuidCanonico);
  if (ids.length === 0) return [];
  const filas = await db
    .selectFrom("asiento_de_saldo as a")
    .innerJoin("saldo_de_asiento as s", (j) =>
      j.onRef("s.empresa_id", "=", "a.empresa_id").onRef("s.asiento_id", "=", "a.id"),
    )
    .select([
      "a.id as id",
      "a.parte_id as parte_id",
      "a.clase as clase",
      sql<string>`a.fecha_negocio::text`.as("fecha_negocio"),
      sql<string | null>`a.vence_el::text`.as("vence_el"),
      "a.registrado_en as registrado_en",
      "a.referencia_tipo as referencia_tipo",
      "a.referencia_id as referencia_id",
      "a.origen_tipo as origen_tipo",
      sql<string>`a.origen_id::text`.as("origen_id"),
      sql<string>`s.tope::text`.as("tope"),
      sql<string>`s.importe_imputado::text`.as("imputado"),
      sql<string>`(s.tope - s.importe_imputado)::text`.as("pendiente"),
    ])
    .where("a.empresa_id", "=", empresa)
    .where(sql<boolean>`a.parte_id = any(${ids}::uuid[])`)
    .where("a.sentido", "=", sentido)
    .where("a.moneda", "=", ARS)
    .where("a.naturaleza", "=", "ORIGINAL")
    .where("s.anulado", "=", false)
    .where(sql<boolean>`s.tope > s.importe_imputado`)
    .where(lado === "CARGOS" ? sql<boolean>`a.importe > 0` : sql<boolean>`a.importe < 0`)
    .orderBy("a.parte_id")
    .orderBy(sql`a.vence_el nulls last`)
    .orderBy("a.registrado_en")
    .orderBy("a.id")
    .execute();
  return filas.map((f) => ({
    asientoId: f.id,
    parteId: f.parte_id,
    fechaNegocio: f.fecha_negocio as FechaCivil,
    clase: f.clase,
    venceEl: f.vence_el === null ? null : (f.vence_el as FechaCivil),
    registradoEn: f.registrado_en,
    referenciaTipo: f.referencia_tipo,
    referenciaId: f.referencia_id,
    origenTipo: f.origen_tipo,
    origenId: f.origen_id,
    tope: importeDesdeTexto(ARS, f.tope),
    imputado: importeDesdeTexto(ARS, f.imputado),
    pendiente: importeDesdeTexto(ARS, f.pendiente),
  }));
}
