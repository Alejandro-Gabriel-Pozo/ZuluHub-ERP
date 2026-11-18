import { z } from "zod";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { entero, identificador, leer, texto } from "./entradas-de-facturacion";

/**
 * La entrada de la pantalla «Carta en línea» (C1): de lo que mandan los formularios a lo que aceptan las acciones de la carta. Pura: sin base ni servidor.
 *
 * Lista de permitidos: de cada pedido solo se leen las claves que declara su esquema (`z.object` descarta el resto): NO se puede mandar la empresa, la persona,
 * el código de la carta, el estado ni el mensaje de portada. La sucursal la pone el servidor (la elegida en el dispositivo, validada); acá solo viaja para compararla
 * con la que la página mostró. Esta capa dice si el dato tiene la FORMA pedida; qué es un nombre, un rubro o un lugar válido lo decide el dominio (el largo y el
 * conjunto permitido viven una vez, en `datos-de-carta-publica.ts`).
 *
 * Dos pedidos:
 *  - **Guardar los textos.** Lleva la clave de la carta (`cartaId`: la que fijó la página; para una carta nueva es la clave de creación, y repetir el alta con la misma
 *    clave devuelve la carta ya creada) y, si la carta ya existía, la versión que la persona vio. Previene: dos cartas por un doble toque, y pisar un cambio ajeno.
 *  - **Poner en línea / sacar de línea.** Lleva la carta, la versión vista y el estado pedido: pide un ESTADO, no alterna. Previene: que dos «Poner en línea» seguidos
 *    (o un reintento) saquen la carta que el otro acaba de poner.
 * Chequeo: `entradas-de-carta-en-linea.test.ts`.
 */

const FORMA_DE_GUARDAR = z.object({
  cartaId: identificador,
  sucursalId: identificador,
  versionEsperada: entero.nullable(),
  nombre: texto,
  rubro: texto,
  lugar: texto,
});
const FORMA_DE_CAMBIAR_EL_ESTADO = z.object({
  cartaId: identificador,
  sucursalId: identificador,
  versionEsperada: entero,
  estado: z.enum(["EN_LINEA", "FUERA_DE_LINEA"]),
});

export type PedidoDeGuardarLaCarta = z.output<typeof FORMA_DE_GUARDAR>;
export type PedidoDeCambiarElEstadoDeLaCarta = z.output<typeof FORMA_DE_CAMBIAR_EL_ESTADO>;

type Pedido<T> = Resultado<T, "PEDIDO_INVALIDO">;

function leido<T>(esquema: z.ZodType<T>, crudo: unknown): Pedido<T> {
  const forma = leer(esquema, crudo);
  return forma.ok ? forma : err("PEDIDO_INVALIDO");
}

/** El pedido, o `"PEDIDO_INVALIDO"` si no tiene la forma pedida (sin decir cuál campo ni el valor recibido). */
export const leerElPedidoDeGuardarLaCarta = (crudo: unknown): Pedido<PedidoDeGuardarLaCarta> =>
  leido(FORMA_DE_GUARDAR, crudo);
export const leerElPedidoDeCambiarElEstadoDeLaCarta = (
  crudo: unknown,
): Pedido<PedidoDeCambiarElEstadoDeLaCarta> => leido(FORMA_DE_CAMBIAR_EL_ESTADO, crudo);
