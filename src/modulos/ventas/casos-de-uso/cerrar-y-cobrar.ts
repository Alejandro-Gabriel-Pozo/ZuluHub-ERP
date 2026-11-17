import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import {
  importeCero,
  importeAJson,
  importeDesdeTexto,
  type ImporteJson,
} from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { cajaParaVentas } from "../../caja/publico";
import { cuadrarCobros, normalizarCobros } from "../dominio/cobranza";
import { FORMA_DEL_IMPORTE } from "../dominio/forma-del-importe";
import { cuentaId, type EjemplarId, type TicketId } from "../dominio/identificadores";
import type { EstadoDeTicket } from "../dominio/estados";
import type { Ticket } from "../persistencia/repositorio-de-tickets";
import { calcularLasLineas } from "./calculo";
import { cerrarCuentaEnTx } from "./cerrar-cuenta";
import { cobrarTicketEnTx, type CobroHecho, type EntradaDeCobrar } from "./cobrar";
import {
  exigirAlcance,
  exigirClave,
  exigirJornadaAbierta,
  exigirUuid,
  type OpcionesDeLaVenta,
} from "./comun";
import type { TxDeVentas } from "./contrato";
import type { ErrorDeVentas } from "./errores";

type R<S> = Resultado<S, ErrorDeVentas>;

/** Lo que devuelven `venderYCobrar` y `cerrarYCobrarEnTx`: la venta ya hecha (ticket, cobros y la jornada de la sesión de caja). */
export type SalidaDeVenderYCobrar = Readonly<{
  ticketId: TicketId;
  ejemplarId: EjemplarId;
  numero: number;
  estado: EstadoDeTicket;
  /** La jornada de la sesión de caja donde se cobró (la misma del cobro). */
  fechaNegocio: FechaCivil;
  total: ImporteJson;
  cobranzaId: string | null;
  cobros: readonly CobroHecho[];
  /** Un ticket cobrado espera su comprobante (E1); una cortesía no se factura. */
  pendienteDeFacturar: boolean;
  yaExistia: boolean;
}>;

/** Lo que hace falta para cobrar: el ejemplar original del ticket, la clave de la pantalla y la caja con sus cobros. */
export type PedidoDeCobro = Readonly<{
  claveIdempotencia: string;
  ejemplarId: string;
  cobro: Pick<EntradaDeCobrar, "cajaId" | "cobros">;
}>;

/**
 * La caja con sesión ABIERTA donde se cobra, leída DENTRO de la transacción (E4 §3.7): la jornada que se mira es la de la SESIÓN, no la del reloj.
 * Sin esa caja, sin sesión o con la sesión en cierre, devuelve el error de caja sin escribir nada.
 */
export async function cajaParaCobrar(
  tx: TxDeVentas,
  contexto: ContextoOperativo,
  sucursalId: string,
  cajaId: string,
): Promise<R<Readonly<{ sesionId: string; fechaDeNegocio: FechaCivil }>>> {
  const estadoDeCajas = await cajaParaVentas.estadoDeCajasParaCobrar(tx, contexto, sucursalId);
  if (!estadoDeCajas.ok) return estadoDeCajas;
  const caja = estadoDeCajas.valor.cajas.find((c) => c.cajaId === cajaId);
  if (caja === undefined) return err("CAJA_NO_ENCONTRADA_PARA_COBRAR");
  if (caja.estado === "SIN_SESION" || caja.sesionId === null || caja.fechaDeNegocio === null) {
    return err({ codigo: "SIN_SESION_ABIERTA", cajaId: caja.cajaId });
  }
  if (caja.estado === "EN_CIERRE") {
    return err({ codigo: "CAJA_EN_CIERRE", cajaId: caja.cajaId, sesionId: caja.sesionId });
  }
  return ok({ sesionId: caja.sesionId, fechaDeNegocio: caja.fechaDeNegocio });
}

/**
 * La cuenta ya tiene su ticket: es la misma venta repetida (misma clave y mismo contenido → la misma salida, `yaExistia`), o es otra cosa. Un
 * ticket sin cobrar que no es una cortesía de este mismo pedido no se cobra por esta puerta: `CUENTA_ID_EN_USO`.
 */
