import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * Los filtros de la lista de productos (A1, T1; maqueta aprobada `productos.html`, 12/11/2026): lo que dice la dirección (buscar, «¿Qué es?» y estado), la dirección de cada
 * página y el formulario armado con sus textos. Puro: sin React ni servidor. Los textos salen del catálogo (`catalogo.*`, con su fuente en `catalogo-catalogo.ts`); «Estado»,
 * «Activo», «Aplicar filtros» y «Página siguiente» son los ya aprobados de fiscal y caja (reutilizados sin cambio). La validez de cada filtro la decide el servidor
 * (`src/composicion/entradas-de-productos.ts`): acá solo se lee lo que la dirección trae y se vuelve «Todos» lo que no es una opción conocida, para que lo que se ve y lo que
 * se pidió coincidan. Previene: una opción de la lista sin su texto (una prueba compara estas listas con las del módulo y de la composición).
 */

export const RUTA_DE_PRODUCTOS = "/catalogo/productos";

/** Las cinco clases, en el orden de la maqueta (`CLASES`), cada una con la clave de su texto. */
export const CLAVE_DE_CLASE = {
  MATERIA_PRIMA: "catalogo.clase.materia_prima",
  INSUMO: "catalogo.clase.insumo",
  REVENTA: "catalogo.clase.reventa",
  ELABORADO: "catalogo.clase.elaborado",
  VENDIBLE: "catalogo.clase.vendible",
} as const satisfies Readonly<Record<string, ClaveDeTexto>>;
export type ClaseDelFiltro = keyof typeof CLAVE_DE_CLASE;

/** Los tres estados que ofrece el filtro; «Activo» no se marca en la fila (la maqueta marca solo «Desactivado» y «Falta completar»). */
const CLAVE_DE_ESTADO = {
  ACTIVO: "caja.estado.activo",
  FALTA_COMPLETAR: "catalogo.estado.falta_completar",
  DESACTIVADO: "catalogo.estado.desactivado",
} as const satisfies Readonly<Record<string, ClaveDeTexto>>;
export type EstadoDelFiltro = keyof typeof CLAVE_DE_ESTADO;

export const CLASES_DEL_FILTRO = Object.keys(CLAVE_DE_CLASE) as readonly ClaseDelFiltro[];
export const ESTADOS_DEL_FILTRO = Object.keys(CLAVE_DE_ESTADO) as readonly EstadoDelFiltro[];

/** Vacío es «sin filtrar» (Todos). */
export type FiltrosDeProductos = Readonly<{
  texto: string;
  clase: ClaseDelFiltro | "";
  estado: EstadoDelFiltro | "";
}>;

export const FILTROS_POR_DEFECTO: FiltrosDeProductos = { texto: "", clase: "", estado: "" };

type ParametrosDeLaDireccion = Readonly<Record<string, string | readonly string[] | undefined>>;

const primero = (params: ParametrosDeLaDireccion, nombre: string): string => {
  const valor = params[nombre];
  return (
    (Array.isArray(valor) ? (valor[0] as string | undefined) : (valor as string | undefined)) ?? ""
  );
};

const deLaLista = <T extends string>(valor: string, lista: readonly T[]): T | "" =>
  lista.find((permitido) => permitido === valor) ?? "";

/** Los filtros de la dirección, con lo que no es una opción conocida vuelto a «Todos». El texto se recorta; su validez es del servidor. */
export function leerLosFiltros(params: ParametrosDeLaDireccion): FiltrosDeProductos {
  return {
    texto: primero(params, "texto").trim(),
    clase: deLaLista(primero(params, "clase"), CLASES_DEL_FILTRO),
    estado: deLaLista(primero(params, "estado"), ESTADOS_DEL_FILTRO),
  };
}

/** La clave de la página que sigue, tal como la dio la consulta; `""` en la primera. */
export const leerLaPagina = (params: ParametrosDeLaDireccion): string => primero(params, "despues");

/** La dirección de la lista con estos filtros (solo los que se apartan de «Todos») y, si sigue, la página. */
export function direccionDeLaLista(filtros: FiltrosDeProductos, despues: string | null): string {
  const pares: [string, string][] = [];
  if (filtros.texto !== "") pares.push(["texto", filtros.texto]);
  if (filtros.clase !== "") pares.push(["clase", filtros.clase]);
  if (filtros.estado !== "") pares.push(["estado", filtros.estado]);
  if (despues !== null) pares.push(["despues", despues]);
  return pares.length === 0
    ? RUTA_DE_PRODUCTOS
    : `${RUTA_DE_PRODUCTOS}?${new URLSearchParams(pares).toString()}`;
}

type OpcionDeLista = Readonly<{ valor: string; etiqueta: string }>;

/** Lo que el formulario de filtros necesita, con todos los textos ya resueltos (un componente de cliente no arma textos). */
export type FiltrosArmados = Readonly<{
  accion: string;
  valores: FiltrosDeProductos;
  textos: Readonly<{
    buscar: string;
    clase: string;
    estado: string;
    todos: string;
    aplicar: string;
  }>;
  clases: readonly OpcionDeLista[];
  estados: readonly OpcionDeLista[];
}>;

export function armarLosFiltros(
  filtros: FiltrosDeProductos,
  d: DiccionarioResuelto = {},
): FiltrosArmados {
  return {
    accion: RUTA_DE_PRODUCTOS,
    valores: filtros,
    textos: {
      buscar: texto(d, "catalogo.lista.buscar"),
      clase: texto(d, "catalogo.lista.que_es"),
      estado: texto(d, "fiscal.pantalla.listado_rotulo_estado"),
      todos: texto(d, "catalogo.lista.todos"),
      aplicar: texto(d, "fiscal.pantalla.listado_aplicar"),
    },
    clases: CLASES_DEL_FILTRO.map((c) => ({ valor: c, etiqueta: texto(d, CLAVE_DE_CLASE[c]) })),
    estados: ESTADOS_DEL_FILTRO.map((e) => ({ valor: e, etiqueta: texto(d, CLAVE_DE_ESTADO[e]) })),
  };
}
