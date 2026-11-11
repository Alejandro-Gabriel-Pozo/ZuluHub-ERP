import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeCero, importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import { traducirErroresDelCobro } from "../../caja/publico";
import { cuadrarCobros, decidirPrecioDeLaVenta, normalizarCobros } from "../dominio/cobranza";
import { FORMA_DEL_IMPORTE } from "../dominio/forma-del-importe";
import { cuentaId } from "../dominio/identificadores";
import { abrirCuentaEnTx } from "./abrir-cuenta";
import { agregarLineaEnTx } from "./agregar-linea";
import {
  cajaParaCobrar,
  cerrarYCobrarCuenta,
  ventaYaHecha,
  type SalidaDeVenderYCobrar,
} from "./cerrar-y-cobrar";
import { REINTENTOS_AL_COBRAR, type EntradaDeCobrar } from "./cobrar";
import { cotizarVentaRapida } from "./cotizar-venta-rapida";
import {
  exigirAlcance,
  exigirClave,
  exigirJornadaAbierta,
  exigirUuid,
  prepararComando,
  traducir,
} from "./comun";
import type { DependenciasDeVentas, TxDeVentas } from "./contrato";
import type { ErrorDeVentas } from "./errores";

type R<S> = Resultado<S, ErrorDeVentas>;

export type LineaDeLaVenta = Readonly<{
  /** Lo manda la pantalla (idempotencia de la línea). */
  lineaId: string;
  productoId: string;
  varianteId?: string | undefined;
  opcionIds: readonly string[];
  /** Texto decimal exacto. */
  cantidad: string;
  /** Solo para un producto en precio abierto (decisión 179): el importe UNITARIO que escribe quien vende. */
  precioAbierto?: string | undefined;
}>;

export type { SalidaDeVenderYCobrar };

export type EntradaDeVenderYCobrar = Readonly<{
  /** `^[A-Za-z0-9_-]{16,128}$`, por intento de cobro (idempotencia). */
  claveIdempotencia: string;
  /** Lo genera la pantalla al agregar la primera línea; junto con `ejemplarId` identifica la venta. */
  cuentaId: string;
  /** El id del ejemplar ORIGINAL del ticket. */
  ejemplarId: string;
  sucursalId: string;
  lineas: readonly LineaDeLaVenta[];
  /** Lo que el cajero vio en pantalla: si el total de ahora es otro, no se cobra nada (`PRECIO_CAMBIO`). */
  totalEsperado: Readonly<{ moneda: string; monto: string }>;
  confirmaciones?: readonly string[] | undefined;
  /** Con total 0 (cortesía) no se cobra y `cobros` tiene que venir vacío. */
  cobro: Pick<EntradaDeCobrar, "cajaId" | "cobros">;
}>;

const MAXIMO_DE_LINEAS = 200;

/**
 * `venderYCobrar` (E4 §3.7): la venta del mostrador en UN acto atómico. Una transacción serializable: guard de las CUATRO acciones (`cuentas.abrir`,
 * `cuentas.agregar_linea`, `cuentas.cerrar`, `tickets.cobrar`), forma de la entrada, la sucursal en el alcance, IDEMPOTENCIA (por clave y por cuenta: lo ya
 * vendido se devuelve sin escribir; con otra clave, `TICKET_YA_COBRADO`), la caja con sesión abierta y su jornada (se mira la de la SESIÓN, no la del
 * reloj: ticket y cobro caen siempre en la misma jornada, también con la caja abierta pasada la hora de corte), la cotización contra el catálogo
 * (`PRECIO_CAMBIO` si el total ya no es el que vio el cajero: no se cobra nada) y los cobros contra el total al centavo; recién ahí escribe, con las
 * MISMAS funciones que el salón: abrir, agregar × n, cerrar (ticket con la fecha de la sesión) y cobrar. Con total 0 no hay cobro y el ticket queda
 * `CORTESIA` (pide `VENTA_A_CERO`). Cualquier error devuelto revierte todo: ni cuenta, ni número de ticket, ni cobro, ni salida de stock (al cerrar, con stock cableado y activo, el
 * ticket descuenta sus líneas que controlan: E5-T12).
 */
async function vender(
  tx: TxDeVentas,
  dependencias: DependenciasDeVentas,
  contexto: ContextoOperativo,
  entrada: EntradaDeVenderYCobrar,
): Promise<R<SalidaDeVenderYCobrar>> {
  const { empresaId } = contexto;
  const persona = await prepararComando(tx, contexto, dependencias.reglas, [
    "cuentas.abrir",
    "cuentas.agregar_linea",
    "cuentas.cerrar",
    "tickets.cobrar",
  ]);
  if (!persona.ok) return persona;

  const ids = exigirUuid(
    entrada.cuentaId,
    entrada.ejemplarId,
    entrada.sucursalId,
    entrada.cobro.cajaId,
    ...entrada.lineas.map((l) => l.lineaId),
  );
  if (!ids.ok) return ids;
  const clave = exigirClave(entrada.claveIdempotencia);
  if (!clave.ok) return clave;
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

  // Idempotencia: la venta de esta cuenta, si ya existe, se devuelve (o se dice por qué no) SIN mirar la caja ni la jornada.
  const existente = await tx.tickets.obtenerPorCuenta(empresaId, cuentaId(entrada.cuentaId));
  const previa = await tx.tickets.cobranzaPorClave(empresaId, entrada.claveIdempotencia);
  if (existente !== null || previa !== null) {
    if (existente === null || (previa !== null && previa.ticketId !== existente.id)) {
      return err("CLAVE_REUTILIZADA");
    }
    return ventaYaHecha(tx, contexto, persona.valor, entrada, existente);
  }

  // La caja y su sesión, leídas dentro de la transacción: la jornada que se mira es la de la sesión (§3.15).
  const caja = await cajaParaCobrar(tx, contexto, entrada.sucursalId, entrada.cobro.cajaId);
  if (!caja.ok) return caja;
  const opciones = {
    jornada: caja.valor.fechaDeNegocio,
    sesionDeCajaId: caja.valor.sesionId,
    stock: dependencias.stock,
  };
  const jornada = await exigirJornadaAbierta(tx, contexto, sucursal, opciones.jornada);
  if (!jornada.ok) return jornada;

  // Cotizar con el catálogo y comparar con lo que vio el cajero, antes de escribir nada.
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

  const abierta = await abrirCuentaEnTx(
    tx,
    contexto,
    persona.valor,
    { cuentaId: entrada.cuentaId, sucursalId: entrada.sucursalId },
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
  return cerrarYCobrarCuenta(tx, contexto, persona.valor, { ...entrada, esCortesia }, opciones);
}

export function armarVenderYCobrar(dependencias: DependenciasDeVentas) {
  return async function venderYCobrar(
    contexto: ContextoOperativo,
    entrada: EntradaDeVenderYCobrar,
  ): Promise<R<SalidaDeVenderYCobrar>> {
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto, reintentos: REINTENTOS_AL_COBRAR },
      (tx) => vender(tx, dependencias, contexto, entrada),
    );
    // Un error de la base en la transacción (caja) sale con su código de negocio; el resto, como el módulo lo traduce.
    return traducir(traducirErroresDelCobro(resultado), dependencias.stock);
  };
}
