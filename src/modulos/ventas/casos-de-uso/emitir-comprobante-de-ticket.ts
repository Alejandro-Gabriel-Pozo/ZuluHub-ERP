import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  comprobanteIdDeLaFactura,
  descripcionDelRenglon,
  documentoIdDeLaFactura,
  origenDeLaFactura,
  unidadDelRenglon,
} from "../dominio/factura-de-ticket";
import { ticketId, type TicketId } from "../dominio/identificadores";
import { exigirAlcance, exigirUuid, prepararComando, traducir } from "./comun";
import type { DependenciasDeVentas, TxDeVentas } from "./contrato";
import type { ErrorDeVentas } from "./errores";
import type { ReceptorDeFactura } from "./puertos-de-facturacion";

type R<S> = Resultado<S, ErrorDeVentas>;

export type EntradaDeEmitirComprobanteDeTicket = Readonly<{
  ticketId: string;
  /** El receptor tal como lo manda la pantalla: ventas lo pasa a fiscal, que lo valida. */
  receptor: ReceptorDeFactura;
  puntoDeVentaId: string;
  /** La clave de la pantalla, un uuid por intento (idempotencia). */
  clave: string;
}>;

export type SalidaDeEmitirComprobanteDeTicket = Readonly<{
  ticketId: TicketId;
  comprobanteId: string;
  /** El estado del comprobante recién creado; `null` si es la repetición de una clave ya usada (el estado vigente lo da el comprobante). */
  estado: string | null;
  /** `true`: la misma clave ya había facturado este ticket; no se escribió nada. */
  yaExistia: boolean;
}>;

/**
 * `emitirComprobanteDeTicket` (E1 §3.3): la factura de un ticket cobrado, con los renglones congelados del ejemplar vigente; la persona solo
 * elige el receptor. Una transacción serializable, con el guard primero (`ventas.ver` y `comprobantes.emitir`; fiscal vuelve a pedir la suya):
 *  1. La clave ya usada devuelve ese comprobante sin escribir (con otro ticket, `CLAVE_REUTILIZADA`).
 *  2. El ticket es de la empresa y está en el alcance de quien pide; tiene que estar COBRADO (`TICKET_NO_FACTURABLE`).
 *  3. La fila del ticket se toma `FOR UPDATE`: dos personas que facturan el mismo ticket se turnan.
 *  4. Si ya tiene un documento vigente se le pregunta a FISCAL si el comprobante sigue valiendo: si vale (también «Confirmando»), el ticket ya
 *     está facturado (`TICKET_YA_FACTURADO`) y no se emite otro; si dejó de valer (rechazado, descartado o acreditado por completo) se marca
 *     ese documento no vigente y sigue, en la misma transacción.
 *  5. El origen del intento sale de (ticket, intento) de manera determinística (`origenDeLaFactura`); fiscal repite por origen.
 *  6. Los renglones son los del ejemplar vigente; fiscal valida que su total sea el cobrado y emite (nada va a ARCA dentro de la transacción).
 *  7. Se guarda el puntero `documento_de_ticket` y se audita. Todo o nada: si algo falla después de fiscal, no queda ni la factura.
 * «Facturado» lo decide siempre fiscal: el puntero no es una marca propia. Sin `facturador` (la composición no lo armó), se rechaza.
 */