export async function ventaYaHecha(
  tx: TxDeVentas,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: PedidoDeCobro,
  ticket: Ticket,
): Promise<R<SalidaDeVenderYCobrar>> {
  const original = await tx.tickets.ejemplarDeNumero(contexto.empresaId, ticket.id, 1);
  if (original === null) throw new Error("el ticket no tiene su ejemplar original");
  if (original.id !== entrada.ejemplarId) return err("CUENTA_ID_EN_USO");
  const comun = {
    ticketId: ticket.id,
    ejemplarId: original.id,
    numero: ticket.numero,
    fechaNegocio: ticket.fechaNegocio,
    total: { moneda: "ARS", monto: ticket.total } as ImporteJson,
    yaExistia: true,
  };
  if (ticket.estado === "CORTESIA") {
    return ok({
      ...comun,
      estado: ticket.estado,
      cobranzaId: null,
      cobros: [],
      pendienteDeFacturar: false,
    });
  }
  if (ticket.estado === "EMITIDO") return err("CUENTA_ID_EN_USO");
  // COBRADO o ANULADO: el cobro dice si es la misma clave (lo hecho), otra (`TICKET_YA_COBRADO`) o un ticket anulado.
  const cobrada = await cobrarTicketEnTx(tx, contexto, persona, {
    claveIdempotencia: entrada.claveIdempotencia,
    ticketId: ticket.id,
    ejemplarId: original.id,
    cajaId: entrada.cobro.cajaId,
    cobros: entrada.cobro.cobros,
  });
  if (!cobrada.ok) return cobrada;
  return ok({
    ...comun,
    estado: "COBRADO",
    cobranzaId: cobrada.valor.cobranzaId,
    cobros: cobrada.valor.cobros,
    pendienteDeFacturar: true,
  });
}

/**
 * El cierre y el cobro de una cuenta ya cargada, en la transacción del llamador (E4 §3.7, pasos de cerrar y cobrar): cierra la cuenta con la jornada
 * y la sesión de caja de `opciones` (el ticket nace con su cobro) y cobra el ticket. Con total 0 (cortesía) no hay cobro. Lo comparten `venderYCobrar` y
 * `cerrarYCobrarEnTx`: una sola regla de cómo se cierra y cobra.
 */
export async function cerrarYCobrarCuenta(
  tx: TxDeVentas,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: PedidoDeCobro &
    Readonly<{
      cuentaId: string;
      esCortesia: boolean;
      confirmaciones?: readonly string[] | undefined;
    }>,
  opciones: OpcionesDeLaVenta & Readonly<{ sesionDeCajaId: string }>,
): Promise<R<SalidaDeVenderYCobrar>> {
  const cerrada = await cerrarCuentaEnTx(
    tx,
    contexto,
    persona,
    {
      cuentaId: entrada.cuentaId,
      ejemplarId: entrada.ejemplarId,
      confirmaciones: entrada.confirmaciones,
    },
    opciones,
  );
  if (!cerrada.ok) return cerrada;
  // La cuenta no tenía ticket al empezar la transacción: cerrarla acá la cierra de verdad.
  if (cerrada.valor.yaEstabaCerrada) throw new Error("invariante rota: la cuenta ya tenía ticket");
  if (entrada.esCortesia) {
    return ok({
      ticketId: cerrada.valor.ticketId,
      ejemplarId: cerrada.valor.ejemplarId,
      numero: cerrada.valor.numero,
      estado: cerrada.valor.estado,
      fechaNegocio: cerrada.valor.fechaNegocio,
      total: cerrada.valor.total,
      cobranzaId: null,
      cobros: [],
      pendienteDeFacturar: false,
      yaExistia: false,
    });
  }
  const cobrada = await cobrarTicketEnTx(
    tx,
    contexto,
    persona,
    {
      claveIdempotencia: entrada.claveIdempotencia,
      ticketId: cerrada.valor.ticketId,
      ejemplarId: cerrada.valor.ejemplarId,
      cajaId: entrada.cobro.cajaId,
      cobros: entrada.cobro.cobros,
    },
    { sesionDeCajaEsperada: opciones.sesionDeCajaId },
  );
  if (!cobrada.ok) return cobrada;
  return ok({
    ticketId: cerrada.valor.ticketId,
    ejemplarId: cerrada.valor.ejemplarId,
    numero: cerrada.valor.numero,
    estado: "COBRADO",
    fechaNegocio: cerrada.valor.fechaNegocio,
    total: cerrada.valor.total,
    cobranzaId: cobrada.valor.cobranzaId,
    cobros: cobrada.valor.cobros,
    pendienteDeFacturar: true,
    yaExistia: false,
  });
}

export type EntradaDeCerrarYCobrar = PedidoDeCobro &
  Readonly<{
    cuentaId: string;
    /** Lo que vio quien cobra: si el total de ahora es otro (alguien agregó o quitó algo), no se cobra nada (`TOTAL_CAMBIO`). */
    totalEsperado: Readonly<{ moneda: string; monto: string }>;
    confirmaciones?: readonly string[] | undefined;
  }>;

