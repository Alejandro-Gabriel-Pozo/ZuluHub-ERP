import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { decidirAnularTicket } from "../dominio/decisiones";
import { huellaDeAnulacion } from "../dominio/huella-de-anulacion";
import { ejemplarId, ticketId, type EjemplarId, type TicketId } from "../dominio/identificadores";
import { motivoDeAnulacion } from "../dominio/motivo";
import { numeroDeCorreccion } from "../dominio/rotulo";
import { detalleDeLaDevolucionDeStock } from "../dominio/stock-de-la-venta";
import { consultarComprobanteDelTicket } from "./comprobante-vigente-del-ticket";
import {
  exigirAlcance,
  exigirClave,
  exigirUuid,
  jornadaPorReloj,
  prepararComando,
  traducir,
} from "./comun";
import type { DependenciasDeVentas, TxDeVentas } from "./contrato";
import type { ErrorDeVentas } from "./errores";

type R<S> = Resultado<S, ErrorDeVentas>;

export type EntradaDeAnularTicket = Readonly<{
  /** `^[A-Za-z0-9_-]{16,128}$`, la genera la pantalla por intento (idempotencia). */
  claveIdempotencia: string;
  ticketId: string;
  /** El ejemplar vigente que vio quien anula. */
  ejemplarBaseId: string;
  /** El id del ejemplar de anulación; lo manda la pantalla, como todo id de ventas (idempotencia). */
  ejemplarNuevoId: string;
  motivo: string;
}>;

export type SalidaDeAnularTicket = Readonly<{
  ticketId: TicketId;
  numero: number;
  estado: "ANULADO";
  ejemplarNuevoId: EjemplarId;
  numeroDeCorreccion: number;
  yaExistia: boolean;
}>;

/**
 * `anularTicket` (decisión 172: «anular todo» con motivo; E4 §3.8). Un ticket cerrado nunca se edita ni se borra: se anula agregando un
 * ejemplar de anulación (inmutable, total 0) y un registro (`ticket_correccion`) con quién, cuándo, por qué y la jornada en que se hace. Una
 * transacción serializable: guard (`tickets.corregir`), la empresa opera, el motivo es obligatorio, el ticket es de la empresa (otra empresa
 * es inexistente), la sucursal está en el alcance; la clave de idempotencia con la misma huella devuelve lo hecho y con otra, `CLAVE_REUTILIZADA`.
 * La jornada de HOY (por reloj) tiene que estar abierta o en auditoría (lo hace quien audita, decisión 170): cerrada es `JORNADA_CERRADA`.
 * `UPDATE ticket … WHERE ejemplar_vigente = <visto> AND estado <> 'ANULADO'` es el árbitro contra otra anulación, una corrección y un cobro:
 * pierde con `EJEMPLAR_DESACTUALIZADO` o `TICKET_ANULADO`. La fila del ticket se toma `FOR UPDATE` (se turna con facturar) y se le pregunta a
 * fiscal (`consultarComprobanteDelTicket`, la misma pregunta que emitir): con comprobante vigente, también «Confirmando», es
 * `TICKET_CON_COMPROBANTE_VIGENTE` (se acredita con nota de crédito y después se anula). NO escribe en caja ni fiscal: el cobro no se anula y lo
 * cobrado queda como diferencia a explicar en el cierre del día. Con stock cableado, devuelve en la MISMA transacción la salida de stock del ejemplar original (`revertirSalidaEnTx`:
 * una sola vez, sin exigir el módulo activo; sin salida previa no hace nada); un error de stock revierte la anulación entera. Audita `TICKET_ANULADO`.
 */
