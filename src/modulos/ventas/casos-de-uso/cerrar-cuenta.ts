import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import { cantidadATexto, cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { precioUnitarioDesdeTexto } from "../../../primitivas/dinero/precio-unitario";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { confirmacionesDesdeTexto, decidirCierre } from "../dominio/decisiones";
import { cuentaId, ejemplarId, type EjemplarId, type TicketId } from "../dominio/identificadores";
import { numeroDeCorreccion } from "../dominio/rotulo";
import type { EstadoDeTicket } from "../dominio/estados";
import type { Ticket } from "../persistencia/repositorio-de-tickets";
import { calcularLasLineas } from "./calculo";
import {
  exigirAlcance,
  exigirJornadaAbierta,
  type OpcionesDeLaVenta,
  exigirUuid,
  prepararComando,
  traducir,
} from "./comun";
import type { DependenciasDeVentas, TxDeVentas } from "./contrato";
import type { ErrorDeVentas } from "./errores";

type R<S> = Resultado<S, ErrorDeVentas>;

export type EntradaDeCerrarCuenta = Readonly<{
  cuentaId: string;
  /** Lo manda la pantalla: es el id del ejemplar ORIGINAL del ticket (idempotencia). */
  ejemplarId: string;
  confirmaciones?: readonly string[] | undefined;
}>;

export type SalidaDeCerrarCuenta = Readonly<{
  ticketId: TicketId;
  ejemplarId: EjemplarId;
  numero: number;
  numeroDeCorreccion: number;
  estado: EstadoDeTicket;
  fechaNegocio: FechaCivil;
  total: ImporteJson;
  yaEstabaCerrada: boolean;
}>;

/** La salida de un ticket que ya existía (repetición): el original, con el rótulo y el estado de hoy. */
async function salidaDelTicketExistente(
  tx: TxDeVentas,
  empresa: Parameters<TxDeVentas["tickets"]["ejemplarDeNumero"]>[0],
  ticket: Ticket,
): Promise<SalidaDeCerrarCuenta> {
  const original = await tx.tickets.ejemplarDeNumero(empresa, ticket.id, 1);
  if (original === null) throw new Error("el ticket cerrado no tiene su ejemplar original");
  return {
    ticketId: ticket.id,
    ejemplarId: original.id,
    numero: ticket.numero,
    numeroDeCorreccion: numeroDeCorreccion(ticket.ejemplarVigente),
    estado: ticket.estado,
    fechaNegocio: ticket.fechaNegocio,
    total: { moneda: "ARS", monto: ticket.total },
    yaEstabaCerrada: true,
  };
}

/**
 * `cerrarCuenta` (E4 §3.4 y §3.5): cierra la cuenta y emite el ticket interno SIN cobro (queda `EMITIDO`; en el mostrador, cerrar y cobrar
 * es un solo acto de la fase B). Orden: guard (`cuentas.cerrar`), la empresa opera, la cuenta existe, la sucursal está en el alcance, la
 * jornada está abierta; entonces la decisión pura (`decidirCierre`) y, en la MISMA transacción: `UPDATE cuenta … WHERE estado = 'ABIERTA'`
 * (0 filas → otro la cerró: se devuelve su ticket), el número de la sucursal (`numerador_ticket`, sin huecos: si algo falla después se
 * revierte y el número no se consume), el ticket (la base fija la fecha de negocio por reloj) y su ejemplar original con el total
 * redondeado UNA vez y repartido por restos mayores. Total 0 exige `VENTA_A_CERO` y el ticket nace `CORTESIA`. Repetir devuelve el
 * mismo ticket. Audita `CUENTA_CERRADA` y `TICKET_EMITIDO` (y `CORTESIA_REGISTRADA` si hay una línea o un total a $0).
 */
export async function cerrarCuentaEnTx(
  tx: TxDeVentas,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeCerrarCuenta,
  opciones: OpcionesDeLaVenta = {},
): Promise<R<SalidaDeCerrarCuenta>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.cuentaId, entrada.ejemplarId);
  if (!ids.ok) return ids;

  const cuenta = await tx.cuentas.obtener(empresaId, cuentaId(entrada.cuentaId));
  if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, cuenta.sucursalId);
  if (!alcance.ok) return alcance;
  const jornada = await exigirJornadaAbierta(tx, contexto, cuenta.sucursalId, opciones.jornada);
  if (!jornada.ok) return jornada;
  const confirmaciones = confirmacionesDesdeTexto(entrada.confirmaciones);
  if (!confirmaciones.ok) return confirmaciones;

  const lineas = await tx.cuentas.lineasDeCuenta(empresaId, cuenta.id);
  const calculado = calcularLasLineas(lineas);
  const vigentes = lineas.filter((l) => l.estado === "VIGENTE");
  const decision = decidirCierre({
    estadoDeLaCuenta: cuenta.estado,
    total: calculado.total,
    preciosDeLasLineasVigentes: vigentes.map((l) => precioUnitarioDesdeTexto(l.precioUnitario)),
    confirmaciones: confirmaciones.valor,
  });
  if (!decision.ok) return decision;

  const yaEmitido = async (): Promise<R<SalidaDeCerrarCuenta>> => {
    const ticket = await tx.tickets.obtenerPorCuenta(empresaId, cuenta.id);
    if (ticket === null) {
      // Sin ticket: otro la anuló un instante antes (la cerrada siempre tiene el suyo).
      const actual = await tx.cuentas.obtener(empresaId, cuenta.id);
      if (actual !== null && actual.estado === "ANULADA") return err("CUENTA_ANULADA");
      throw new Error("la cuenta está cerrada pero no tiene ticket");
    }
    return ok(await salidaDelTicketExistente(tx, empresaId, ticket));
  };
  if (decision.valor.tipo === "YA_CERRADA") return yaEmitido();
  const { estadoDelTicket, cortesia } = decision.valor;

  const cerrada = await tx.cuentas.cerrar(empresaId, cuenta.id, persona, contexto.ahora);
  if (!cerrada) return yaEmitido();
  const numero = await tx.tickets.siguienteNumero(empresaId, cuenta.sucursalId);
  const total = importeAJson(calculado.total).monto;
  const ticket = await tx.tickets.insertar(empresaId, {
    sucursalId: cuenta.sucursalId,
    cuentaId: cuenta.id,
    numero,
    estado: estadoDelTicket,
    total,
    emitidoPor: persona,
    emitidoEn: contexto.ahora,
    sesionDeCajaId: opciones.sesionDeCajaId,
  });
  const original = ejemplarId(entrada.ejemplarId);
  await tx.tickets.insertarEjemplar(empresaId, {
    id: original,
    ticketId: ticket.id,
    numeroDeEjemplar: 1,
    tipo: "ORIGINAL",
    total,
    ejemplarBaseId: null,
    creadoPor: persona,
    creadoEn: contexto.ahora,
    renglones: calculado.renglones.map((r) => {
      const linea = vigentes.find((l) => l.id === r.id);
      if (linea === undefined) throw new Error("un renglón no corresponde a una línea vigente");
      return {
        lineaCuentaId: linea.id,
        cantidad: cantidadATexto(cantidadDesdeTexto(linea.cantidad)),
        importe: importeAJson(r.importe).monto,
      };
    }),
  });
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "CUENTA_CERRADA",
    entidad: "cuenta_consumo",
    entidadId: cuenta.id,
    antes: { estado: "ABIERTA" },
    despues: { estado: "CERRADA", total, ticketId: ticket.id },
  });
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "TICKET_EMITIDO",
    entidad: "ticket",
    entidadId: ticket.id,
    despues: {
      cuentaId: cuenta.id,
      sucursalId: cuenta.sucursalId,
      numero,
      fechaNegocio: ticket.fechaNegocio,
      estado: estadoDelTicket,
      total,
      ejemplarId: original,
    },
  });
  if (cortesia !== null) {
    await tx.auditoria.registrar({
      empresaId,
      actorPersonaId: persona,
      accion: "CORTESIA_REGISTRADA",
      entidad: "ticket",
      entidadId: ticket.id,
      despues: {
        tipo: cortesia,
        numero,
        lineas: vigentes
          .filter((l) => precioUnitarioDesdeTexto(l.precioUnitario).unidades === 0n)
          .map((l) => l.id),
      },
    });
  }
  return ok({
    ticketId: ticket.id,
    ejemplarId: original,
    numero,
    numeroDeCorreccion: 0,
    estado: estadoDelTicket,
    fechaNegocio: ticket.fechaNegocio,
    total: { moneda: "ARS", monto: total },
    yaEstabaCerrada: false,
  });
}

async function cerrar(
  tx: TxDeVentas,
  dependencias: DependenciasDeVentas,
  contexto: ContextoOperativo,
  entrada: EntradaDeCerrarCuenta,
): Promise<R<SalidaDeCerrarCuenta>> {
  const persona = await prepararComando(tx, contexto, dependencias.reglas, ["cuentas.cerrar"]);
  if (!persona.ok) return persona;
  return cerrarCuentaEnTx(tx, contexto, persona.valor, entrada);
}

export function armarCerrarCuenta(dependencias: DependenciasDeVentas) {
  return async function cerrarCuenta(
    contexto: ContextoOperativo,
    entrada: EntradaDeCerrarCuenta,
  ): Promise<R<SalidaDeCerrarCuenta>> {
    const resultado = await dependencias.transacciones.ejecutar({ contexto }, (tx) =>
      cerrar(tx, dependencias, contexto, entrada),
    );
    return traducir(resultado);
  };
}
