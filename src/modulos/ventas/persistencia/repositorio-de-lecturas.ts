import { sql, type Kysely } from "kysely";
import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { EstadoDeCuenta, EstadoDeTicket } from "../dominio/estados";
import { esUuid } from "../dominio/identificadores";
import type { VentasDb } from "./esquema";
import type { Ejemplar, Ticket } from "./repositorio-de-tickets";

/**
 * Las lecturas de ventas (E4 §3.12, §3.13 y §3.15): consultas SQL de SOLO lectura, filtradas siempre por la empresa y la sucursal (la RLS lo
 * repite). Devuelven filas planas (importes y cantidades como TEXTO decimal exacto, fechas de negocio como `YYYY-MM-DD`); las reglas (qué
 * es «corregido», qué es una cortesía) están en el dominio y en el SQL de abajo, escritas una sola vez. Ninguna usa el reloj: la misma
 * jornada da las mismas filas y la misma huella.
 */
export type TicketDeJornada = Readonly<{
  ticketId: string;
  numero: number;
  estado: EstadoDeTicket;
  ejemplarVigente: number;
  ejemplarVigenteId: string;
  totalOriginal: string;
  /** El total del ejemplar vigente; 0 si el ticket está anulado. */
  totalVigente: string;
  totalCobrado: string;
  /** `totalCobrado − totalVigente`: distinto de 0 solo si el ticket se anuló o se corrigió a la baja después de cobrarlo. */
  diferencia: string;
  cobranzaId: string | null;
  cobros: readonly Readonly<{ cobroId: string; origenOrden: number; importe: string }>[];
  emitidoPor: string;
  emitidoEn: Date;
}>;

export type TicketPorCobranza = Readonly<{
  cobranzaId: string;
  ticketId: string;
  numero: number;
  estado: EstadoDeTicket;
  ejemplarVigente: number;
  ejemplarVigenteId: string;
  totalVigente: string;
  totalCobrado: string;
}>;

export type AnulacionDeLaJornada = Readonly<{
  tipo: "CUENTA" | "LINEA";
  cuentaId: string;
  lineaId: string | null;
  producto: string | null;
  importe: string;
  motivo: string;
  quien: string;
  cuando: Date;
}>;

export type CorreccionDeLaJornada = Readonly<{
  ticketId: string;
  numero: number;
  ejemplarVigente: number;
  tipo: "ANULACION" | "CORRECCION";
  motivo: string;
  diferencia: string;
  quien: string;
  cuando: Date;
}>;

export type CortesiaDeLaJornada = Readonly<{
  ticketId: string;
  numero: number;
  ejemplarVigente: number;
  tipo: "TOTAL" | "PARCIAL";
  lineas: readonly string[];
  quien: string;
  cuando: Date;
}>;

export type CuentaAbierta = Readonly<{
  cuentaId: string;
  etiqueta: string | null;
  totalProvisorio: string;
  abiertaEn: Date;
}>;

export type ResumenDeVentas = Readonly<{
  emitidos: Readonly<{ cantidad: number; total: string }>;
  cobrados: Readonly<{ cantidad: number; total: string }>;
  cortesias: Readonly<{ cantidad: number; total: string }>;
  anulados: Readonly<{ cantidad: number; total: string }>;
  ticketsConLineaACero: number;
  cuentasAnuladas: number;
  lineasAnuladas: number;
  correcciones: number;
  totalCobradoPorTickets: string;
}>;

export type TicketPendienteDeFacturar = Readonly<{
  ticketId: string;
  numero: number;
  sucursalId: string;
  fechaNegocio: string;
  ejemplarVigente: number;
  total: string;
  cobradoEn: Date;
}>;

export type CursorDePendientes = Readonly<{
  fechaNegocio: string;
  numero: number;
  sucursalId: string;
}>;

