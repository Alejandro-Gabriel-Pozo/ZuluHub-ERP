import { sql, type Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { EstadoDeTicket } from "../dominio/estados";
import { esUuid } from "../dominio/identificadores";
import type { VentasDb } from "./esquema";
import type { Ejemplar, Ticket } from "./repositorio-de-tickets";
import type {
  FichaDeTicketLeida,
  RenglonParaFacturar,
  TicketParaFacturar,
} from "./tipos-de-lecturas";

type Fila = Record<string, unknown>;
const texto = (v: unknown): string => String(v);
const numero = (v: unknown): number => Number(v);
const fecha = (v: unknown): Date => v as Date;

/** Las lecturas de UN ticket (E4 §3.12 y §3.13): la ficha con su historial de ejemplares y el ticket listo para facturar. Solo lectura. */
export interface LecturasDeTicket {
  ticketParaFacturar(empresa: EmpresaId, ticket: string): Promise<TicketParaFacturar | null>;
  fichaDeTicket(empresa: EmpresaId, ticket: string): Promise<FichaDeTicketLeida | null>;
}

export function crearLecturasDeTicket(db: Kysely<VentasDb>): LecturasDeTicket {
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
