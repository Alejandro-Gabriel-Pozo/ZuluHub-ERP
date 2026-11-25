import type { ReglasDeEmpresa } from "../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../contexto/contexto";
import type { Resultado } from "../../primitivas/resultado/resultado";
import {
  controlaStock,
  depositoDeVentaDe,
  existenciasParaMostrar,
} from "./casos-de-uso/lectura-de-venta";
import { ajustarCostoPorOrigen } from "./casos-de-uso/ajuste-de-costo";
import type { EntradaDeAjusteDeCosto, SalidaDeAjusteDeCosto } from "./casos-de-uso/ajuste-de-costo";
import { registrarEntradaPorOrigen, revertirPorOrigen } from "./casos-de-uso/reversion-y-entrada";
import { registrarSalidaPorVenta } from "./casos-de-uso/salida-por-venta";
import { registrarCorreccionDeRecepcion } from "./casos-de-uso/correccion-por-origen";
import { anularSalidaPorOrigen, registrarSalidaPorOrigen } from "./casos-de-uso/salida-por-origen";
import type {
  ControlDeUnProducto,
  EntradaDeAnulacionPorOrigen,
  EntradaDeCorreccionDeRecepcion,
  EntradaDeEntradaPorOrigen,
  EntradaDeReversionPorOrigen,
  EntradaDeSalidaPorOrigen,
  EntradaDeSalidaPorVenta,
  ExistenciaDeProducto,
  SalidaDeAnulacionPorOrigen,
  SalidaDeCorreccionDeRecepcion,
  SalidaDeEntradaPorOrigen,
  SalidaDeReversionPorOrigen,
  SalidaDeSalidaPorOrigen,
  SalidaDeSalidaPorVenta,
  TxDeLecturaDeStock,
} from "./casos-de-uso/tipos-de-puertos";
import type { TxDeStock } from "./casos-de-uso/contrato";
import type { ErrorDeStock } from "./casos-de-uso/errores";

/**
 * LOS PUERTOS QUE STOCK OFRECE A OTROS MÓDULOS (E5 §3.3; los cablea la composición, T12). Mismo molde que `GanchosDeSucursal` de empresas y
 * `CajaParaVentas` de caja: stock DECLARA el contrato y lo implementa, quien lo usa (ventas, compras) lo recibe de la composición y stock no
 * importa a ninguno de ellos. Todos corren en la TRANSACCIÓN DEL LLAMADOR (la `Tx` compuesta contiene `TxDeStock`: nunca abren una propia, así
 * un error de stock revierte el cierre de la cuenta) y NINGUNO tiene acción propia: la autorización la puso el caso de uso que llama, y se guarda
 * en `movimiento.accion` (regla del dueño: un permiso por transición). Por eso no se exponen al cliente: ni acciones de servidor ni rutas.
 *
 * Los errores de la base (una carrera por el único de origen que la transacción del llamador no repite) salen como excepciones de su transacción:
 * quien arma la transacción las traduce con `traducirMovimiento`, igual que los casos de uso de stock.
 */

/** Lo único que necesitan las fábricas: el catálogo de módulos con el que se decide si `stock` opera para la empresa (nace cerrado si no). */
export type DependenciasDePuertosDeStock = Readonly<{ reglas: ReglasDeEmpresa }>;

type R<S> = Resultado<S, ErrorDeStock>;

/** Salida por una venta (`registrarSalidaPorVentaEnTx`): ventas la llama al cerrar la cuenta (D132), en el paso 7 del cierre. */
export interface ConsumoDeStock {
  registrarSalidaPorVentaEnTx(
    tx: TxDeStock,
    contexto: ContextoOperativo,
    entrada: EntradaDeSalidaPorVenta,
  ): Promise<R<SalidaDeSalidaPorVenta>>;
}

/** Revierte la salida de un ejemplar (corregir o anular un ticket): una anulación espejo, una sola vez. */
export interface ReversionDeStock {
  revertirPorOrigen(
    tx: TxDeStock,
    contexto: ContextoOperativo,
    entrada: EntradaDeReversionPorOrigen,
  ): Promise<R<SalidaDeReversionPorOrigen>>;
}

/** El depósito de venta activo de una sucursal, o `null` (con stock activo y líneas que controlan, ventas falla cerrado: `STOCK_SIN_DEPOSITO_DE_VENTA`). */
export interface DepositoDeVenta {
  deVenta(
    tx: Pick<TxDeLecturaDeStock, "depositos">,
    contexto: Pick<ContextoOperativo, "empresaId">,
    sucursalId: string,
  ): Promise<Readonly<{ depositoId: string }> | null>;
}

/** ¿Cada producto controla stock y le falta receta? De ahí sale `linea_cuenta.controla_stock`. Con `stock` apagado, nada controla. */
export interface ArticulosDeVenta {
  controla(
    tx: TxDeStock,
    contexto: ContextoOperativo,
    productoIds: readonly string[],
  ): Promise<ReadonlyMap<string, ControlDeUnProducto>>;
}

/** La existencia de cada producto con artículo en un depósito, para mostrar («quedan 2»): nunca es la puerta pública del libro. */
export interface ExistenciaParaMostrar {
  existencias(
    tx: TxDeLecturaDeStock,
    contexto: Pick<ContextoOperativo, "empresaId" | "ahora">,
    productoIds: readonly string[],
    depositoId: string,
  ): Promise<readonly ExistenciaDeProducto[]>;
}

