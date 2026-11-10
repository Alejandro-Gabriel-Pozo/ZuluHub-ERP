import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  importeAJson,
  importeATexto,
  importeDesdeTexto,
  type ImporteJson,
} from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { cajaParaVentas, traducirErroresDelCobro } from "../../caja/publico";
import {
  cuadrarCobros,
  decidirCobrar,
  huellaDeCobranza,
  normalizarCobros,
  type CobroPedido,
} from "../dominio/cobranza";
import { idDerivado } from "../dominio/id-derivado";
import { ticketId, type EjemplarId, type TicketId } from "../dominio/identificadores";
import type { CobranzaGuardada } from "../persistencia/repositorio-de-cobranzas";
import { exigirAlcance, exigirClave, exigirUuid, prepararComando, traducir } from "./comun";
import type { DependenciasDeVentas, TxDeVentas } from "./contrato";
import type { ErrorDeVentas } from "./errores";

type R<S> = Resultado<S, ErrorDeVentas>;

/** Qué documento de ventas origina cada cobro de caja (`origen_tipo`): la identidad del cobro es `(empresa, tipo, cobranzaId, orden)`. */
export const ORIGEN_DEL_COBRO_DE_TICKET = "ventas.cobranza_de_ticket";

export type EntradaDeCobrar = Readonly<{
  /** `^[A-Za-z0-9_-]{16,128}$`, la genera la pantalla por intento de cobro (idempotencia). */
  claveIdempotencia: string;
  ticketId: string;
  /** El ejemplar vigente que vio el cajero. */
  ejemplarId: string;
  /** Una caja de la sucursal del ticket, con sesión abierta (de `estadoDeCajasParaCobrar`). */
  cajaId: string;
  /** Importes de la frontera (`{ moneda: "ARS", monto: "1234.56" }`); su suma es el total del ticket al centavo. */
  cobros: readonly CobroPedido[];
}>;

export type CobroHecho = Readonly<{
  orden: number;
  cobroId: string;
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  importe: ImporteJson;
}>;

export type SalidaDeCobrar = Readonly<{
  ticketId: TicketId;
  ejemplarId: EjemplarId;
  cobranzaId: string;
  total: ImporteJson;
  cobros: readonly CobroHecho[];
  /** La sesión de caja donde cayó el cobro y su jornada. */
  sesionDeCajaId: string;
  fechaDeCobro: FechaCivil;
  jornadaVencida: boolean;
  yaExistia: boolean;
}>;

/** Lo que `venderYCobrar` verifica: que el cobro caiga en la misma sesión de la que el ticket tomó su fecha. */
export type OpcionesDeCobrar = Readonly<{ sesionDeCajaEsperada?: string | undefined }>;

/** La salida que quedó guardada en la cobranza (la escribió esta misma función; se valida la forma por si la base no la tiene). */
function salidaGuardada(cobranza: CobranzaGuardada): SalidaDeCobrar {
  const r = cobranza.resultado;
  if (r === null || typeof r.cobranzaId !== "string" || !Array.isArray(r.cobros)) {
    throw new Error("la cobranza guardada no tiene su resultado");
  }
  return { ...(r as unknown as Omit<SalidaDeCobrar, "yaExistia">), yaExistia: true };
}

/**
 * `cobrarEnTx` (E4 §3.6): salda un ticket `EMITIDO` con uno o más cobros de caja, DENTRO de la transacción serializable del llamador (`cobrar` o
 * `venderYCobrar`); el permiso (`tickets.cobrar`) lo exige quien llama. Orden: ids y clave válidos, cobros normalizados (orden canónico), ticket de
 * la empresa (otra empresa es inexistente) en el alcance de quien pide; IDEMPOTENCIA por clave ANTES de mirar el estado: misma huella devuelve lo
 * hecho (`yaExistia`, sin escribir ni auditar, aunque la caja o la jornada se hayan cerrado después), otra huella es `CLAVE_REUTILIZADA`; el estado
 * del ticket (`TICKET_YA_COBRADO { cobranzaId }`, `TICKET_ANULADO`, `TICKET_NO_COBRABLE`, `EJEMPLAR_DESACTUALIZADO`); la suma de los cobros es el total
 * del ejemplar vigente al centavo (`COBRO_NO_CUADRA`); entonces escribe la cobranza (id derivado de la clave: sin azar), pasa el ticket a `COBRADO`,
 * registra cada cobro en caja (`registrarCobroEnTx`, con `origenOrden` 1..n; caja valida la sesión abierta y la jornada abierta de la sesión, sin
 * escribir nada si no), las aplicaciones y el resultado, y audita `TICKET_COBRADO`. Cualquier error devuelto revierte TODO: no queda cobranza, ni
 * cobro, ni ticket cobrado a medias. Una cobranza por ticket y una clave por empresa (únicas en la base): dos cobros a la vez del mismo ticket, uno
 * gana y el otro ve `TICKET_YA_COBRADO` (o la misma salida, si usó la misma clave).
 */
