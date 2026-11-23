import { z } from "zod";
import type { EntradaDeReordenarSecciones } from "../modulos/catalogo/publico";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import { textoDeBusquedaDeProductoDesdeTexto } from "../primitivas/texto/termino-de-busqueda-de-producto";
import { entero, identificador, leer, texto } from "./entradas-de-facturacion";

/**
 * La entrada de la pantalla «Secciones de la carta» (A8, parte 1): de lo que mandan los formularios y las flechas a lo que aceptan `crearSeccionDeCarta`, `editarSeccionDeCarta`,
 * `desactivarSeccionDeCarta`, `reactivarSeccionDeCarta` y `reordenarSeccionesDeCarta`. Pura: sin base ni servidor.
 *
 * Lista de permitidos: de cada pedido solo se leen las claves que declara su esquema (`z.object` descarta el resto: no se puede mandar la empresa, la persona, el orden ni el estado de la
 * sección), y la empresa y la persona las pone el servidor. Esta capa dice si el dato tiene la FORMA pedida; qué es un nombre válido y cuántas secciones admite una carta lo decide el dominio
 * dentro de la transacción (el largo y el conjunto permitido viven una vez, en su primitiva).
 *
 * Tres reglas:
 *  - **La clave de creación es el `id` de la sección** (idempotencia: el mismo `id` y el mismo contenido devuelven la sección ya creada, sin duplicar). La fija la página, no el navegador.
 *  - **El `orden` de una sección nueva lo calcula el servidor** (`ordenDeLaSeccionNueva`): el mayor de la lista más uno; si el `id` ya está creado, el que ya tiene. Previene: que repetir
 *    la creación (doble toque, reintento por red cortada) calcule otro orden y el caso de uso la rechace como `ID_REUTILIZADO`.
 *  - **Reordenar lleva TODAS las activas con la versión que la persona vio**: el caso de uso rechaza si falta una, si una versión cambió o si una se repite; acá solo se pide la forma.
 *    El orden nuevo lo arma `entradaDeReordenar` desde esa lista (un toque cambia a la sección con su vecina; en la primera o la última, el mismo orden: el caso de uso lo ve como
 *    ya aplicado). Previene: que dos toques seguidos o un reintento con la misma lista dejen el orden en otro lugar (el orden se calcula de lo que la persona vio, no de lo vigente).
 * Parte 2 (agregar y quitar productos de una sección), dos reglas más:
 *  - **El producto tocado y su versión salen de lo que la persona vio** (`versionVistaDelProducto`): el pedido trae los productos de la página con su versión (ligados por la página, no en un campo) y
 *    cuál se tocó; una versión que la persona no vio no se inventa (`null`: el genérico). Previene: que un botón armado a mano mande la versión de otro producto o una cualquiera.
 *  - **La búsqueda de candidatos pasa por la primitiva de búsqueda de productos** (`leerLaBusquedaDeCandidatos`): el texto y la página se aceptan solo con la forma que esa primitiva permite; algo
 *    inválido no ensancha el filtro (`null`: lista vacía). Previene: un filtro libre que llega sin validar a la consulta.
 * Chequeo: `entradas-de-secciones.test.ts`.
 */

const FORMA_DE_CREAR = z.object({ claveDeCreacion: identificador, nombre: texto });
const FORMA_DE_RENOMBRAR = z.object({
  seccionId: identificador,
  versionEsperada: entero,
  nombre: texto,
});
const FORMA_DE_UNA_SECCION = z.object({ seccionId: identificador });
/**
 * Un toque de flecha: las secciones activas como la persona las vio (en su orden y con su versión), cuál tocó y hacia dónde. Una cota de FORMA (que no sea una lista enorme): cuántas
 * secciones admite una carta lo decide `reordenarSeccionesDeCarta`.
 */
const FORMA_DE_MOVER = z.object({
  vistas: z.array(z.object({ seccionId: identificador, versionEsperada: entero })).max(500),
  seccionId: identificador,
  sentido: z.enum(["ARRIBA", "ABAJO"]),
});

/**
 * Un toque sobre un producto de una sección («Agregar» o «Quitar»): los productos de la página como la persona los vio (con su versión), cuál tocó y de qué sección. Una cota de FORMA (que no
 * sea una lista enorme): las páginas son de 50.
 */
const FORMA_DE_TOCAR_PRODUCTO = z.object({
  seccionId: identificador,
  vistas: z.array(z.object({ productoId: identificador, versionEsperada: entero })).max(500),
  productoId: identificador,
});
/** La búsqueda de candidatos de una sección: lo que dice la dirección (texto y página), sin validar. */
const FORMA_DE_LA_BUSQUEDA = z.object({ seccionId: identificador, texto, despues: texto });