/** La entrada de mercadería de una recepción (compras): una sola entrada por recepción, aunque cambie la clave. */
export interface EntradaPorOrigen {
  registrarEntrada(
    tx: TxDeStock,
    contexto: ContextoOperativo,
    entrada: EntradaDeEntradaPorOrigen,
  ): Promise<R<SalidaDeEntradaPorOrigen>>;
}

/** La salida de mercadería por una devolución al proveedor (compras, N4) y su anulación espejo: una sola salida y una sola anulación por devolución, aunque cambie la clave. */
export interface SalidaPorOrigen {
  registrarSalida(
    tx: TxDeStock,
    contexto: ContextoOperativo,
    entrada: EntradaDeSalidaPorOrigen,
  ): Promise<R<SalidaDeSalidaPorOrigen>>;
  anular(
    tx: TxDeStock,
    contexto: ContextoOperativo,
    entrada: EntradaDeAnulacionPorOrigen,
  ): Promise<R<SalidaDeAnulacionPorOrigen>>;
}

/** La corrección de lo recibido de una recepción separada (compras, N3): una entrada o una salida por corrección, una sola por corrección aunque cambie la clave. */
export interface CorreccionDeRecepcion {
  registrar(
    tx: TxDeStock,
    contexto: ContextoOperativo,
    entrada: EntradaDeCorreccionDeRecepcion,
  ): Promise<R<SalidaDeCorreccionDeRecepcion>>;
}

/** El ajuste del costo de una compra corregida (E9 T11, D-E9-3): corrige el promedio por la diferencia sobre lo que queda; lo ya consumido conserva su costo. */
export interface AjusteDeCostoPorOrigen {
  ajustar(
    tx: TxDeStock,
    contexto: ContextoOperativo,
    entrada: EntradaDeAjusteDeCosto,
  ): Promise<R<SalidaDeAjusteDeCosto>>;
}

export type PuertosDeStock = Readonly<{
  consumoDeStock: ConsumoDeStock;
  reversionDeStock: ReversionDeStock;
  depositoDeVenta: DepositoDeVenta;
  articulosDeVenta: ArticulosDeVenta;
  existenciaParaMostrar: ExistenciaParaMostrar;
  entradaPorOrigen: EntradaPorOrigen;
  salidaPorOrigen: SalidaPorOrigen;
  correccionDeRecepcion: CorreccionDeRecepcion;
  ajusteDeCostoPorOrigen: AjusteDeCostoPorOrigen;
}>;

export const crearConsumoDeStock = ({ reglas }: DependenciasDePuertosDeStock): ConsumoDeStock => ({
  registrarSalidaPorVentaEnTx: (tx, contexto, entrada) =>
    registrarSalidaPorVenta(tx, contexto, reglas, entrada),
});

export const crearReversionDeStock = (): ReversionDeStock => ({ revertirPorOrigen });

export const crearDepositoDeVenta = (): DepositoDeVenta => ({ deVenta: depositoDeVentaDe });

export const crearArticulosDeVenta = ({
  reglas,
}: DependenciasDePuertosDeStock): ArticulosDeVenta => ({
  controla: (tx, contexto, productoIds) => controlaStock(tx, contexto, reglas, productoIds),
});

export const crearExistenciaParaMostrar = (): ExistenciaParaMostrar => ({
  existencias: existenciasParaMostrar,
});

export const crearEntradaPorOrigen = ({
  reglas,
}: DependenciasDePuertosDeStock): EntradaPorOrigen => ({
  registrarEntrada: (tx, contexto, entrada) =>
    registrarEntradaPorOrigen(tx, contexto, reglas, entrada),
});

export const crearSalidaPorOrigen = ({
  reglas,
}: DependenciasDePuertosDeStock): SalidaPorOrigen => ({
  registrarSalida: (tx, contexto, entrada) =>
    registrarSalidaPorOrigen(tx, contexto, reglas, entrada),
  anular: (tx, contexto, entrada) => anularSalidaPorOrigen(tx, contexto, entrada),
});

export const crearCorreccionDeRecepcion = ({
  reglas,
}: DependenciasDePuertosDeStock): CorreccionDeRecepcion => ({
  registrar: (tx, contexto, entrada) =>
    registrarCorreccionDeRecepcion(tx, contexto, reglas, entrada),
});

export const crearAjusteDeCostoPorOrigen = ({
  reglas,
}: DependenciasDePuertosDeStock): AjusteDeCostoPorOrigen => ({
  ajustar: (tx, contexto, entrada) => ajustarCostoPorOrigen(tx, contexto, reglas, entrada),
});

/** Los siete puertos juntos: lo que la composición le pasa a ventas y a compras (T12). */
export const crearPuertosDeStock = (
  dependencias: DependenciasDePuertosDeStock,
): PuertosDeStock => ({
  consumoDeStock: crearConsumoDeStock(dependencias),
  reversionDeStock: crearReversionDeStock(),
  depositoDeVenta: crearDepositoDeVenta(),
  articulosDeVenta: crearArticulosDeVenta(dependencias),
  existenciaParaMostrar: crearExistenciaParaMostrar(),
  entradaPorOrigen: crearEntradaPorOrigen(dependencias),
  salidaPorOrigen: crearSalidaPorOrigen(dependencias),
  correccionDeRecepcion: crearCorreccionDeRecepcion(dependencias),
  ajusteDeCostoPorOrigen: crearAjusteDeCostoPorOrigen(dependencias),
});
