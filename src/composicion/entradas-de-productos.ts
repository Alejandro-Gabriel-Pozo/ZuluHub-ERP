import {
  esClaseDeUso,
  type ConsultasDeCatalogo,
  type EstadoDeProducto,
} from "../modulos/catalogo/publico";
import { textoDeBusquedaDeProductoDesdeTexto } from "../primitivas/texto/termino-de-busqueda-de-producto";

/**
 * La entrada de la lista de productos (A1, T1): de lo que pide la dirección de la pantalla (todo texto) a lo que acepta `listarProductos`. Pura: sin base ni servidor.
 *
 * Lista de permitidos: pasa solo lo que cada filtro declara. El texto, lo que la primitiva de búsqueda de productos permite; la clase, una de las cinco; el estado, uno de los tres;
 * la página, el par (id, clave del nombre) que dio la consulta. Lo que no pasa devuelve `null` («nada puede coincidir»): ningún nombre de producto tiene un carácter que la búsqueda
 * rechaza, ni una clase o un estado que no existen, ni se llega a una página que la consulta no dio. Nunca se ensancha el filtro (un filtro inválido que se ignorara mostraría todo).
 * Previene: un id con forma inválida que llega al `::uuid` de la consulta (una excepción de la base) y un filtro libre que llega sin validar.
 * Chequeo: `entradas-de-productos.test.ts`.
 */

/** Lo que la dirección pide, sin validar. Vacío es «sin filtrar» (y «primera página»). */
export type EntradaDeLaLista = Readonly<{
  texto: string;
  clase: string;
  estado: string;
  despues: string;
}>;

type EntradaDeLaConsulta = NonNullable<Parameters<ConsultasDeCatalogo["listarProductos"]>[1]>;
type PaginaDePedido = NonNullable<EntradaDeLaConsulta["despuesDe"]>;

/** Los tres estados de una fila, en el orden de la lista. Una prueba los compara con el tipo del módulo (`EstadoDeProducto`). */
export const ESTADOS_DE_PRODUCTO = [
  "ACTIVO",
  "FALTA_COMPLETAR",
  "DESACTIVADO",
] as const satisfies readonly EstadoDeProducto[];

/**
 * Cómo se pide cada estado a la consulta, que filtra por dos marcas (`activo` y `faltaCompletar`). El estado de una fila se deduce igual que en la consulta:
 * desactivado manda sobre «falta completar» (un desactivado que además falta completar es «Desactivado»).
 */
const FILTRO_DE_ESTADO = {
  ACTIVO: { activo: true, faltaCompletar: false },
  FALTA_COMPLETAR: { activo: true, faltaCompletar: true },
  DESACTIVADO: { activo: false },
} as const satisfies Readonly<
  Record<EstadoDeProducto, Pick<EntradaDeLaConsulta, "activo" | "faltaCompletar">>
>;

const esEstado = (valor: string): valor is (typeof ESTADOS_DE_PRODUCTO)[number] =>
  (ESTADOS_DE_PRODUCTO as readonly string[]).includes(valor);

/** El id del producto (36 caracteres) y el `:` que lo separa de la clave del nombre. */
const ID_Y_SEPARADOR = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):/;

/** La clave de la página que sigue, tal como va en la dirección: el id (36 caracteres) y, después de `:`, la clave del nombre. */
export const codificarLaPagina = (pagina: PaginaDePedido): string =>
  `${pagina.id}:${pagina.nombreClave}`;

/**
 * La página que dice una clave de la dirección, o `null` si no es una que la consulta pudo dar: el id con su forma, y la clave del nombre no vacía; la clave es
 * minúscula NFC de un nombre y por eso pasa por la misma lista de permitidos que la búsqueda y vuelve idéntica.
 */
export function leerLaPagina(clave: string): PaginaDePedido | null {
  const partes = ID_Y_SEPARADOR.exec(clave);
  if (partes === null) return null;
  const id = partes[1] as string;
  const nombreClave = clave.slice(partes[0].length);
  const leida = textoDeBusquedaDeProductoDesdeTexto(nombreClave);
  return leida.ok && leida.valor === nombreClave ? { id, nombreClave } : null;
}

/** Lo que acepta la consulta, o `null` si nada puede coincidir con lo pedido (ver arriba). */
export function leerLaEntradaDeLaLista(entrada: EntradaDeLaLista): EntradaDeLaConsulta | null {
  const texto = textoDeBusquedaDeProductoDesdeTexto(entrada.texto);
  if (!texto.ok) return null;
  const { clase, estado, despues } = entrada;
  const claseDeUso = clase === "" ? undefined : esClaseDeUso(clase) ? clase : null;
  const deEstado = estado === "" ? {} : esEstado(estado) ? FILTRO_DE_ESTADO[estado] : null;
  const pagina = despues === "" ? undefined : leerLaPagina(despues);
  if (claseDeUso === null || deEstado === null || pagina === null) return null;
  return {
    ...(texto.valor === null ? {} : { texto: texto.valor }),
    ...(claseDeUso === undefined ? {} : { claseDeUso }),
    ...deEstado,
    ...(pagina === undefined ? {} : { despuesDe: pagina }),
  };
}