export type FiltroDePendientes = Readonly<{
  /** `null`: todas las sucursales (solo cuando el alcance de quien pide es TODAS). */
  sucursales: readonly SucursalId[] | null;
  fechaDesde: string | null;
  fechaHasta: string | null;
  /** Solo `SIN_COMPROBANTE` existe hasta que E1 cree los documentos fiscales; con `COMPROBANTE_ANULADO` no hay nada. */
  despuesDe: CursorDePendientes | null;
  limite: number;
}>;

export type RenglonParaFacturar = Readonly<{
  lineaCuentaId: string;
  descripcion: string;
  varianteNombre: string | null;
  opciones: readonly Readonly<{ grupo: string; nombre: string; recargo: string }>[];
  cantidad: string;
  unidadDeVenta: string;
  precioUnitario: string;
  alicuota: string;
  importe: string;
}>;

export type TicketParaFacturar = Readonly<{
  ticket: Ticket;
  ejemplarVigenteId: string;
  total: string;
  renglones: readonly RenglonParaFacturar[];
}>;

export type FichaDeTicketLeida = Readonly<{
  ticket: Ticket;
  /** Del más reciente al más antiguo; el primero es el vigente. */
  ejemplares: readonly Ejemplar[];
  renglonesDelVigente: readonly RenglonParaFacturar[];
  cobranza: Readonly<{
    id: string;
    cajaId: string;
    creadaEn: Date;
    aplicaciones: readonly Readonly<{
      orden: number;
      cobroId: string;
      cuentaDeCobroId: string | null;
      importe: string;
    }>[];
  }> | null;
}>;

