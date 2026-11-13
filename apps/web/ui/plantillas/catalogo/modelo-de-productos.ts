import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import type { TonoDeEstado } from "../../componentes/Insignia";
import { formatearImporte } from "../facturacion/formato-fiscal";
import {
  CLAVE_DE_CLASE,
  direccionDeLaLista,
  type FiltrosDeProductos,
} from "./filtros-de-productos";

/**
 * El modelo de vista de la lista de productos (A1, T1; maqueta aprobada `productos.html`, 12/11/2026, función `vLista`): de lo que entrega la composición, lo que se ve en cada
 * fila y NADA más. Puro: sin React ni servidor. Una fila lleva el nombre, la marca de estado («Desactivado» o «Falta completar», solo cuando corresponde), la clase y el
 * precio (el importe como texto decimal con el formato es-AR, «Según medida» o «Sin precio»; nada si el producto no se vende). Los textos salen del catálogo (`catalogo.*`, con
 * su fuente en `catalogo-catalogo.ts`); no se arma ningún texto nuevo, solo se eligen los aprobados. La fila lleva también el nombre de la sección de la carta (la pantalla dice «clase · sección»,
 * como la maqueta; decisión del dueño 13/11/2026, `decisiones-del-dueno-2026-11.md` fila «Lista de productos (T1): cada fila muestra «clase · sección»»), también si la sección está desactivada.
 * Sin lista de resultados, «Sin resultados» (`catalogo.lista.sin_resultados`; maqueta línea 569; decisión del dueño 13/11/2026, filas «la lista sin resultados muestra «Sin resultados»» y «una búsqueda con texto
 * inválido muestra la lista vacía con «Sin resultados»»). Sin el enlace a la ficha: no es de este tramo.
 */

/** Un producto como lo entrega la composición (la misma forma, sin importar de dónde venga; la UI no importa los módulos). */
export type ProductoDeLaLista = Readonly<{
  id: string;
  nombre: string;
  claseDeUso: string;
  estado: string;
  /** El NOMBRE de la sección de la carta (nunca su id ni otros datos); `null` si el producto no tiene. */
  seccion: string | null;
  precio:
    | Readonly<{ tipo: "EMPRESA"; importe: string }>
    | Readonly<{ tipo: "SEGUN_TAMANO" }>
    | Readonly<{ tipo: "SIN_PRECIO" }>
    | null;
}>;

export type PaginaDeLaLista = Readonly<{
  productos: readonly ProductoDeLaLista[];
  /** La clave de la página que sigue; `null` en la última. */
  siguiente: string | null;
}>;

type FilaDeProducto = Readonly<{
  id: string;
  nombre: string;
  /** La marca de estado; `null` si el producto está activo y completo. */
  marca: Readonly<{ texto: string; tono: TonoDeEstado }> | null;
  clase: string;
  /** El nombre de la sección; `null` si el producto no tiene (la pantalla dice solo la clase). */
  seccion: string | null;
  /** El precio ya formateado; `null` si el producto no se vende. */
  precio: string | null;
}>;

export type ListaArmada = Readonly<{
  filas: readonly FilaDeProducto[];
  /** «Sin resultados» si no hay filas; `null` si las hay. */
  vacio: string | null;
  siguiente: Readonly<{ href: string; texto: string }> | null;
}>;

/** Las marcas de la fila. «Activo» no lleva marca. */
const CLAVE_DE_MARCA: Readonly<Record<string, ClaveDeTexto>> = {
  FALTA_COMPLETAR: "catalogo.estado.falta_completar",
  DESACTIVADO: "catalogo.estado.desactivado",
};

/** Un valor que la pantalla no conoce se dice con el propio valor (nunca se esconde un producto o su estado por no saber nombrarlo). */
const conocido = (
  tabla: Readonly<Record<string, ClaveDeTexto>>,
  valor: string,
): ClaveDeTexto | null => (Object.hasOwn(tabla, valor) ? (tabla[valor] as ClaveDeTexto) : null);

function marcaDe(estado: string, d: DiccionarioResuelto): FilaDeProducto["marca"] {
  if (estado === "ACTIVO") return null;
  const clave = conocido(CLAVE_DE_MARCA, estado);
  return { texto: clave === null ? estado : texto(d, clave), tono: "aviso" };
}

function precioDe(precio: ProductoDeLaLista["precio"], d: DiccionarioResuelto): string | null {
  if (precio === null) return null;
  if (precio.tipo === "EMPRESA") return formatearImporte(precio.importe);
  return texto(
    d,
    precio.tipo === "SEGUN_TAMANO" ? "catalogo.precio.segun_medida" : "catalogo.precio.sin_precio",
  );
}

export function armarLaLista(
  pagina: PaginaDeLaLista,
  filtros: FiltrosDeProductos,
  d: DiccionarioResuelto = {},
): ListaArmada {
  return {
    filas: pagina.productos.map((p) => {
      const claveDeClase = conocido(CLAVE_DE_CLASE, p.claseDeUso);
      return {
        id: p.id,
        nombre: p.nombre,
        marca: marcaDe(p.estado, d),
        clase: claveDeClase === null ? p.claseDeUso : texto(d, claveDeClase),
        seccion: p.seccion,
        precio: precioDe(p.precio, d),
      };
    }),
    vacio: pagina.productos.length === 0 ? texto(d, "catalogo.lista.sin_resultados") : null,
    siguiente:
      pagina.siguiente === null
        ? null
        : {
            href: direccionDeLaLista(filtros, pagina.siguiente),
            texto: texto(d, "fiscal.pantalla.listado_pagina_siguiente"),
          },
  };
}
