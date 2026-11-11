import { sql, type Kysely, type RawBuilder } from "kysely";
import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { EstadoDeCuenta, EstadoDeTicket } from "../dominio/estados";
import { esUuid } from "../dominio/identificadores";
import type { VentasDb } from "./esquema";
import { crearLecturasDeTicket, type LecturasDeTicket } from "./lecturas-de-ticket";
import type {
  TicketDeJornada,
  TicketPorCobranza,
  AnulacionDeLaJornada,
  CorreccionDeLaJornada,
  CortesiaDeLaJornada,
  CuentaAbierta,
  ResumenDeVentas,
  TicketPendienteDeFacturar,
  FiltroDePendientes,
} from "./tipos-de-lecturas";

/**
 * Las lecturas de ventas (E4 §3.12, §3.13 y §3.15): consultas SQL de SOLO lectura, filtradas siempre por la empresa y la sucursal (la RLS lo
 * repite). Devuelven filas planas (importes y cantidades como TEXTO decimal exacto, fechas de negocio como `YYYY-MM-DD`); las reglas (qué
 * es «corregido», qué es una cortesía) están en el dominio y en el SQL de abajo, escritas una sola vez. Ninguna usa el reloj: la misma
 * jornada da las mismas filas y la misma huella.
 */
export type {
  TicketDeJornada,
  TicketPorCobranza,
  AnulacionDeLaJornada,
  CorreccionDeLaJornada,
  CortesiaDeLaJornada,
  CuentaAbierta,
  ResumenDeVentas,
  TicketPendienteDeFacturar,
  CursorDePendientes,
  FiltroDePendientes,
  RenglonParaFacturar,
  TicketParaFacturar,
  FichaDeTicketLeida,
} from "./tipos-de-lecturas";

export interface LecturasDeVentas extends LecturasDeTicket {
  ticketsDeLaJornada(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
  ): Promise<TicketDeJornada[]>;
  ticketsPorCobranza(
    empresa: EmpresaId,
    cobranzas: readonly string[],
  ): Promise<TicketPorCobranza[]>;
  /**
   * Lo mismo para la empresa DEL CONTEXTO de la transacción (`app_empresa_id()`, la misma que aplica la RLS): para el puerto del cierre del día
   * de caja, que no recibe la empresa. Ventas conoce la forma de sus tickets; el filtro por empresa sigue siendo explícito.
   */
  ticketsPorCobranzaDelContexto(cobranzas: readonly string[]): Promise<TicketPorCobranza[]>;
  anulacionesDeLaJornada(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
  ): Promise<AnulacionDeLaJornada[]>;
  correccionesDeLaJornada(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
  ): Promise<CorreccionDeLaJornada[]>;
  cortesiasDeLaJornada(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
  ): Promise<CortesiaDeLaJornada[]>;
  cuentasAbiertas(empresa: EmpresaId, sucursal: SucursalId): Promise<CuentaAbierta[]>;
  resumenDeLaJornada(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
  ): Promise<ResumenDeVentas>;
  pendientesDeFacturar(
    empresa: EmpresaId,
    filtro: FiltroDePendientes,
  ): Promise<TicketPendienteDeFacturar[]>;
}

type Fila = Record<string, unknown>;
const texto = (v: unknown): string => String(v);
const numero = (v: unknown): number => Number(v);
const fecha = (v: unknown): Date => v as Date;

/**
 * El SQL de «lo cobrado de un ticket»: la suma de las aplicaciones de su cobranza (0 si no tiene). `diferencia = cobrado − vigente`
 * (§3.15): el `totalVigente` es el del ejemplar vigente, y 0 si el ticket está anulado.
 */
const COBRADO = sql`coalesce((select sum(a.importe) from aplicacion_de_cobro a where a.empresa_id = t.empresa_id and a.cobranza_id = c.id), 0::numeric(18,2))`;
const VIGENTE = sql`(case when t.estado = 'ANULADO' then 0::numeric(18,2) else ev.total end)`;

