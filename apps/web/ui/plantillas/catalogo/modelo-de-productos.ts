import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import type { TonoDeEstado } from "../../componentes/Insignia";
import { formatearImporte } from "../facturacion/formato-fiscal";
import {
  CLAVE_DE_CLASE,
  RUTA_DEL_ALTA_DE_PRODUCTO,
  direccionDeLaLista,
  type FiltrosDeProductos,
} from "./filtros-de-productos";

/**
 * El modelo de vista de la lista de productos (A1, T1; maqueta aprobada `productos.html`, 12/11/2026, función `vLista`): de lo que entrega la composición, lo que se ve en cada
 * fila y NADA más. Puro: sin React ni servidor. Una fila lleva el nombre, la marca de estado («Desactivado» o «Falta completar», solo cuando corresponde), la clase y el
 * precio (el importe como texto decimal con el formato es-AR, «Según medida» o «Sin precio»; nada si el producto no se vende). Los textos salen del catálogo (`catalogo.*`, con
 * su fuente en `catalogo-catalogo.ts`); no se arma ningún texto nuevo, solo se eligen los aprobados. Sin la sección de la carta ni el enlace a la ficha: no son de este tramo.
 */

/** Un producto como lo entrega la composición (la misma forma, sin importar de dónde venga; la UI no importa los módulos). */
export type ProductoDeLaLista = Readonly<{
  id: string;
  nombre: string;
  claseDeUso: string;
  estado: string;
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
  /** El precio ya formateado; `null` si el producto no se vende. */
  precio: string | null;
}>;

export type ListaArmada = Readonly<{
  filas: readonly FilaDeProducto[];
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

/**
 * «Nuevo producto» (maqueta `productos.html`, 12/11/2026; decisión del dueño, 13/11/2026): el enlace al alta SOLO si el servidor ya resolvió que la persona puede crear
 * (`productos.crear`). Todo lo que no sea exactamente `true` (falso, ausente, dudoso) no lo muestra: nace cerrado. Ocultar no es autorizar: el alta vuelve a pasar por el guard.
 */
export function armarElEnlaceDeAlta(
  puedeCrear: boolean | undefined,
  d: DiccionarioResuelto = {},
): Readonly<{ href: string; texto: string }> | null {
  return puedeCrear === true
    ? { href: RUTA_DEL_ALTA_DE_PRODUCTO, texto: texto(d, "catalogo.lista.nuevo") }
    : null;
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
        precio: precioDe(p.precio, d),
      };
    }),
    siguiente:
      pagina.siguiente === null
        ? null
        : {
            href: direccionDeLaLista(filtros, pagina.siguiente),
            texto: texto(d, "fiscal.pantalla.listado_pagina_siguiente"),
          },
  };
}
