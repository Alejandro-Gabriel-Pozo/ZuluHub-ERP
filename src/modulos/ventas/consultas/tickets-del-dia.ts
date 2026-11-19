import { exigirSucursal, type ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import { sucursalId, type SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import {
  cajaParaVentas,
  type EstadoDeCajasParaCobrar,
  type ErrorAlConsultarCajasParaCobrar,
  type TipoDeMedio,
} from "../../caja/publico";
import { ORIGEN_DEL_COBRO_DE_TICKET } from "../casos-de-uso/cobrar";
import { esUuid, numeroDeCorreccion } from "../casos-de-uso/calculo";
import type { RenglonParaFacturar, TicketDeJornada } from "../persistencia/tipos-de-lecturas";
import { esImprimible } from "./documento-del-ticket";
import type { DependenciasDeConsultasDeVentas, TxDeConsultasDeVentas } from "./contrato";

/**
 * Las dos lecturas de «Tickets del día» (DDD:293): la lista de la jornada y la ficha de un ticket. Solo leen; las registra `consultas.ts`.
 */

type EstadoDeTicket = TicketDeJornada["estado"];

/** Tope de tickets de una jornada que se entregan a la pantalla. Más que esto no se muestra una lista que parezca completa (nace cerrado). */
export const MAXIMO_DE_TICKETS_DEL_DIA = 1000;

const importe = (monto: string): ImporteJson => ({ moneda: "ARS", monto });

export type TicketDelDia = Readonly<{
  ticketId: string;
  numero: number;
  numeroDeCorreccion: number;
  estado: EstadoDeTicket;
  /** Lo que se vendió (el anulado lo muestra tachado). */
  totalOriginal: ImporteJson;
  /** 0 si está anulado. */
  totalVigente: ImporteJson;
  /** Instante ISO 8601 en UTC; la pantalla lo muestra en hora de Argentina. */
  emitidoEn: string;
  /** Tiene un comprobante que fiscal da por vigente (también «confirmando»). */
  facturado: boolean;
}>;

export type TicketsDelDia = Readonly<{
  fechaNegocio: FechaCivil;
  tickets: readonly TicketDelDia[];
}>;

export type ErrorDeTicketsDelDia =
  | ErrorAlConsultarCajasParaCobrar
  | ErrorDeAlcance
  | "IDENTIFICADOR_INVALIDO"
  | "DEMASIADOS_TICKETS"
  | "FACTURACION_NO_DISPONIBLE";

/**
 * «Hoy» es la jornada de la caja abierta; sin caja abierta, o con más de una, la del reloj con la hora de corte de la sucursal (DDD:293, punto 2).
 */
export function jornadaDeLosTickets(estado: EstadoDeCajasParaCobrar): FechaCivil {
  const abiertas = estado.cajas.filter((c) => c.estado === "ABIERTA" && c.fechaDeNegocio !== null);
  const unica = abiertas.length === 1 ? abiertas[0] : undefined;
  return unica?.fechaDeNegocio ?? estado.jornadaActual.fechaDeNegocio;
}

/**
 * Cuáles de estos tickets tienen un comprobante que fiscal da por vigente. «Facturado» lo decide fiscal, no el puntero (mismo patrón que
 * `pendientes-de-facturar.ts`): sin documentos, ninguno; con documentos y sin facturador, o si fiscal falla, `FACTURACION_NO_DISPONIBLE`.
 */
async function facturadosDe(
  tx: TxDeConsultasDeVentas,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeConsultasDeVentas,
  ticketIds: readonly string[],
): Promise<Resultado<ReadonlySet<string>, "FACTURACION_NO_DISPONIBLE">> {
  const documentos = await tx.documentos.vigentesDe(contexto.empresaId, ticketIds);
  if (documentos.length === 0) return ok(new Set());
  if (dependencias.facturador === undefined) return err("FACTURACION_NO_DISPONIBLE");
  const respuesta = await dependencias.facturador.vigenciaEnTx(
    tx,
    contexto,
    documentos.map((d) => d.comprobanteId),
  );
  if (!respuesta.ok) return err("FACTURACION_NO_DISPONIBLE");
  const vigencia = new Map(respuesta.valor.map((v) => [v.comprobanteId, v.vigente]));
  const facturados = new Set<string>();
  for (const d of documentos) {
    const vale = vigencia.get(d.comprobanteId);
    // El puntero apunta a fiscal por clave foránea: que fiscal no lo conozca es una inconsistencia grave, no «sin comprobante».
    if (vale === undefined) {
      throw new Error(
        `el comprobante ${d.comprobanteId} del ticket ${d.ticketId} no figura en fiscal`,
      );
    }
    if (vale) facturados.add(d.ticketId);
  }
  return ok(facturados);
}

export async function ticketsDelDia(
  tx: TxDeConsultasDeVentas,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeConsultasDeVentas,
  alcance: "TODAS" | readonly SucursalId[],
  entrada: Readonly<{ sucursalId: string }>,
  maximo: number = MAXIMO_DE_TICKETS_DEL_DIA,
): Promise<Resultado<TicketsDelDia, ErrorDeTicketsDelDia>> {
  if (!esUuid(entrada.sucursalId)) return err("IDENTIFICADOR_INVALIDO");
  const sucursal = sucursalId(entrada.sucursalId);
  const permitida = exigirSucursal(alcance, sucursal);
  if (!permitida.ok) return permitida;
  const estado = await cajaParaVentas.estadoDeCajasParaCobrar(tx, contexto, entrada.sucursalId);
  if (!estado.ok) return estado;
  const jornada = jornadaDeLosTickets(estado.valor);
  const filas = await tx.lecturasDeVentas.ticketsDelDia(
    contexto.empresaId,
    sucursal,
    jornada,
    maximo + 1,
  );
  if (filas.length > maximo) return err("DEMASIADOS_TICKETS");
  const facturados = await facturadosDe(
    tx,
    contexto,
    dependencias,
    filas.map((f) => f.ticketId),
  );
  if (!facturados.ok) return facturados;
  return ok({
    fechaNegocio: jornada,
    tickets: filas.map((f) => ({
      ticketId: f.ticketId,
      numero: f.numero,
      numeroDeCorreccion: numeroDeCorreccion(f.ejemplarVigente),
      estado: f.estado,
      totalOriginal: importe(f.totalOriginal),
      totalVigente: importe(f.totalVigente),
      emitidoEn: f.emitidoEn.toISOString(),
      facturado: facturados.valor.has(f.ticketId),
    })),
  });
}

export type CobroDeLaFicha = Readonly<{
  orden: number;
  /** El medio como quedó en la caja (tras una corrección de medio del cierre). */
  medioTipo: TipoDeMedio;
  cuentaDeCobro: Readonly<{ id: string; nombre: string }> | null;
  importe: ImporteJson;
}>;

export type FichaDelTicketDelDia = Readonly<{
  ticketId: string;
  sucursalId: string;
  numero: number;
  numeroDeCorreccion: number;
  estado: EstadoDeTicket;
  fechaNegocio: FechaCivil;
  /** Lo que la pantalla manda como `ejemplarBaseId` al anular. */
  ejemplarVigenteId: string;
  totalOriginal: ImporteJson;
  totalVigente: ImporteJson;
  /** Id de persona; el correo lo resuelve la composición. */
  emitidoPor: string;
  emitidoEn: string;
  facturado: boolean;
  /** Lo que se vendió: los del ejemplar vigente o, si el ticket está anulado, los del ORIGINAL (DDD:293, punto 5). */
  renglones: readonly RenglonParaFacturar[];
  caja: Readonly<{ id: string; nombre: string }> | null;
  cobros: readonly CobroDeLaFicha[];
  anulacion: Readonly<{ motivo: string; hechaPor: string; hechaEn: string }> | null;
  /** false si está ANULADO o es de CORTESÍA (la misma regla que el papel del ticket). */
  imprimible: boolean;
}>;

export type ErrorDeFichaDelTicketDelDia =
  ErrorDeAlcance | "IDENTIFICADOR_INVALIDO" | "TICKET_NO_ENCONTRADO" | "FACTURACION_NO_DISPONIBLE";

export async function fichaDelTicketDelDia(
  tx: TxDeConsultasDeVentas,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeConsultasDeVentas,
  alcance: "TODAS" | readonly SucursalId[],
  entrada: Readonly<{ ticketId: string }>,
): Promise<Resultado<FichaDelTicketDelDia, ErrorDeFichaDelTicketDelDia>> {
  const ficha = await tx.lecturasDeVentas.fichaDeTicket(contexto.empresaId, entrada.ticketId);
  if (ficha === null) return err("TICKET_NO_ENCONTRADO");
  const t = ficha.ticket;
  const permitida = exigirSucursal(alcance, t.sucursalId);
  if (!permitida.ok) return permitida;
  const vigente = ficha.ejemplares.find((e) => e.numeroDeEjemplar === t.ejemplarVigente);
  const original = ficha.ejemplares.find((e) => e.numeroDeEjemplar === 1);
  // Un ticket sin su ejemplar vigente o sin el original es una inconsistencia grave: no se inventa un total.
  if (vigente === undefined || original === undefined) {
    throw new Error(`el ticket ${t.id} no tiene su ejemplar vigente o el original`);
  }
  const facturados = await facturadosDe(tx, contexto, dependencias, [t.id]);
  if (!facturados.ok) return facturados;

  let caja: FichaDelTicketDelDia["caja"] = null;
  let cobros: readonly CobroDeLaFicha[] = [];
  if (ficha.cobranza !== null) {
    const registro = await tx.cajas.obtener(contexto.empresaId, ficha.cobranza.cajaId);
    caja = registro === null ? null : { id: registro.id, nombre: registro.nombre };
    const delOrigen = await cajaParaVentas.cobrosPorOrigen(tx, contexto, {
      tipo: ORIGEN_DEL_COBRO_DE_TICKET,
      id: ficha.cobranza.id,
    });
    // Una cuenta desactivada después del cobro sigue mostrando su nombre (por eso `incluirInactivas`).
    const cuentas = await tx.cuentasDeCobro.listar(contexto.empresaId, {
      sucursales: [t.sucursalId],
      incluirInactivas: true,
    });
    cobros = [...delOrigen.cobros]
      .sort((a, b) => a.origenOrden - b.origenOrden)
      .map((c) => {
        const cuenta =
          c.cuentaDeCobroId === null ? undefined : cuentas.find((q) => q.id === c.cuentaDeCobroId);
        return {
          orden: c.origenOrden,
          medioTipo: c.medioVigenteTipo,
          cuentaDeCobro: cuenta === undefined ? null : { id: cuenta.id, nombre: cuenta.nombre },
          importe: importeAJson(c.importe),
        };
      });
  }

  return ok({
    ticketId: t.id,
    sucursalId: t.sucursalId,
    numero: t.numero,
    numeroDeCorreccion: numeroDeCorreccion(t.ejemplarVigente),
    estado: t.estado,
    fechaNegocio: t.fechaNegocio,
    ejemplarVigenteId: vigente.id,
    totalOriginal: importe(original.total),
    totalVigente: importe(t.estado === "ANULADO" ? "0.00" : vigente.total),
    emitidoPor: t.emitidoPor,
    emitidoEn: t.emitidoEn.toISOString(),
    facturado: facturados.valor.has(t.id),
    renglones: t.estado === "ANULADO" ? ficha.renglonesDelOriginal : ficha.renglonesDelVigente,
    caja,
    cobros,
    imprimible: esImprimible(t.estado),
    anulacion:
      ficha.anulacion === null
        ? null
        : {
            motivo: ficha.anulacion.motivo,
            hechaPor: ficha.anulacion.hechaPor,
            hechaEn: ficha.anulacion.hechaEn.toISOString(),
          },
  });
}