export type PedidoDeCrearSeccion = z.output<typeof FORMA_DE_CREAR>;
export type PedidoDeRenombrarSeccion = z.output<typeof FORMA_DE_RENOMBRAR>;
export type PedidoDeUnaSeccion = z.output<typeof FORMA_DE_UNA_SECCION>;
export type PedidoDeMover = z.output<typeof FORMA_DE_MOVER>;
export type PedidoDeTocarProducto = z.output<typeof FORMA_DE_TOCAR_PRODUCTO>;
export type PedidoDeLaBusqueda = z.output<typeof FORMA_DE_LA_BUSQUEDA>;

type Pedido<T> = Resultado<T, "PEDIDO_INVALIDO">;

function leido<T>(esquema: z.ZodType<T>, crudo: unknown): Pedido<T> {
  const forma = leer(esquema, crudo);
  return forma.ok ? forma : err("PEDIDO_INVALIDO");
}

/** El pedido, o `"PEDIDO_INVALIDO"` si no tiene la forma pedida (sin decir cuál campo ni el valor recibido). */
export const leerElPedidoDeCrearSeccion = (crudo: unknown): Pedido<PedidoDeCrearSeccion> =>
  leido(FORMA_DE_CREAR, crudo);
export const leerElPedidoDeRenombrarSeccion = (crudo: unknown): Pedido<PedidoDeRenombrarSeccion> =>
  leido(FORMA_DE_RENOMBRAR, crudo);
export const leerElPedidoDeUnaSeccion = (crudo: unknown): Pedido<PedidoDeUnaSeccion> =>
  leido(FORMA_DE_UNA_SECCION, crudo);
export const leerElPedidoDeMover = (crudo: unknown): Pedido<PedidoDeMover> =>
  leido(FORMA_DE_MOVER, crudo);
export const leerElPedidoDeTocarProducto = (crudo: unknown): Pedido<PedidoDeTocarProducto> =>
  leido(FORMA_DE_TOCAR_PRODUCTO, crudo);

/** Lo que la persona vio del producto que tocó: su id y su versión; `null` si no estaba entre lo que vio. */
export function versionVistaDelProducto(
  pedido: PedidoDeTocarProducto,
): Readonly<{ productoId: string; versionEsperada: number }> | null {
  const vista = pedido.vistas.find((v) => v.productoId === pedido.productoId);
  return vista === undefined
    ? null
    : { productoId: vista.productoId, versionEsperada: vista.versionEsperada };
}

/**
 * La búsqueda de candidatos: la sección y, si el texto es un texto de búsqueda válido, el texto (`undefined` si está vacío: sin filtro) y el texto de la página (`""` es la primera); `consulta` es
 * `null` si el texto no es válido (nada puede coincidir: lista vacía). `PEDIDO_INVALIDO` si no tiene la forma pedida.
 */
export type BusquedaDeCandidatos = Readonly<{
  seccionId: string;
  consulta: Readonly<{ texto: string | undefined; despues: string }> | null;
}>;

export function leerLaBusquedaDeCandidatos(crudo: unknown): Pedido<BusquedaDeCandidatos> {
  const forma = leido(FORMA_DE_LA_BUSQUEDA, crudo);
  if (!forma.ok) return forma;
  const { seccionId, texto: escrito, despues } = forma.valor;
  const buscado = textoDeBusquedaDeProductoDesdeTexto(escrito);
  return ok({
    seccionId,
    consulta: buscado.ok ? { texto: buscado.valor ?? undefined, despues } : null,
  });
}

/**
 * El `orden` con el que se crea una sección: el mayor de la lista más uno (0 si no hay ninguna), salvo que el `id` ya esté en la lista (la misma creación repetida): entonces el que ya
 * tiene, así el caso de uso la ve igual y devuelve `yaExistia` en vez de rechazarla.
 */
export function ordenDeLaSeccionNueva(
  existentes: readonly Readonly<{ id: string; orden: number }>[],
  id: string,
): number {
  const ya = existentes.find((s) => s.id === id);
  if (ya !== undefined) return ya.orden;
  return existentes.reduce((mayor, s) => Math.max(mayor, s.orden), -1) + 1;
}

/**
 * El pedido a `reordenarSeccionesDeCarta`: la misma lista con la sección tocada un lugar más arriba o más abajo (en la primera o la última se queda donde está); `null` si la sección
 * tocada no está en lo que la persona vio.
 */
export function entradaDeReordenar(pedido: PedidoDeMover): EntradaDeReordenarSecciones | null {
  const desde = pedido.vistas.findIndex((s) => s.seccionId === pedido.seccionId);
  if (desde === -1) return null;
  // `splice` con un lugar más allá del final agrega al final: no hace falta acotar por abajo ni por arriba más que el principio.
  const hasta = Math.max(desde + (pedido.sentido === "ARRIBA" ? -1 : 1), 0);
  const secciones = [...pedido.vistas];
  const [tocada] = secciones.splice(desde, 1) as [(typeof secciones)[number]];
  secciones.splice(hasta, 0, tocada);
  return { secciones };
}
