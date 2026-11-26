import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { ErrorDeValor } from "../../../primitivas/cantidad/errores";
import { FORMA_DEL_IMPORTE } from "../../../primitivas/dinero/forma-del-importe";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { decidirPrecioDeLaVenta } from "../dominio/cobranza";
import { cuentaId } from "../dominio/identificadores";
import type { Linea } from "../persistencia/modelo-de-cuentas";
import type { Ticket } from "../persistencia/repositorio-de-tickets";
import { abrirCuentaEnTx } from "./abrir-cuenta";
import { agregarLineaEnTx, lineaTieneElContenido } from "./agregar-linea";
import { cerrarCuentaEnTx, salidaDelTicketExistente } from "./cerrar-cuenta";
import type { SalidaDeCerrarCuenta } from "./cerrar-cuenta";
import { REINTENTOS_AL_COBRAR } from "./cobrar";
import { cotizarVentaRapida } from "./cotizar-venta-rapida";
import {
  exigirAlcance,
  exigirJornadaAbierta,
  exigirUuid,
  prepararComando,
  traducir,
  type OpcionesDeLaVenta,
} from "./comun";
import type { DependenciasDeVentas, TxDeVentas } from "./contrato";
import type { ErrorDeVentas } from "./errores";
import type { LineaDeLaVenta } from "./vender-y-cobrar";

type R<S> = Resultado<S, ErrorDeVentas>;

export type EntradaDeVenderACuenta = Readonly<{
  /** Lo genera la pantalla al armar la venta; es la clave de idempotencia (con `ejemplarId`, identifica la venta). */
  cuentaId: string;
  /** El id del ejemplar ORIGINAL del ticket. */
  ejemplarId: string;
  sucursalId: string;
  /** A2c: el departamento del selector (se fija al abrir la cuenta). Ver `EntradaDeAbrirCuenta.departamentoId`. */
  departamentoId?: string | undefined;
  lineas: readonly LineaDeLaVenta[];
  /** Lo que vio quien vende: si el total de ahora es otro, no se vende ni se carga nada (`PRECIO_CAMBIO`). */
  totalEsperado: Readonly<{ moneda: string; monto: string }>;
  confirmaciones?: readonly string[] | undefined;
  /** El cliente al que se carga la venta (obligatorio: una venta a cuenta sin cliente no existe). */
  clienteId: string;
  /** El motivo con el que quien vende aprueba pasar el límite de crédito; solo cuenta con `cuenta_corriente.aprobar_exceso`. */
  aprobacionDelExceso?: Readonly<{ motivo: string }> | undefined;
}>;

/** El mismo tope de líneas que `venderYCobrar`: una venta a cuenta es la misma venta de mostrador, sin cobro. */
const MAXIMO_DE_LINEAS = 200;

/** ¿Las líneas vigentes de la cuenta ya vendida son exactamente las del pedido (mismo id, producto, cantidad, elecciones y precio abierto)? */
function lasLineasSonLasDelPedido(
  guardadas: readonly Linea[],
  pedido: readonly LineaDeLaVenta[],
): R<boolean> {
  const vigentes = guardadas.filter((l) => l.estado === "VIGENTE");
  if (vigentes.length !== pedido.length) return ok(false);
  for (const p of pedido) {
    const guardada = vigentes.find((l) => l.id === p.lineaId);
    if (guardada === undefined) return ok(false);
    let cantidad;
    try {
      cantidad = cantidadDesdeTexto(p.cantidad);
    } catch (error) {
      if (error instanceof ErrorDeValor) return err("CANTIDAD_INVALIDA");
      throw error;
    }
    const mismo = lineaTieneElContenido(guardada, {
      productoId: p.productoId,
      cantidad,
      elegidas: [...(p.varianteId === undefined ? [] : [p.varianteId]), ...p.opcionIds],
      precioAbierto: p.precioAbierto,
    });
    if (!mismo) return ok(false);
  }
  return ok(true);
}