export async function cobrarTicketEnTx(
  tx: TxDeVentas,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeCobrar,
  opciones: OpcionesDeCobrar = {},
): Promise<R<SalidaDeCobrar>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.ticketId, entrada.ejemplarId, entrada.cajaId);
  if (!ids.ok) return ids;
  const clave = exigirClave(entrada.claveIdempotencia);
  if (!clave.ok) return clave;
  const cobros = normalizarCobros(entrada.cobros);
  if (!cobros.ok) return cobros;

  const ticket = await tx.tickets.obtener(empresaId, ticketId(entrada.ticketId));
  if (ticket === null) return err("TICKET_NO_ENCONTRADO");
  const alcance = await exigirAlcance(tx, contexto, ticket.sucursalId);
  if (!alcance.ok) return alcance;

  const huella = huellaDeCobranza({
    ticketId: ticket.id,
    ejemplarId: entrada.ejemplarId,
    cajaId: entrada.cajaId,
    cobros: cobros.valor,
  });
  /** Lo que devuelve una cobranza que ya existe con esta clave. */
  const yaHecha = (previa: CobranzaGuardada): R<SalidaDeCobrar> =>
    previa.huella === huella ? ok(salidaGuardada(previa)) : err("CLAVE_REUTILIZADA");
  const previa = await tx.tickets.cobranzaPorClave(empresaId, entrada.claveIdempotencia);
  if (previa !== null) return yaHecha(previa);

  const vigente = await tx.tickets.ejemplarDeNumero(empresaId, ticket.id, ticket.ejemplarVigente);
  if (vigente === null) throw new Error("el ticket no tiene su ejemplar vigente");
  /** `TICKET_YA_COBRADO` lleva la cobranza que lo cobró: la pantalla muestra lo hecho. */
  const yaCobrado = async (): Promise<R<never>> => {
    const cobranza = await tx.tickets.cobranzaDeTicket(empresaId, ticket.id);
    if (cobranza === null) throw new Error("el ticket está cobrado pero no tiene su cobranza");
    return err({ error: "TICKET_YA_COBRADO", cobranzaId: cobranza.id });
  };
  const decision = decidirCobrar({
    estadoDelTicket: ticket.estado,
    ejemplarVigenteId: vigente.id,
    ejemplarId: entrada.ejemplarId,
  });
  if (!decision.ok) return decision.error === "TICKET_YA_COBRADO" ? yaCobrado() : decision;
  const total = importeDesdeTexto(ARS, vigente.total);
  const cuadra = cuadrarCobros(total, cobros.valor);
  if (!cuadra.ok) return cuadra;

  const cobranzaId = idDerivado("ventas.cobranza", empresaId, entrada.claveIdempotencia);
  const insertada = await tx.tickets.insertarCobranza(empresaId, {
    id: cobranzaId,
    ticketId: ticket.id,
    ejemplarId: vigente.id,
    cajaId: entrada.cajaId,
    clave: entrada.claveIdempotencia,
    huella,
    creadaPor: persona,
    creadaEn: contexto.ahora,
  });
  if (!insertada) {
    // Otra cobranza se adelantó: o es la de esta clave (repetición) o es la del ticket (otro cobro lo saldó).
    const ganadora = await tx.tickets.cobranzaPorClave(empresaId, entrada.claveIdempotencia);
    if (ganadora !== null) return yaHecha(ganadora);
    return yaCobrado();
  }
  const marcado = await tx.tickets.marcarCobrado(empresaId, ticket.id, ticket.ejemplarVigente);
  // Imposible tras leerlo EMITIDO y haber insertado su cobranza en esta transacción: un cambio concurrente aborta por serialización.
  if (!marcado) throw new Error("invariante rota: el ticket EMITIDO no pasó a COBRADO");

  const hechos: CobroHecho[] = [];
  let sesion: Readonly<{ id: string; fecha: FechaCivil; vencida: boolean }> | null = null;
  for (const [i, cobro] of cobros.valor.entries()) {
    const orden = i + 1;
    const r = await cajaParaVentas.registrarCobroEnTx(tx, contexto, {
      origen: { tipo: ORIGEN_DEL_COBRO_DE_TICKET, id: cobranzaId },
      origenOrden: orden,
      cajaId: entrada.cajaId,
      sucursalId: ticket.sucursalId,
      medioDePagoId: cobro.medioDePagoId,
      cuentaDeCobroId: cobro.cuentaDeCobroId,
      importe: cobro.importe,
      datos: {},
    });
    if (!r.ok) return r;
    // La cobranza es nueva: un cobro con su origen que ya existía no puede ser de otra.
    if (r.valor.yaExistia)
      throw new Error("invariante rota: el cobro de una cobranza nueva ya existía");
    const esperada = sesion === null ? opciones.sesionDeCajaEsperada : sesion.id;
    if (esperada !== undefined && r.valor.sesionId !== esperada)
      return err("SESION_DE_CAJA_CAMBIO");
    sesion ??= {
      id: r.valor.sesionId,
      fecha: r.valor.fechaDeNegocio,
      vencida: r.valor.jornadaVencida,
    };
    hechos.push({
      orden,
      cobroId: r.valor.cobroId,
      medioDePagoId: cobro.medioDePagoId,
      cuentaDeCobroId: cobro.cuentaDeCobroId,
      importe: importeAJson(cobro.importe),
    });
  }
  // `normalizarCobros` exige al menos un cobro: sin cobro no hay sesión (defecto, no negocio).
  if (sesion === null) throw new Error("invariante rota: cobranza sin cobros");
  await tx.tickets.insertarAplicaciones(
    empresaId,
    cobranzaId,
    hechos.map((h) => ({
      orden: h.orden,
      cobroId: h.cobroId,
      cuentaDeCobroId: h.cuentaDeCobroId,
      importe: h.importe.monto,
    })),
  );
  const salida: Omit<SalidaDeCobrar, "yaExistia"> = {
    ticketId: ticket.id,
    ejemplarId: vigente.id,
    cobranzaId,
    total: importeAJson(total),
    cobros: hechos,
    sesionDeCajaId: sesion.id,
    fechaDeCobro: sesion.fecha,
    jornadaVencida: sesion.vencida,
  };
  await tx.tickets.fijarResultadoDeCobranza(empresaId, cobranzaId, salida);
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "TICKET_COBRADO",
    entidad: "ticket",
    entidadId: ticket.id,
    antes: { estado: "EMITIDO" },
    despues: {
      estado: "COBRADO",
      numero: ticket.numero,
      ejemplarId: vigente.id,
      cobranzaId,
      total: importeATexto(total),
      sesionDeCajaId: sesion.id,
      cobros: hechos.map((h) => ({
        orden: h.orden,
        cobroId: h.cobroId,
        importe: h.importe.monto,
      })),
    },
  });
  return ok({ ...salida, yaExistia: false });
}

async function cobrar(
  tx: TxDeVentas,
  dependencias: DependenciasDeVentas,
  contexto: ContextoOperativo,
  entrada: EntradaDeCobrar,
): Promise<R<SalidaDeCobrar>> {
  const persona = await prepararComando(tx, contexto, dependencias.reglas, ["tickets.cobrar"]);
  if (!persona.ok) return persona;
  return cobrarTicketEnTx(tx, contexto, persona.valor, entrada);
}

/** Los reintentos ante un conflicto de serialización: el cobro choca con otros cobros, ventas y cierres de caja a la vez (el repetido es seguro: ver arriba). */
export const REINTENTOS_AL_COBRAR = 20;

export function armarCobrar(dependencias: DependenciasDeVentas) {
  return async function cobrarTicket(
    contexto: ContextoOperativo,
    entrada: EntradaDeCobrar,
  ): Promise<R<SalidaDeCobrar>> {
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto, reintentos: REINTENTOS_AL_COBRAR },
      (tx) => cobrar(tx, dependencias, contexto, entrada),
    );
    // Un error de la base en la transacción (caja) sale con su código de negocio; el resto, como el módulo lo traduce.
    return traducir(traducirErroresDelCobro(resultado));
  };
}