/** Los tickets de esas cobranzas de UNA empresa (`empresaSql`: su id, o la del contexto), con el total vigente y lo cobrado. */
async function ticketsPorCobranza(
  db: Kysely<VentasDb>,
  empresaSql: RawBuilder<unknown>,
  cobranzas: readonly string[],
): Promise<TicketPorCobranza[]> {
  const validas = cobranzas.filter(esUuid);
  if (validas.length === 0) return [];
  const filas = await sql<Fila>`
    select c.id as cobranza_id, t.id, t.numero, t.estado, t.ejemplar_vigente, ev.id as ejemplar_vigente_id,
           (${VIGENTE})::text as total_vigente, (${COBRADO})::text as total_cobrado
      from cobranza_de_ticket c
      join ticket t on t.empresa_id = c.empresa_id and t.id = c.ticket_id
      join ticket_ejemplar ev on ev.empresa_id = t.empresa_id and ev.ticket_id = t.id and ev.numero_de_ejemplar = t.ejemplar_vigente
     where c.empresa_id = ${empresaSql} and c.id = any(${validas}::uuid[])
     order by c.id`.execute(db);
  return filas.rows.map((f) => ({
    cobranzaId: texto(f["cobranza_id"]),
    ticketId: texto(f["id"]),
    numero: numero(f["numero"]),
    estado: f["estado"] as EstadoDeTicket,
    ejemplarVigente: numero(f["ejemplar_vigente"]),
    ejemplarVigenteId: texto(f["ejemplar_vigente_id"]),
    totalVigente: texto(f["total_vigente"]),
    totalCobrado: texto(f["total_cobrado"]),
  }));
}

