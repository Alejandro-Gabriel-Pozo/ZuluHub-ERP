import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { decidirAnularTicket } from "../dominio/decisiones";
import { huellaDeAnulacion } from "../dominio/huella-de-anulacion";
import { ejemplarId, ticketId, type EjemplarId, type TicketId } from "../dominio/identificadores";
import { motivoDeAnulacion } from "../dominio/motivo";
import { numeroDeCorreccion } from "../dominio/rotulo";
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
 * pierde con `EJEMPLAR_DESACTUALIZADO` o `TICKET_ANULADO`. NO toca caja ni fiscal: el cobro no se anula y lo cobrado queda como diferencia a
 * explicar en el cierre del día. Audita `TICKET_ANULADO`.
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

  const ticket = await tx.tickets.obtener(empresaId, ticketId(entrada.ticketId));
  if (ticket === null) return err("TICKET_NO_ENCONTRADO");
  const alcance = await exigirAlcance(tx, contexto, ticket.sucursalId);
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
      ticketId: ticket.id,
      numero: ticket.numero,
      estado: "ANULADO",
      ejemplarNuevoId: previa.ejemplarNuevoId,
      numeroDeCorreccion: numeroDeCorreccion(ticket.ejemplarVigente),
      yaExistia: true,
    });
  }

  // La jornada de hoy: tomada con `FOR SHARE`, así `cerrarJornada` a la vez espera o esta operación recibe `JORNADA_CERRADA`.
  const fecha = await jornadaPorReloj(tx, contexto, ticket.sucursalId);
  if (!fecha.ok) return fecha;
  const jornada = await tx.jornadas.asegurarYBloquearCompartida({
    empresa: empresaId,
    sucursal: ticket.sucursalId,
    fecha: fecha.valor,
  });
  if (jornada.estado === "CERRADA") return err("JORNADA_CERRADA");

  const vigente = await tx.tickets.ejemplarDeNumero(empresaId, ticket.id, ticket.ejemplarVigente);
  if (vigente === null) throw new Error("el ticket no tiene su ejemplar vigente");
  const decision = decidirAnularTicket({
    estadoDelTicket: ticket.estado,
    ejemplarVigenteId: vigente.id,
    ejemplarBaseId: entrada.ejemplarBaseId,
  });
  if (!decision.ok) return decision;

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
    return traducir(resultado);
  };
}
