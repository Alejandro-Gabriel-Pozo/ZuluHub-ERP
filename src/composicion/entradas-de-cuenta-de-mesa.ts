import { z } from "zod";
import { SALIDAS_DE_LINEA } from "../modulos/comandas/publico";
import type { FiltroDelMapa } from "../modulos/salon/publico";
import type { Resultado } from "../primitivas/resultado/resultado";
import { MAXIMO_DE_CUENTAS_POR_ITEMS } from "../primitivas/cuentas/limites-de-division";
import { MAXIMO_DE_OPCIONES_POR_LINEA } from "./entradas-de-venta-rapida";
import {
  decimal,
  identificador,
  leer,
  texto,
  type ErrorDeEntrada,
} from "./entradas-de-facturacion";

/**
 * La frontera de la cuenta de mesa del salón (S-0r; E7 §3.4): de lo que manda la pantalla a lo que aceptan el mapa, la ficha, `tomarPedido`, `liberarMesa` y `cambiarDeMesa`. Pura: sin base ni servidor.
 *
 * Lista de permitidos: de cada pedido solo se leen las claves que declara su esquema (`z.object` descarta el resto: no se puede mandar la empresa, la persona, la sucursal ni el estado de la
 * mesa; la sucursal la fija el servidor). Esta capa dice si el dato tiene la FORMA pedida (ids con forma de id, el filtro dentro del conjunto del mapa); si la mesa existe, está libre o es de
 * la sucursal lo decide el servidor dentro de su transacción. Nada de dinero entra por acá.
 *
 *  - **El precio NO viaja**: «Agregar al pedido» manda el producto, las opciones y la cantidad (texto decimal, nunca número); el precio sale del catálogo en el servidor. `precioAbierto` solo existe para un
 *    producto sin precio cargado y el servidor rechaza uno con precio.
 *  - **El id de la línea lo manda la pantalla** (una vez por intento): repetir con el mismo id es la misma línea.
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

const FORMA_DE_UNIR = z.object({
  unionId: identificador,
  cuentaDestinoId: identificador,
  cuentaOrigenId: identificador,
  clave: texto,
});

/** Una cuenta hija es un número de 1 hasta el máximo por ítems; la pantalla manda una asignación por línea vigente. */
const PARTE = z.number().int().min(1).max(MAXIMO_DE_CUENTAS_POR_ITEMS);
const FORMA_DE_ASIGNACION = z.discriminatedUnion("forma", [
  z.object({ lineaId: identificador, forma: z.literal("ENTERO"), parte: PARTE }),
  z.object({
    lineaId: identificador,
    forma: z.literal("POR_UNIDADES"),
    cantidades: z.array(decimal).min(2).max(MAXIMO_DE_CUENTAS_POR_ITEMS),
  }),
  z.object({
    lineaId: identificador,
    forma: z.literal("COMPARTIDO"),
    partes: z.array(PARTE).min(2).max(MAXIMO_DE_CUENTAS_POR_ITEMS),
  }),
]);
const MAXIMO_DE_LINEAS_A_DIVIDIR = 200;
const FORMA_DE_DIVIDIR = z.object({
  divisionId: identificador,
  cuentaId: identificador,
  partes: z.number().int().min(2).max(MAXIMO_DE_CUENTAS_POR_ITEMS),
  asignaciones: z.array(FORMA_DE_ASIGNACION).min(1).max(MAXIMO_DE_LINEAS_A_DIVIDIR),
});

const FORMA_DE_AGREGAR_AL_PEDIDO = z.object({
  cuentaId: identificador,
  lineaId: identificador,
  productoId: identificador,
  varianteId: identificador.optional(),
  opcionIds: z.array(identificador).max(MAXIMO_DE_OPCIONES_POR_LINEA),
  cantidad: decimal,
  precioAbierto: decimal.optional(),
  confirmaciones: z.array(texto).max(10).optional(),
  salida: z.enum(SALIDAS_DE_LINEA).optional(),
  /** La nota libre para la cocina (SAL-G): la forma; el servidor valida el largo y los caracteres. */
  nota: texto.optional(),
});

type Pedido<T> = Resultado<T, ErrorDeEntrada>;

export type PedidoDelMapa = Readonly<{ filtro: FiltroDelMapa }>;
export type PedidoDeTomarPedido = z.output<typeof FORMA_DE_TOMAR_PEDIDO>;
export type PedidoDeUnaCuenta = z.output<typeof FORMA_DE_UNA_CUENTA>;
export type PedidoDeCambiarDeMesa = z.output<typeof FORMA_DE_CAMBIAR_DE_MESA>;
export type PedidoDeUnir = z.output<typeof FORMA_DE_UNIR>;
export type PedidoDeDividir = z.output<typeof FORMA_DE_DIVIDIR>;
export type PedidoDeAgregarAlPedido = z.output<typeof FORMA_DE_AGREGAR_AL_PEDIDO>;

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

export const leerElPedidoDeAgregarAlPedido = (crudo: unknown): Pedido<PedidoDeAgregarAlPedido> =>
  leer(FORMA_DE_AGREGAR_AL_PEDIDO, crudo);

/** «Unir con otra mesa»: el id de la unión y la clave los fija la pantalla una vez por intento; las dos cuentas, el destino y el origen. */
export const leerElPedidoDeUnir = (crudo: unknown): Pedido<PedidoDeUnir> =>
  leer(FORMA_DE_UNIR, crudo);

/** «Dividir la cuenta» por ítems: el id de la división lo fija la pantalla una vez por intento; la sucursal la fija el servidor. */
export const leerElPedidoDeDividir = (crudo: unknown): Pedido<PedidoDeDividir> =>
  leer(FORMA_DE_DIVIDIR, crudo);