/**
 * `cerrarYCobrarEnTx` (E7 X2): el cierre y el cobro de una cuenta que YA existe (la mesa del salón), en la transacción del llamador; el permiso
 * (`cuentas.cerrar` y `tickets.cobrar`) lo exige quien llama. Orden: ids y clave, la cuenta en el alcance, IDEMPOTENCIA por cuenta y por clave (la
 * venta ya hecha se devuelve sin escribir; otra clave, `TICKET_YA_COBRADO`), la caja con sesión abierta y su jornada, el total de AHORA contra el
 * que vio quien cobra (`TOTAL_CAMBIO { totalActual }`, sin escribir) y los cobros contra el total al centavo (`COBRO_NO_CUADRA`); recién ahí cierra y
 * cobra con la fecha de negocio de la sesión de caja. Cualquier error devuelto revierte todo: ni número de ticket, ni cobro, ni salida de stock.
 */
export async function cerrarYCobrarEnTx(
  tx: TxDeVentas,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeCerrarYCobrar,
  opciones: Pick<OpcionesDeLaVenta, "stock"> = {},
): Promise<R<SalidaDeVenderYCobrar>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.cuentaId, entrada.ejemplarId, entrada.cobro.cajaId);
  if (!ids.ok) return ids;
  const clave = exigirClave(entrada.claveIdempotencia);
  if (!clave.ok) return clave;
  if (entrada.totalEsperado.moneda !== ARS) return err("MONEDA_NO_SOPORTADA");
  if (!FORMA_DEL_IMPORTE.test(entrada.totalEsperado.monto)) return err("IMPORTE_INVALIDO");
  const totalEsperado = importeDesdeTexto(ARS, entrada.totalEsperado.monto);

  const cuenta = await tx.cuentas.obtener(empresaId, cuentaId(entrada.cuentaId));
  if (cuenta === null) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, cuenta.sucursalId);
  if (!alcance.ok) return alcance;

  // Idempotencia: la venta de esta cuenta, si ya existe, se devuelve (o se dice por qué no) SIN mirar la caja ni la jornada.
  const existente = await tx.tickets.obtenerPorCuenta(empresaId, cuenta.id);
  const previa = await tx.tickets.cobranzaPorClave(empresaId, entrada.claveIdempotencia);
  if (existente !== null || previa !== null) {
    if (existente === null || (previa !== null && previa.ticketId !== existente.id)) {
      return err("CLAVE_REUTILIZADA");
    }
    return ventaYaHecha(tx, contexto, persona, entrada, existente);
  }
  if (cuenta.estado !== "ABIERTA") {
    return err(cuenta.estado === "ANULADA" ? "CUENTA_ANULADA" : "CUENTA_CERRADA");
  }

  const caja = await cajaParaCobrar(tx, contexto, cuenta.sucursalId, entrada.cobro.cajaId);
  if (!caja.ok) return caja;
  const jornada = await exigirJornadaAbierta(
    tx,
    contexto,
    cuenta.sucursalId,
    caja.valor.fechaDeNegocio,
  );
  if (!jornada.ok) return jornada;

  const calculado = calcularLasLineas(await tx.cuentas.lineasDeCuenta(empresaId, cuenta.id));
  const totalActual = calculado.total;
  if (totalActual.unidades !== totalEsperado.unidades) {
    return err({ error: "TOTAL_CAMBIO", totalActual: importeAJson(totalActual) });
  }
  const esCortesia = totalActual.unidades === 0n;
  if (esCortesia) {
    // Sin cobro: lo que sobre es un cobro de más; sin nada, no hay qué validar.
    if (entrada.cobro.cobros.length > 0) {
      const cobros = normalizarCobros(entrada.cobro.cobros);
      if (!cobros.ok) return cobros;
      const cuadra = cuadrarCobros(importeCero(ARS), cobros.valor);
      if (!cuadra.ok) return cuadra;
    }
  } else {
    const cobros = normalizarCobros(entrada.cobro.cobros);
    if (!cobros.ok) return cobros;
    const cuadra = cuadrarCobros(totalActual, cobros.valor);
    if (!cuadra.ok) return cuadra;
  }
  return cerrarYCobrarCuenta(
    tx,
    contexto,
    persona,
    { ...entrada, esCortesia },
    {
      jornada: caja.valor.fechaDeNegocio,
      sesionDeCajaId: caja.valor.sesionId,
      stock: opciones.stock,
    },
  );
}
