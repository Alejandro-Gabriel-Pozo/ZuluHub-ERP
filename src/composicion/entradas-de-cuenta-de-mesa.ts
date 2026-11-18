import { z } from "zod";
import type { FiltroDelMapa } from "../modulos/salon/publico";
import type { Resultado } from "../primitivas/resultado/resultado";
import { identificador, leer, type ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * La frontera de la cuenta de mesa del salón (S-0r; E7 §3.4): de lo que manda la pantalla a lo que aceptan el mapa, la ficha, `tomarPedido`, `liberarMesa` y `cambiarDeMesa`. Pura: sin base ni servidor.
 *
 * Lista de permitidos: de cada pedido solo se leen las claves que declara su esquema (`z.object` descarta el resto: no se puede mandar la empresa, la persona, la sucursal ni el estado de la
 * mesa; la sucursal la fija el servidor). Esta capa dice si el dato tiene la FORMA pedida (ids con forma de id, el filtro dentro del conjunto del mapa); si la mesa existe, está libre o es de
 * la sucursal lo decide el servidor dentro de su transacción. Nada de dinero entra por acá.
 *
 *  - **El id de la cuenta lo manda la pantalla** y es la clave de idempotencia de «Tomar pedido»: la misma otra vez devuelve la misma cuenta, no abre otra.
 * Chequeo: `entradas-de-cuenta-de-mesa.test.ts`.
 */

const FILTROS = [
  "TODAS",
  "LIBRES",
  "EN_PEDIDO",
  "OCUPADAS",
] as const satisfies readonly FiltroDelMapa[];

const FORMA_DEL_MAPA = z.object({ filtro: z.enum(FILTROS).optional() });
const FORMA_DE_TOMAR_PEDIDO = z.object({ cuentaId: identificador, mesaId: identificador });
const FORMA_DE_UNA_CUENTA = z.object({ cuentaId: identificador });
const FORMA_DE_CAMBIAR_DE_MESA = z.object({
  cuentaId: identificador,
  mesaDestinoId: identificador,
});

type Pedido<T> = Resultado<T, ErrorDeEntrada>;

export type PedidoDelMapa = Readonly<{ filtro: FiltroDelMapa }>;
export type PedidoDeTomarPedido = z.output<typeof FORMA_DE_TOMAR_PEDIDO>;
export type PedidoDeUnaCuenta = z.output<typeof FORMA_DE_UNA_CUENTA>;
export type PedidoDeCambiarDeMesa = z.output<typeof FORMA_DE_CAMBIAR_DE_MESA>;

/** El mapa sin filtro (o sin pedido) es «Todas». */
export function leerElPedidoDelMapa(crudo: unknown): Pedido<PedidoDelMapa> {
  const forma = leer(FORMA_DEL_MAPA, crudo ?? {});
  return forma.ok ? { ok: true, valor: { filtro: forma.valor.filtro ?? "TODAS" } } : forma;
}

export const leerElPedidoDeTomarPedido = (crudo: unknown): Pedido<PedidoDeTomarPedido> =>
  leer(FORMA_DE_TOMAR_PEDIDO, crudo);

export const leerElPedidoDeUnaCuenta = (crudo: unknown): Pedido<PedidoDeUnaCuenta> =>
  leer(FORMA_DE_UNA_CUENTA, crudo);

export const leerElPedidoDeCambiarDeMesa = (crudo: unknown): Pedido<PedidoDeCambiarDeMesa> =>
  leer(FORMA_DE_CAMBIAR_DE_MESA, crudo);