async function anular(
  tx: TxDeVentas,
  dependencias: DependenciasDeVentas,
  contexto: ContextoOperativo,
  entrada: EntradaDeAnularTicket,
): Promise<R<SalidaDeAnularTicket>> {
  const { empresaId } = contexto;
  const persona = await prepararComando(tx, contexto, dependencias.reglas, ["tickets.corregir"]);
  if (!persona.ok) return persona;
  const clave = exigirClave(entrada.claveIdempotencia);
  if (!clave.ok) return clave;
  const ids = exigirUuid(entrada.ticketId, entrada.ejemplarBaseId, entrada.ejemplarNuevoId);
  if (!ids.ok) return ids;
  const motivo = motivoDeAnulacion(entrada.motivo);
  if (!motivo.ok) return motivo;

  const inicial = await tx.tickets.obtener(empresaId, ticketId(entrada.ticketId));
  if (inicial === null) return err("TICKET_NO_ENCONTRADO");
  const alcance = await exigirAlcance(tx, contexto, inicial.sucursalId);
  if (!alcance.ok) return alcance;

  // Idempotencia por clave: la misma huella devuelve lo hecho (aunque la jornada se haya cerrado después); otra huella es otra cosa.
  const huella = huellaDeAnulacion({
    ticketId: entrada.ticketId,
    ejemplarBaseId: entrada.ejemplarBaseId,
    ejemplarNuevoId: entrada.ejemplarNuevoId,
    motivo: motivo.valor,
  });
  const previa = await tx.tickets.correccionPorClave(empresaId, entrada.claveIdempotencia);
  if (previa !== null) {
    if (previa.huella !== huella) return err("CLAVE_REUTILIZADA");
    return ok({
      ticketId: inicial.id,
      numero: inicial.numero,
      estado: "ANULADO",
      ejemplarNuevoId: previa.ejemplarNuevoId,
      numeroDeCorreccion: numeroDeCorreccion(inicial.ejemplarVigente),
      yaExistia: true,
    });
  }

  // La jornada de hoy: tomada con `FOR SHARE`, así `cerrarJornada` a la vez espera o esta operación recibe `JORNADA_CERRADA`.
  const fecha = await jornadaPorReloj(tx, contexto, inicial.sucursalId);
  if (!fecha.ok) return fecha;
  const jornada = await tx.jornadas.asegurarYBloquearCompartida({
    empresa: empresaId,
    sucursal: inicial.sucursalId,
    fecha: fecha.valor,
  });
  if (jornada.estado === "CERRADA") return err("JORNADA_CERRADA");

  // La fila del ticket `FOR UPDATE` (como `emitirComprobanteDeTicket`, después de la jornada para no cruzar el orden con el cierre): anular y
  // facturar el mismo ticket se turnan. Con la fila tomada se vuelve a leer: lo que sigue es lo que vale mientras dure la transacción.
  if (!(await tx.documentos.bloquearTicket(empresaId, inicial.id))) {
    return err("TICKET_NO_ENCONTRADO");
  }
  const ticket = await tx.tickets.obtener(empresaId, inicial.id);
  if (ticket === null) return err("TICKET_NO_ENCONTRADO");

  const vigente = await tx.tickets.ejemplarDeNumero(empresaId, ticket.id, ticket.ejemplarVigente);
  if (vigente === null) throw new Error("el ticket no tiene su ejemplar vigente");
  const decision = decidirAnularTicket({
    estadoDelTicket: ticket.estado,
    ejemplarVigenteId: vigente.id,
    ejemplarBaseId: entrada.ejemplarBaseId,
  });
  if (!decision.ok) return decision;

  // Un ticket con comprobante vigente (también «Confirmando») no se anula: primero se acredita con una nota de crédito. Fiscal decide, no el puntero.
  const comprobante = await consultarComprobanteDelTicket(tx, dependencias, contexto, ticket.id);
  if (!comprobante.ok) return comprobante;
  if (comprobante.valor.vigente !== null) {
    return err({
      error: "TICKET_CON_COMPROBANTE_VIGENTE",
      comprobanteId: comprobante.valor.vigente.comprobanteId,
    });
  }

  const anulado = await tx.tickets.anular(empresaId, ticket.id, ticket.ejemplarVigente);
  if (!anulado) {
    // 0 filas: otro cambió el ticket entre la lectura y la escritura. Se relee y se dice por qué (la serializable ya repite ante un conflicto).
    const actual = await tx.tickets.obtener(empresaId, ticket.id);
    return err(
      actual !== null && actual.estado === "ANULADO" ? "TICKET_ANULADO" : "EJEMPLAR_DESACTUALIZADO",
    );
  }
  const nuevo = ejemplarId(entrada.ejemplarNuevoId);
  await tx.tickets.insertarEjemplar(empresaId, {
    id: nuevo,
    ticketId: ticket.id,
    numeroDeEjemplar: ticket.ejemplarVigente + 1,
    tipo: "ANULACION",
    total: "0.00",
    ejemplarBaseId: vigente.id,
    creadoPor: persona.valor,
    creadoEn: contexto.ahora,
    renglones: [],
  });
  await tx.tickets.insertarCorreccion(empresaId, {
    id: entrada.ejemplarNuevoId,
    ticketId: ticket.id,
    ejemplarBaseId: vigente.id,
    ejemplarNuevoId: nuevo,
    tipo: "ANULACION",
    motivo: motivo.valor,
    clave: entrada.claveIdempotencia,
    huella,
    resultado: { ticketId: ticket.id, ejemplarNuevoId: nuevo },
    hechaPor: persona.valor,
    hechaEn: contexto.ahora,
  });
  if (dependencias.stock !== undefined) {
    const original = await tx.tickets.ejemplarDeNumero(empresaId, ticket.id, 1);
    if (original === null) throw new Error("el ticket no tiene su ejemplar original");
    const devuelto = await dependencias.stock.revertirSalidaEnTx(tx, contexto, {
      origen: { tipo: "EJEMPLAR_DE_TICKET", id: original.id },
      accion: "tickets.corregir",
      detalle: detalleDeLaDevolucionDeStock(ticket.numero),
    });
    if (!devuelto.ok) return err({ error: "STOCK_FALLIDO", causa: devuelto.error });
  }
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona.valor,
    accion: "TICKET_ANULADO",
    entidad: "ticket",
    entidadId: ticket.id,
    antes: { estado: ticket.estado, ejemplarVigente: ticket.ejemplarVigente, total: ticket.total },
    despues: {
      estado: "ANULADO",
      ejemplarVigente: ticket.ejemplarVigente + 1,
      numero: ticket.numero,
      motivo: motivo.valor,
      ejemplarNuevoId: nuevo,
    },
  });
  return ok({
    ticketId: ticket.id,
    numero: ticket.numero,
    estado: "ANULADO",
    ejemplarNuevoId: nuevo,
    numeroDeCorreccion: numeroDeCorreccion(ticket.ejemplarVigente + 1),
    yaExistia: false,
  });
}

export function armarAnularTicket(dependencias: DependenciasDeVentas) {
  return async function anularTicket(
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularTicket,
  ): Promise<R<SalidaDeAnularTicket>> {
    const resultado = await dependencias.transacciones.ejecutar({ contexto }, (tx) =>
      anular(tx, dependencias, contexto, entrada),
    );
    return traducir(resultado, dependencias.stock);
  };
}