/**
 * La cuenta ya tiene su ticket: es la misma venta a cuenta repetida (misma huella → lo hecho, `yaEstabaCerrada`, sin escribir ni cargar) o es otro pedido con la
 * misma clave (`CLAVE_REUTILIZADA`). La huella es el ejemplar original, el cliente cargado, el total y las líneas: otro cliente, otras líneas u otro total esperado no
 * se devuelven como si fueran este pedido, y un ticket que no se cargó a un cliente (lo cerró otro camino) tampoco.
 */
async function ventaYaHecha(
  tx: TxDeVentas,
  contexto: ContextoOperativo,
  entrada: EntradaDeVenderACuenta,
  ticket: Ticket,
): Promise<R<SalidaDeCerrarCuenta>> {
  const { empresaId } = contexto;
  const original = await tx.tickets.ejemplarDeNumero(empresaId, ticket.id, 1);
  if (original === null) throw new Error("el ticket cerrado no tiene su ejemplar original");
  if (original.id !== entrada.ejemplarId) return err("CLAVE_REUTILIZADA");
  if (ticket.cargadoAParteId !== entrada.clienteId) return err("CLAVE_REUTILIZADA");
  const esperado = importeDesdeTexto(ARS, entrada.totalEsperado.monto);
  if (esperado.unidades !== importeDesdeTexto(ARS, ticket.total).unidades) {
    return err("CLAVE_REUTILIZADA");
  }
  const guardadas = await tx.cuentas.lineasDeCuenta(empresaId, ticket.cuentaId);
  const mismas = lasLineasSonLasDelPedido(guardadas, entrada.lineas);
  if (!mismas.ok) return mismas;
  if (!mismas.valor) return err("CLAVE_REUTILIZADA");
  return ok(await salidaDelTicketExistente(tx, empresaId, ticket));
}

/**
 * `venderACuenta` (CC-5): la venta rápida a cuenta corriente en UN acto atómico, sin caja ni cobro. Una transacción serializable: guard de las CUATRO acciones (`cuentas.abrir`,
 * `cuentas.agregar_linea`, `cuentas.cerrar`, `cuenta_corriente.cargar_a_cuenta`), forma de la entrada, la sucursal en el alcance, IDEMPOTENCIA por `cuentaId` (lo ya vendido se devuelve
 * sin escribir ni cargar; otro cliente, otras líneas u otro total esperado, `CLAVE_REUTILIZADA`), la jornada abierta (la del reloj: no hay sesión de caja), la cotización contra el
 * catálogo (`PRECIO_CAMBIO` si el total ya no es el que vio quien vende: no se escribe nada) y recién ahí, con las MISMAS funciones del salón y del mostrador: abrir, agregar × n y cerrar
 * a nombre del cliente (`cerrarCuentaEnTx`: cliente válido, número del ticket, descuento de stock, auditoría y cargo al libro con límite y aprobación). El ticket queda `EMITIDO` sin
 * `sesionDeCajaId`; cuenta para el cierre del día por su fecha de negocio. Cualquier error devuelto revierte todo: ni cuenta abierta, ni líneas, ni número, ni stock, ni cargo.
 * Dos a la vez sobre la misma cuenta: uno cierra y el otro (que reintenta tras el conflicto de serialización) devuelve lo hecho.
 */
