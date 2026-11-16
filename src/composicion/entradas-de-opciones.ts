import { z } from "zod";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { decimal, entero, identificador, leer, texto } from "./entradas-de-facturacion";

/**
 * Las entradas de las opciones de un producto (A13, tramo Opciones): de lo que manda la pantalla a lo que entiende la composición. Puras: sin base ni servidor.
 *
 * Lista de permitidos: de cada pedido solo se leen las claves que declara su esquema (`z.object` descarta el resto: no se puede mandar la empresa, la persona, el orden de los
 * grupos ni la clase de un grupo que ya existe, que decide el servidor). Esta capa dice si el dato tiene la FORMA pedida; qué es un nombre o un recargo válido lo deciden las
 * primitivas dentro del caso de uso, y el recargo sigue siendo TEXTO de punta a punta (ADR-006).
 *  - `claveDelCambio`: la clave de idempotencia; la fija la página al armarse, no el formulario. Es el id del grupo nuevo y de ella se derivan los ids de las opciones nuevas,
 *    así el doble toque y el reintento mandan lo mismo y el caso de uso lo reconoce como «ya estaba».
 *  - `versionDeOpciones`: la que la persona vio al abrir la pantalla; con otra, el caso de uso rechaza sin escribir.
 *  - Una opción lleva `id` si ya existía (lo ligó la página; el formulario no lo manda) o `null` si es nueva.
 * Chequeo: `entradas-de-opciones.test.ts`.
 */

/** Cuántas opciones admite un grupo en una sola pantalla: una cota de forma para no leer un pedido enorme (las reglas de negocio las pone el dominio). */
const MAXIMO_DE_OPCIONES_POR_PEDIDO = 100;

/** La clave de una fila en el formulario (`e<i>` o `n<j>`): sirve para apuntarle un error; no es un dato del negocio. */
const CLAVE_DE_FILA = z.string().regex(/^[en]\d{1,3}$/);

const FORMA_DE_UNA_OPCION = z.object({
  clave: CLAVE_DE_FILA,
  id: identificador.nullable(),
  nombre: texto,
  recargo: decimal,
});

const FORMA_DEL_PEDIDO_DE_GRUPO = z.object({
  productoId: identificador,
  versionDeOpciones: entero,
  claveDelCambio: identificador,
  /** El grupo que se edita; `null` = un grupo nuevo (su id es la clave del cambio). */
  grupoId: identificador.nullable(),
  nombre: texto,
  /** `true`: es la variante del producto (la medida), no un grupo de opciones. No se cambia en un grupo que ya existe. */
  esVariante: z.boolean(),
  /** Solo de la variante: si es la medida. */
  esTamano: z.boolean(),
  /** Solo cuenta al crear: la clase de un grupo que ya existe no se cambia. */
  esAdicional: z.boolean(),
  esObligatorio: z.boolean(),
  admiteVarias: z.boolean(),
  seMuestraEnCarta: z.boolean(),
  opciones: z.array(FORMA_DE_UNA_OPCION).max(MAXIMO_DE_OPCIONES_POR_PEDIDO),
});

const FORMA_DEL_PEDIDO_DE_COPIA = z.object({
  productoDestinoId: identificador,
  productoOrigenId: identificador,
  versionDeOpciones: entero,
  claveDelCambio: identificador,
});

export type OpcionPedidaDeLaPantalla = z.output<typeof FORMA_DE_UNA_OPCION>;
export type PedidoDeGrupo = z.output<typeof FORMA_DEL_PEDIDO_DE_GRUPO>;
export type PedidoDeCopia = z.output<typeof FORMA_DEL_PEDIDO_DE_COPIA>;

/** El pedido de guardar un grupo, o `"PEDIDO_INVALIDO"` si no tiene la forma pedida (sin decir cuál campo ni el valor recibido). */
export function leerElPedidoDeGrupo(crudo: unknown): Resultado<PedidoDeGrupo, "PEDIDO_INVALIDO"> {
  const forma = leer(FORMA_DEL_PEDIDO_DE_GRUPO, crudo);
  return forma.ok ? forma : err("PEDIDO_INVALIDO");
}

/** El pedido de copiar las opciones de otro producto, o `"PEDIDO_INVALIDO"` si no tiene la forma pedida. */
export function leerElPedidoDeCopia(crudo: unknown): Resultado<PedidoDeCopia, "PEDIDO_INVALIDO"> {
  const forma = leer(FORMA_DEL_PEDIDO_DE_COPIA, crudo);
  return forma.ok ? forma : err("PEDIDO_INVALIDO");
}

/**
 * Cómo se llama cada campo de una fila de opciones en el formulario: `opcion_<clave>_nombre` y `opcion_<clave>_recargo` (con guion bajo: es la forma de un campo de error, ver
 * `respuesta.ts`). La clave es `e<i>` (la opción que ya existía, la i-ésima ligada por la página) o `n<j>` (una nueva).
 */
export const nombreDeCampoDeOpcion = (clave: string, campo: "nombre" | "recargo"): string =>
  `opcion_${clave}_${campo}`;

const CAMPO_DE_OPCION = /^opcion_(e\d{1,3}|n\d{1,3})_(nombre|recargo)$/;

/**
 * Las filas de opciones que mandó el formulario, en el orden en que aparecen (el del formulario). Una fila `e<i>` es la opción que la página ligó en la posición i de `idsLigados`;
 * una `e<i>` que no apunta a ninguna (más allá de lo ligado) no existe y se descarta, igual que todo campo cuyo nombre no tiene la forma pedida: lo que no se declara no se lee. Una fila
 * sin recargo trae el texto vacío (lo rechaza el dominio); una fila repetida conserva el primer valor de cada campo.
 */
export function leerLasFilasDeOpciones(
  campos: Iterable<readonly [string, unknown]>,
  idsLigados: readonly string[],
): readonly OpcionPedidaDeLaPantalla[] {
  const filas = new Map<string, { nombre?: string; recargo?: string }>();
  for (const [nombre, valor] of campos) {
    const partes = CAMPO_DE_OPCION.exec(nombre);
    if (partes === null || typeof valor !== "string") continue;
    const clave = partes[1] as string;
    const campo = partes[2] as "nombre" | "recargo";
    const fila = filas.get(clave) ?? {};
    fila[campo] ??= valor;
    filas.set(clave, fila);
  }
  const salida: OpcionPedidaDeLaPantalla[] = [];
  for (const [clave, fila] of filas) {
    const existente = clave.startsWith("e");
    const id = existente ? (idsLigados[Number(clave.slice(1))] ?? undefined) : null;
    if (id === undefined) continue;
    salida.push({ clave, id, nombre: fila.nombre ?? "", recargo: fila.recargo ?? "" });
  }
  return salida;
}