export function crearRepositorioDeLecturas(db: Kysely<VentasDb>): LecturasDeVentas {
  return {
    ...crearLecturasDeTicket(db),
    async ticketsDeLaJornada(empresa, sucursal, jornada) {
      const filas = await sql<Fila>`
        select t.id, t.numero, t.estado, t.ejemplar_vigente, ev.id as ejemplar_vigente_id, t.total::text as total_original,
               (${VIGENTE})::text as total_vigente, (${COBRADO})::text as total_cobrado,
               (case when c.id is null then 0::numeric(18,2) else (${COBRADO}) - (${VIGENTE}) end)::text as diferencia, c.id as cobranza_id, t.emitido_por, t.emitido_en
          from ticket t
          join ticket_ejemplar ev on ev.empresa_id = t.empresa_id and ev.ticket_id = t.id and ev.numero_de_ejemplar = t.ejemplar_vigente
          left join cobranza_de_ticket c on c.empresa_id = t.empresa_id and c.ticket_id = t.id
         where t.empresa_id = ${empresa} and t.sucursal_id = ${sucursal} and t.fecha_negocio = ${jornada}::date
         order by t.numero, t.id`.execute(db);
      const cobranzas = filas.rows.flatMap((f) =>
        f["cobranza_id"] === null ? [] : [texto(f["cobranza_id"])],
      );
      const cobros = new Map<string, { cobroId: string; origenOrden: number; importe: string }[]>();
      if (cobranzas.length > 0) {
        const aplicaciones = await sql<Fila>`
          select a.cobranza_id, a.cobro_id, a.orden, a.importe::text as importe
            from aplicacion_de_cobro a
           where a.empresa_id = ${empresa} and a.cobranza_id = any(${cobranzas}::uuid[])
           order by a.cobranza_id, a.orden`.execute(db);
        for (const a of aplicaciones.rows) {
          const clave = texto(a["cobranza_id"]);
          cobros.set(clave, [
            ...(cobros.get(clave) ?? []),
            {
              cobroId: texto(a["cobro_id"]),
              origenOrden: numero(a["orden"]),
              importe: texto(a["importe"]),
            },
          ]);
        }
      }
      return filas.rows.map((f) => ({
        ticketId: texto(f["id"]),
        numero: numero(f["numero"]),
        estado: f["estado"] as EstadoDeTicket,
        ejemplarVigente: numero(f["ejemplar_vigente"]),
        ejemplarVigenteId: texto(f["ejemplar_vigente_id"]),
        totalOriginal: texto(f["total_original"]),
        totalVigente: texto(f["total_vigente"]),
        totalCobrado: texto(f["total_cobrado"]),
        diferencia: texto(f["diferencia"]),
        cobranzaId: f["cobranza_id"] === null ? null : texto(f["cobranza_id"]),
        cobros: f["cobranza_id"] === null ? [] : (cobros.get(texto(f["cobranza_id"])) ?? []),
        emitidoPor: texto(f["emitido_por"]),
        emitidoEn: fecha(f["emitido_en"]),
      }));
    },

    ticketsPorCobranza: (empresa, cobranzas) =>
      ticketsPorCobranza(db, sql`${empresa}::uuid`, cobranzas),

    ticketsPorCobranzaDelContexto: (cobranzas) =>
      ticketsPorCobranza(db, sql`(select app_empresa_id())`, cobranzas),

    async anulacionesDeLaJornada(empresa, sucursal, jornada) {
      const filas = await sql<Fila>`
        select 'CUENTA' as tipo, c.id as cuenta_id, null::uuid as linea_id, null::text as producto, c.total_provisorio::text as importe,
               c.motivo, c.resuelta_por as quien, c.resuelta_en as cuando
          from cuenta_consumo c
         where c.empresa_id = ${empresa} and c.sucursal_id = ${sucursal} and c.estado = 'ANULADA'
           and fecha_de_negocio_de(c.empresa_id, c.sucursal_id, c.resuelta_en) = ${jornada}::date
        union all
        select 'LINEA', l.cuenta_id, l.id, l.descripcion, round(coalesce(l.importe_fijo, l.precio_unitario * l.cantidad), 2)::text,
               l.motivo_de_anulacion, l.anulada_por, l.anulada_en
          from linea_cuenta l
          join cuenta_consumo c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
         where l.empresa_id = ${empresa} and c.sucursal_id = ${sucursal} and l.estado = 'ANULADA'
           and fecha_de_negocio_de(l.empresa_id, c.sucursal_id, l.anulada_en) = ${jornada}::date
           -- Un traslado (unir, dividir) no es una anulación de negocio (X6, E7); el resto de una anulación parcial (RESTO) sí cuenta.
           and not exists (select 1 from linea_copiada k where k.empresa_id = l.empresa_id and k.linea_origen_id = l.id and k.modo <> 'RESTO')
         order by 8, 2, 3`.execute(db);
      return filas.rows.map((f) => ({
        tipo: f["tipo"] as "CUENTA" | "LINEA",
        cuentaId: texto(f["cuenta_id"]),
        lineaId: f["linea_id"] === null ? null : texto(f["linea_id"]),
        producto: f["producto"] === null ? null : texto(f["producto"]),
        importe: texto(f["importe"]),
        motivo: texto(f["motivo"]),
        quien: texto(f["quien"]),
        cuando: fecha(f["cuando"]),
      }));
    },

    async correccionesDeLaJornada(empresa, sucursal, jornada) {
      const filas = await sql<Fila>`
        select t.id, t.numero, t.ejemplar_vigente, k.tipo, k.motivo, k.hecha_por, k.hecha_en,
               (case when c.id is null then 0::numeric(18,2) else (${COBRADO}) - (${VIGENTE}) end)::text as diferencia
          from ticket_correccion k
          join ticket t on t.empresa_id = k.empresa_id and t.id = k.ticket_id
          join ticket_ejemplar ev on ev.empresa_id = t.empresa_id and ev.ticket_id = t.id and ev.numero_de_ejemplar = t.ejemplar_vigente
          left join cobranza_de_ticket c on c.empresa_id = t.empresa_id and c.ticket_id = t.id
         where k.empresa_id = ${empresa} and t.sucursal_id = ${sucursal} and k.fecha_negocio = ${jornada}::date
         order by t.numero, k.hecha_en, k.id`.execute(db);
      return filas.rows.map((f) => ({
        ticketId: texto(f["id"]),
        numero: numero(f["numero"]),
        ejemplarVigente: numero(f["ejemplar_vigente"]),
        tipo: f["tipo"] as "ANULACION" | "CORRECCION",
        motivo: texto(f["motivo"]),
        diferencia: texto(f["diferencia"]),
        quien: texto(f["hecha_por"]),
        cuando: fecha(f["hecha_en"]),
      }));
    },

    async cortesiasDeLaJornada(empresa, sucursal, jornada) {
      // Una cortesía es un ticket de total original 0 (TOTAL) o con alguna línea del ORIGINAL a $0 dentro de un total mayor (PARCIAL).
      const filas = await sql<Fila>`
        select t.id, t.numero, t.ejemplar_vigente, t.emitido_por, t.emitido_en,
               case when t.total = 0 then 'TOTAL' else 'PARCIAL' end as tipo,
               coalesce((select json_agg(l.id order by l.posicion)
                           from ticket_ejemplar eo
                           join ejemplar_linea el on el.empresa_id = eo.empresa_id and el.ejemplar_id = eo.id
                           join linea_cuenta l on l.empresa_id = el.empresa_id and l.id = el.linea_cuenta_id
                          where eo.empresa_id = t.empresa_id and eo.ticket_id = t.id and eo.numero_de_ejemplar = 1
                            and l.precio_unitario = 0), '[]'::json) as lineas
          from ticket t
         where t.empresa_id = ${empresa} and t.sucursal_id = ${sucursal} and t.fecha_negocio = ${jornada}::date
           and (t.total = 0 or exists (
                 select 1 from ticket_ejemplar eo
                   join ejemplar_linea el on el.empresa_id = eo.empresa_id and el.ejemplar_id = eo.id
                   join linea_cuenta l on l.empresa_id = el.empresa_id and l.id = el.linea_cuenta_id
                  where eo.empresa_id = t.empresa_id and eo.ticket_id = t.id and eo.numero_de_ejemplar = 1 and l.precio_unitario = 0))
         order by t.numero, t.id`.execute(db);
      return filas.rows.map((f) => ({
        ticketId: texto(f["id"]),
        numero: numero(f["numero"]),
        ejemplarVigente: numero(f["ejemplar_vigente"]),
        tipo: f["tipo"] as "TOTAL" | "PARCIAL",
        lineas: f["lineas"] as readonly string[],
        quien: texto(f["emitido_por"]),
        cuando: fecha(f["emitido_en"]),
      }));
    },

    async cuentasAbiertas(empresa, sucursal) {
      const filas = await db
        .selectFrom("cuenta_consumo")
        .select(["id", "etiqueta", "total_provisorio", "abierta_en"])
        .where("empresa_id", "=", empresa)
        .where("sucursal_id", "=", sucursal)
        .where("estado", "=", "ABIERTA" satisfies EstadoDeCuenta)
        .orderBy("abierta_en")
        .orderBy("id")
        .execute();
      return filas.map((f) => ({
        cuentaId: f.id,
        etiqueta: f.etiqueta,
        totalProvisorio: f.total_provisorio,
        abiertaEn: f.abierta_en,
      }));
    },

    async resumenDeLaJornada(empresa, sucursal, jornada) {
      const porEstado = await sql<Fila>`
        select t.estado, count(*)::int as cantidad, coalesce(sum(t.total), 0::numeric(18,2))::text as total
          from ticket t
         where t.empresa_id = ${empresa} and t.sucursal_id = ${sucursal} and t.fecha_negocio = ${jornada}::date
         group by t.estado`.execute(db);
      const pieza = (estado: string) => {
        const f = porEstado.rows.find((x) => x["estado"] === estado);
        return {
          cantidad: f === undefined ? 0 : numero(f["cantidad"]),
          total: f === undefined ? "0.00" : texto(f["total"]),
        };
      };
      const otros = await sql<Fila>`
        select
          (select count(distinct t.id) from ticket t
            join ticket_ejemplar eo on eo.empresa_id = t.empresa_id and eo.ticket_id = t.id and eo.numero_de_ejemplar = 1
            join ejemplar_linea el on el.empresa_id = eo.empresa_id and el.ejemplar_id = eo.id
            join linea_cuenta l on l.empresa_id = el.empresa_id and l.id = el.linea_cuenta_id
           where t.empresa_id = ${empresa} and t.sucursal_id = ${sucursal} and t.fecha_negocio = ${jornada}::date and l.precio_unitario = 0)::int as con_cero,
          (select count(*) from cuenta_consumo c where c.empresa_id = ${empresa} and c.sucursal_id = ${sucursal} and c.estado = 'ANULADA'
              and fecha_de_negocio_de(c.empresa_id, c.sucursal_id, c.resuelta_en) = ${jornada}::date)::int as cuentas,
          (select count(*) from linea_cuenta l join cuenta_consumo c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
            where l.empresa_id = ${empresa} and c.sucursal_id = ${sucursal} and l.estado = 'ANULADA'
              and fecha_de_negocio_de(l.empresa_id, c.sucursal_id, l.anulada_en) = ${jornada}::date)::int as lineas,
          (select count(*) from ticket_correccion k join ticket t on t.empresa_id = k.empresa_id and t.id = k.ticket_id
            where k.empresa_id = ${empresa} and t.sucursal_id = ${sucursal} and k.fecha_negocio = ${jornada}::date)::int as correcciones,
          (select coalesce(sum(a.importe), 0::numeric(18,2))::text from aplicacion_de_cobro a
             join cobranza_de_ticket c on c.empresa_id = a.empresa_id and c.id = a.cobranza_id
             join ticket t on t.empresa_id = c.empresa_id and t.id = c.ticket_id
            where t.empresa_id = ${empresa} and t.sucursal_id = ${sucursal} and t.fecha_negocio = ${jornada}::date) as cobrado`.execute(
        db,
      );
      const o = otros.rows[0] as Fila;
      return {
        emitidos: pieza("EMITIDO"),
        cobrados: pieza("COBRADO"),
        cortesias: pieza("CORTESIA"),
        anulados: pieza("ANULADO"),
        ticketsConLineaACero: numero(o["con_cero"]),
        cuentasAnuladas: numero(o["cuentas"]),
        lineasAnuladas: numero(o["lineas"]),
        correcciones: numero(o["correcciones"]),
        totalCobradoPorTickets: texto(o["cobrado"]),
      };
    },

    async pendientesDeFacturar(empresa, filtro) {
      if (filtro.sucursales !== null && filtro.sucursales.length === 0) return [];
      const sucursales = filtro.sucursales === null ? null : [...filtro.sucursales];
      const c = filtro.despuesDe;
      const filas = await sql<Fila>`
        select t.id, t.numero, t.sucursal_id, t.fecha_negocio::text as fecha_negocio, t.ejemplar_vigente, ev.total::text as total,
               co.creada_en as cobrado_en
          from ticket t
          join ticket_ejemplar ev on ev.empresa_id = t.empresa_id and ev.ticket_id = t.id and ev.numero_de_ejemplar = t.ejemplar_vigente
          join cobranza_de_ticket co on co.empresa_id = t.empresa_id and co.ticket_id = t.id
         where t.empresa_id = ${empresa} and t.estado = 'COBRADO'
           and (${sucursales}::uuid[] is null or t.sucursal_id = any(${sucursales}::uuid[]))
           and (${filtro.fechaDesde}::date is null or t.fecha_negocio >= ${filtro.fechaDesde}::date)
           and (${filtro.fechaHasta}::date is null or t.fecha_negocio <= ${filtro.fechaHasta}::date)
           and (${c === null ? null : c.fechaNegocio}::date is null
                or (t.fecha_negocio, t.numero, t.sucursal_id) > (${c === null ? null : c.fechaNegocio}::date, ${c === null ? null : c.numero}::int, ${c === null ? null : c.sucursalId}::uuid))
         order by t.fecha_negocio, t.numero, t.sucursal_id
         limit ${filtro.limite}`.execute(db);
      return filas.rows.map((f) => ({
        ticketId: texto(f["id"]),
        numero: numero(f["numero"]),
        sucursalId: texto(f["sucursal_id"]),
        fechaNegocio: texto(f["fecha_negocio"]),
        ejemplarVigente: numero(f["ejemplar_vigente"]),
        total: texto(f["total"]),
        cobradoEn: fecha(f["cobrado_en"]),
      }));
    },
  };
}