async function vender(
  tx: TxDeVentas,
  dependencias: DependenciasDeVentas,
  contexto: ContextoOperativo,
  entrada: EntradaDeVenderACuenta,
): Promise<R<SalidaDeCerrarCuenta>> {
  const { empresaId } = contexto;
  const persona = await prepararComando(tx, contexto, dependencias.reglas, [
    "cuentas.abrir",
    "cuentas.agregar_linea",
    "cuentas.cerrar",
    "cuenta_corriente.cargar_a_cuenta",
  ]);
  if (!persona.ok) return persona;

  const ids = exigirUuid(
    entrada.cuentaId,
    entrada.ejemplarId,
    entrada.sucursalId,
    entrada.clienteId,
    ...entrada.lineas.map((l) => l.lineaId),
  );
  if (!ids.ok) return ids;
  if (
    entrada.lineas.length === 0 ||
    entrada.lineas.length > MAXIMO_DE_LINEAS ||
    new Set(entrada.lineas.map((l) => l.lineaId)).size !== entrada.lineas.length
  ) {
    return err("ENTRADA_INVALIDA");
  }
  if (entrada.totalEsperado.moneda !== ARS) return err("MONEDA_NO_SOPORTADA");
  if (!FORMA_DEL_IMPORTE.test(entrada.totalEsperado.monto)) return err("IMPORTE_INVALIDO");
  const totalEsperado = importeDesdeTexto(ARS, entrada.totalEsperado.monto);

  const sucursal = sucursalId(entrada.sucursalId);
  const alcance = await exigirAlcance(tx, contexto, sucursal);
  if (!alcance.ok) return alcance;

  // Idempotencia: la venta de esta cuenta, si ya existe, se devuelve (o se dice por qué no) SIN mirar la jornada.
  const id = cuentaId(entrada.cuentaId);
  const existente = await tx.tickets.obtenerPorCuenta(empresaId, id);
  if (existente !== null) return ventaYaHecha(tx, contexto, entrada, existente);
  // Una cuenta con este id y sin ticket (abierta o anulada por otro camino) no es esta venta: no se la adopta ni se le agregan líneas.
  if ((await tx.cuentas.obtener(empresaId, id)) !== null) return err("CUENTA_ID_EN_USO");

  const jornada = await exigirJornadaAbierta(tx, contexto, sucursal);
  if (!jornada.ok) return jornada;

  // Cotizar con el catálogo y comparar con lo que vio quien vende, antes de escribir nada.
  const cotizada = await cotizarVentaRapida(tx, contexto, {
    sucursalId: entrada.sucursalId,
    lineas: entrada.lineas,
  });
  if (!cotizada.ok) return cotizada;
  const totalActual = importeDesdeTexto(ARS, cotizada.valor.total.monto);
  if (!decidirPrecioDeLaVenta({ totalActual, totalEsperado }).ok) {
    return err({
      error: "PRECIO_CAMBIO",
      totalActual: cotizada.valor.total,
      lineas: cotizada.valor.lineas,
    });
  }

  // Una venta a cuenta de total 0 no existe (un cargo de cero no entra al libro): se rechaza, con o sin la confirmación de cortesía, ANTES de abrir nada. Va después de la cotización: el total
  // sale del catálogo, no del pedido.
  if (totalActual.unidades === 0n) return err("VENTA_A_CERO_A_CUENTA");

  const opciones: OpcionesDeLaVenta = {
    stock: dependencias.stock,
    cuentaCorriente: dependencias.cuentaCorriente,
  };
  const abierta = await abrirCuentaEnTx(
    tx,
    contexto,
    persona.valor,
    {
      cuentaId: entrada.cuentaId,
      sucursalId: entrada.sucursalId,
      departamentoId: entrada.departamentoId,
    },
    opciones,
  );
  if (!abierta.ok) return abierta;
  for (const l of entrada.lineas) {
    const agregada = await agregarLineaEnTx(
      tx,
      contexto,
      persona.valor,
      {
        cuentaId: entrada.cuentaId,
        lineaId: l.lineaId,
        productoId: l.productoId,
        varianteId: l.varianteId,
        opcionIds: l.opcionIds,
        cantidad: l.cantidad,
        precioAbierto: l.precioAbierto,
        confirmaciones: entrada.confirmaciones,
      },
      opciones,
    );
    if (!agregada.ok) return agregada;
  }
  return cerrarCuentaEnTx(
    tx,
    contexto,
    persona.valor,
    {
      cuentaId: entrada.cuentaId,
      ejemplarId: entrada.ejemplarId,
      confirmaciones: entrada.confirmaciones,
      clienteId: entrada.clienteId,
      totalEsperado: entrada.totalEsperado,
      aprobacionDelExceso: entrada.aprobacionDelExceso,
    },
    opciones,
  );
}

export function armarVenderACuenta(dependencias: DependenciasDeVentas) {
  return async function venderACuenta(
    contexto: ContextoOperativo,
    entrada: EntradaDeVenderACuenta,
  ): Promise<R<SalidaDeCerrarCuenta>> {
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto, reintentos: REINTENTOS_AL_COBRAR },
      (tx) => vender(tx, dependencias, contexto, entrada),
    );
    return traducir(resultado, dependencias.stock);
  };
}