async function emitir(
  tx: TxDeVentas,
  dependencias: DependenciasDeVentas,
  contexto: ContextoOperativo,
  entrada: EntradaDeEmitirComprobanteDeTicket,
): Promise<R<SalidaDeEmitirComprobanteDeTicket>> {
  const { empresaId } = contexto;
  const persona = await prepararComando(tx, contexto, dependencias.reglas, [
    "ventas.ver",
    "comprobantes.emitir",
  ]);
  if (!persona.ok) return persona;
  const facturador = dependencias.facturador;
  if (facturador === undefined) return err("FACTURACION_NO_DISPONIBLE");
  const ids = exigirUuid(entrada.ticketId, entrada.puntoDeVentaId, entrada.clave);
  if (!ids.ok) return ids;

  const previa = await tx.documentos.porClave(empresaId, entrada.clave);
  if (previa !== null) {
    if (previa.ticketId !== entrada.ticketId) return err("CLAVE_REUTILIZADA");
    return ok({
      ticketId: previa.ticketId,
      comprobanteId: previa.comprobanteId,
      estado: null,
      yaExistia: true,
    });
  }

  const ticket = await tx.tickets.obtener(empresaId, ticketId(entrada.ticketId));
  if (ticket === null) return err("TICKET_NO_ENCONTRADO");
  const alcance = await exigirAlcance(tx, contexto, ticket.sucursalId);
  if (!alcance.ok) return alcance;
  if (!(await tx.documentos.bloquearTicket(empresaId, ticket.id)))
    return err("TICKET_NO_ENCONTRADO");
  // Con la fila tomada se vuelve a leer: lo que sigue es lo que vale mientras dure la transacción.
  const actual = await tx.tickets.obtener(empresaId, ticket.id);
  if (actual === null || actual.estado !== "COBRADO") return err("TICKET_NO_FACTURABLE");

  const documentos = await tx.documentos.delTicket(empresaId, ticket.id);
  const vigente = documentos.find((d) => d.vigente);
  if (vigente !== undefined) {
    const vigencia = await facturador.vigenciaEnTx(tx, contexto, [vigente.comprobanteId]);
    if (!vigencia.ok) return err({ error: "FACTURACION_FALLIDA", causa: vigencia.error });
    const estado = vigencia.valor.find((v) => v.comprobanteId === vigente.comprobanteId);
    // El puntero es una clave foránea hacia fiscal: un comprobante que fiscal no reconoce es una inconsistencia grave, no un caso de negocio.
    if (estado === undefined) {
      throw new Error(
        `el comprobante ${vigente.comprobanteId} del ticket ${ticket.id} no figura en fiscal`,
      );
    }
    if (estado.vigente) {
      return err({ error: "TICKET_YA_FACTURADO", comprobanteId: vigente.comprobanteId });
    }
    if (!(await tx.documentos.marcarNoVigente(empresaId, vigente.id, contexto.ahora))) {
      return err("INVARIANTE_DE_VENTAS");
    }
  }

  const intento = documentos.reduce((mayor, d) => Math.max(mayor, d.intento), 0) + 1;
  const datos = await tx.lecturasDeVentas.ticketParaFacturar(empresaId, ticket.id);
  if (datos === null) return err("TICKET_NO_ENCONTRADO");
  const origen = origenDeLaFactura(ticket.id, intento, datos.ejemplarVigenteId);
  const comprobanteId = comprobanteIdDeLaFactura(ticket.id, intento);
  const salida = await facturador.emitirEnTx(tx, contexto, {
    origen,
    comprobanteId,
    puntoDeVentaId: entrada.puntoDeVentaId,
    sucursalId: ticket.sucursalId,
    receptor: entrada.receptor,
    renglones: datos.renglones.map((r) => ({
      descripcion: descripcionDelRenglon(r),
      cantidad: r.cantidad,
      unidad: unidadDelRenglon(r),
      precioUnitario: r.precioUnitario,
      alicuota: r.alicuota,
    })),
    totalEsperado: datos.total,
  });
  if (!salida.ok) return err({ error: "FACTURACION_FALLIDA", causa: salida.error });

  const documentoId = documentoIdDeLaFactura(ticket.id, intento);
  await tx.documentos.insertar(empresaId, {
    id: documentoId,
    ticketId: ticket.id,
    ejemplarId: datos.ejemplarVigenteId,
    intento,
    clave: entrada.clave,
    comprobanteId: salida.valor.comprobanteId,
    creadoPor: persona.valor,
    creadoEn: contexto.ahora,
  });
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona.valor,
    accion: "DOCUMENTO_DE_TICKET_CREADO",
    entidad: "documento_de_ticket",
    entidadId: documentoId,
    despues: {
      ticketId: ticket.id,
      ejemplarId: datos.ejemplarVigenteId,
      intento,
      comprobanteId: salida.valor.comprobanteId,
      origen: origen.tipo,
    },
  });
  return ok({
    ticketId: ticket.id,
    comprobanteId: salida.valor.comprobanteId,
    estado: salida.valor.estado,
    yaExistia: salida.valor.yaExistia,
  });
}

export function armarEmitirComprobanteDeTicket(dependencias: DependenciasDeVentas) {
  return async function emitirComprobanteDeTicket(
    contexto: ContextoOperativo,
    entrada: EntradaDeEmitirComprobanteDeTicket,
  ): Promise<R<SalidaDeEmitirComprobanteDeTicket>> {
    const resultado = await dependencias.transacciones.ejecutar({ contexto }, (tx) =>
      emitir(tx, dependencias, contexto, entrada),
    );
    return traducir(resultado);
  };
}