export interface LecturasDeVentas {
  ticketsDeLaJornada(
    empresa: EmpresaId,
    sucursal: SucursalId,
    fecha: FechaCivil,
  ): Promise<TicketDeJornada[]>;
  ticketsPorCobranza(
    empresa: EmpresaId,
    cobranzas: readonly string[],
  ): Promise<TicketPorCobranza[]>;
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
  ticketParaFacturar(empresa: EmpresaId, ticket: string): Promise<TicketParaFacturar | null>;
  fichaDeTicket(empresa: EmpresaId, ticket: string): Promise<FichaDeTicketLeida | null>;
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

export function crearRepositorioDeLecturas(db: Kysely<VentasDb>): LecturasDeVentas {
  async function renglonesDe(empresa: EmpresaId, ejemplar: string): Promise<RenglonParaFacturar[]> {
    const filas = await sql<Fila>`
      select l.id as linea_cuenta_id, l.descripcion, l.variante_nombre, el.cantidad::text as cantidad, l.unidad_de_venta,
             l.precio_unitario::text as precio_unitario, l.alicuota, el.importe::text as importe,
             coalesce((select json_agg(json_build_object('grupo', o.nombre_de_grupo, 'nombre', o.nombre, 'recargo', o.recargo::text)
                                       order by o.orden)
                         from linea_cuenta_opcion o where o.empresa_id = l.empresa_id and o.linea_id = l.id), '[]'::json) as opciones
        from ejemplar_linea el
        join linea_cuenta l on l.id = el.linea_cuenta_id and l.empresa_id = el.empresa_id
       where el.empresa_id = ${empresa} and el.ejemplar_id = ${ejemplar}
       order by l.posicion`.execute(db);
    return filas.rows.map((f) => ({
      lineaCuentaId: texto(f["linea_cuenta_id"]),
      descripcion: texto(f["descripcion"]),
      varianteNombre: f["variante_nombre"] === null ? null : texto(f["variante_nombre"]),
      opciones: f["opciones"] as RenglonParaFacturar["opciones"],
      cantidad: texto(f["cantidad"]),
      unidadDeVenta: texto(f["unidad_de_venta"]),
      precioUnitario: texto(f["precio_unitario"]),
      alicuota: texto(f["alicuota"]),
      importe: texto(f["importe"]),
    }));
  }

  return {
    async ticketsDeLaJornada(empresa, sucursal, jornada) {
      const filas = await sql<Fila>`
        select t.id, t.numero, t.estado, t.ejemplar_vigente, ev.id as ejemplar_vigente_id, t.total::text as total_original,
               (${VIGENTE})::text as total_vigente, (${COBRADO})::text as total_cobrado,
               ((${COBRADO}) - (${VIGENTE}))::text as diferencia, c.id as cobranza_id, t.emitido_por, t.emitido_en
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

    async ticketsPorCobranza(empresa, cobranzas) {
      const validas = cobranzas.filter(esUuid);
      if (validas.length === 0) return [];
      const filas = await sql<Fila>`
        select c.id as cobranza_id, t.id, t.numero, t.estado, t.ejemplar_vigente, ev.id as ejemplar_vigente_id,
               (${VIGENTE})::text as total_vigente, (${COBRADO})::text as total_cobrado
          from cobranza_de_ticket c
          join ticket t on t.empresa_id = c.empresa_id and t.id = c.ticket_id
          join ticket_ejemplar ev on ev.empresa_id = t.empresa_id and ev.ticket_id = t.id and ev.numero_de_ejemplar = t.ejemplar_vigente
         where c.empresa_id = ${empresa} and c.id = any(${validas}::uuid[])
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
    },

    async anulacionesDeLaJornada(empresa, sucursal, jornada) {
      const filas = await sql<Fila>`
        select 'CUENTA' as tipo, c.id as cuenta_id, null::uuid as linea_id, null::text as producto, c.total_provisorio::text as importe,
               c.motivo, c.resuelta_por as quien, c.resuelta_en as cuando
          from cuenta_consumo c
         where c.empresa_id = ${empresa} and c.sucursal_id = ${sucursal} and c.estado = 'ANULADA'
           and fecha_de_negocio_de(c.empresa_id, c.sucursal_id, c.resuelta_en) = ${jornada}::date
        union all
        select 'LINEA', l.cuenta_id, l.id, l.descripcion, round(l.precio_unitario * l.cantidad, 2)::text,
               l.motivo_de_anulacion, l.anulada_por, l.anulada_en
          from linea_cuenta l
          join cuenta_consumo c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
         where l.empresa_id = ${empresa} and c.sucursal_id = ${sucursal} and l.estado = 'ANULADA'
           and fecha_de_negocio_de(l.empresa_id, c.sucursal_id, l.anulada_en) = ${jornada}::date
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
               ((${COBRADO}) - (${VIGENTE}))::text as diferencia
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

    async ticketParaFacturar(empresa, ticketId) {
      if (!esUuid(ticketId)) return null;
      const t = await sql<Fila>`
        select t.id, t.sucursal_id, t.cuenta_id, t.numero, t.fecha_negocio::text as fecha_negocio, t.estado, t.total::text as total,
               t.sesion_de_caja_id, t.ejemplar_vigente, t.emitido_por, t.emitido_en, t.version, ev.id as ejemplar_vigente_id,
               ev.total::text as total_vigente
          from ticket t
          join ticket_ejemplar ev on ev.empresa_id = t.empresa_id and ev.ticket_id = t.id and ev.numero_de_ejemplar = t.ejemplar_vigente
         where t.empresa_id = ${empresa} and t.id = ${ticketId}`.execute(db);
      const f = t.rows[0];
      if (f === undefined) return null;
      return {
        ticket: aTicketDeFila(f),
        ejemplarVigenteId: texto(f["ejemplar_vigente_id"]),
        total: texto(f["total_vigente"]),
        renglones: await renglonesDe(empresa, texto(f["ejemplar_vigente_id"])),
      };
    },

    async fichaDeTicket(empresa, ticketId) {
      if (!esUuid(ticketId)) return null;
      const t = await sql<Fila>`
        select t.id, t.sucursal_id, t.cuenta_id, t.numero, t.fecha_negocio::text as fecha_negocio, t.estado, t.total::text as total,
               t.sesion_de_caja_id, t.ejemplar_vigente, t.emitido_por, t.emitido_en, t.version
          from ticket t where t.empresa_id = ${empresa} and t.id = ${ticketId}`.execute(db);
      const f = t.rows[0];
      if (f === undefined) return null;
      const ejemplares = await sql<Fila>`
        select e.id, e.ticket_id, e.numero_de_ejemplar, e.tipo, e.total::text as total, e.ejemplar_base_id, e.creado_por, e.creado_en
          from ticket_ejemplar e where e.empresa_id = ${empresa} and e.ticket_id = ${ticketId}
         order by e.numero_de_ejemplar desc`.execute(db);
      const vigente = ejemplares.rows.find(
        (e) => numero(e["numero_de_ejemplar"]) === numero(f["ejemplar_vigente"]),
      );
      const cobranza = await sql<Fila>`
        select c.id, c.caja_id, c.creada_en from cobranza_de_ticket c where c.empresa_id = ${empresa} and c.ticket_id = ${ticketId}`.execute(
        db,
      );
      const c = cobranza.rows[0];
      const aplicaciones =
        c === undefined
          ? []
          : (
              await sql<Fila>`
                select a.orden, a.cobro_id, a.cuenta_de_cobro_id, a.importe::text as importe
                  from aplicacion_de_cobro a where a.empresa_id = ${empresa} and a.cobranza_id = ${texto(c["id"])}
                 order by a.orden`.execute(db)
            ).rows;
      return {
        ticket: aTicketDeFila(f),
        ejemplares: ejemplares.rows.map(aEjemplarDeFila),
        renglonesDelVigente:
          vigente === undefined ? [] : await renglonesDe(empresa, texto(vigente["id"])),
        cobranza:
          c === undefined
            ? null
            : {
                id: texto(c["id"]),
                cajaId: texto(c["caja_id"]),
                creadaEn: fecha(c["creada_en"]),
                aplicaciones: aplicaciones.map((a) => ({
                  orden: numero(a["orden"]),
                  cobroId: texto(a["cobro_id"]),
                  cuentaDeCobroId:
                    a["cuenta_de_cobro_id"] === null ? null : texto(a["cuenta_de_cobro_id"]),
                  importe: texto(a["importe"]),
                })),
              },
      };
    },
  };
}

function aTicketDeFila(f: Fila): Ticket {
  return {
    id: texto(f["id"]) as Ticket["id"],
    sucursalId: texto(f["sucursal_id"]) as Ticket["sucursalId"],
    cuentaId: texto(f["cuenta_id"]) as Ticket["cuentaId"],
    numero: numero(f["numero"]),
    fechaNegocio: texto(f["fecha_negocio"]) as Ticket["fechaNegocio"],
    estado: f["estado"] as EstadoDeTicket,
    total: texto(f["total"]),
    sesionDeCajaId: f["sesion_de_caja_id"] === null ? null : texto(f["sesion_de_caja_id"]),
    ejemplarVigente: numero(f["ejemplar_vigente"]),
    emitidoPor: texto(f["emitido_por"]) as Ticket["emitidoPor"],
    emitidoEn: fecha(f["emitido_en"]),
    version: numero(f["version"]),
  };
}

function aEjemplarDeFila(f: Fila): Ejemplar {
  return {
    id: texto(f["id"]) as Ejemplar["id"],
    ticketId: texto(f["ticket_id"]) as Ejemplar["ticketId"],
    numeroDeEjemplar: numero(f["numero_de_ejemplar"]),
    tipo: f["tipo"] as Ejemplar["tipo"],
    total: texto(f["total"]),
    ejemplarBaseId:
      f["ejemplar_base_id"] === null ? null : (texto(f["ejemplar_base_id"]) as Ejemplar["id"]),
    creadoPor: texto(f["creado_por"]) as Ejemplar["creadoPor"],
    creadoEn: fecha(f["creado_en"]),
  };
}
