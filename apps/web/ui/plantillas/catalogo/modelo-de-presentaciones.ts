import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { formatearCantidadConUnidad } from "../../patrones/formato-fiscal";
import { RUTA_DE_PRODUCTOS } from "./filtros-de-productos";

/**
 * El modelo de vista de la solapa «Cómo se compra» de un producto (T0; maqueta `presentaciones.html`): de lo que entrega la composición, lo que se ve en la lista y en los formularios de agregar y
 * editar una presentación, y NADA más. Puro: sin React ni servidor. Los textos salen del catálogo (`catalogo.presentacion.*` y los ya aprobados, con su fuente en `catalogo-catalogo.ts`); no se arma
 * ningún texto nuevo, solo se eligen los aprobados.
 *
 * Reglas (cada una con su prueba en `test/web/presentaciones-modelo.test.ts`):
 *  - **Lo que cambia algo sale solo si la persona puede editar** (`puedeEditarProductos`, solo una ayuda: el guard decide): sin permiso «Agregar presentación», «Editar», «Guardar» y «Desactivar» /
 *    «Reactivar» salen APAGADOS, no escondidos. Todo lo que no sea exactamente `true` cierra.
 *  - **La cantidad sale con su unidad base** («5 kg») y con «≈» si es de peso variable: es solo el peso aproximado, para pedir y estimar. En la edición la cantidad se ve y no se cambia («otra cantidad
 *    es otra presentación»).
 *  - **Las desactivadas se ven**, con «Desactivado», para poder reactivarlas.
 */

/** Las direcciones de la solapa: sigue el patrón de `/catalogo/productos/[id]/opciones`. */
export const rutaDeLaCompraDelProducto = (id: string): string =>
  `${RUTA_DE_PRODUCTOS}/${id}/compra`;
export const rutaDeLaPresentacionNueva = (id: string): string =>
  `${rutaDeLaCompraDelProducto(id)}/nueva`;
export const rutaDeLaPresentacion = (productoId: string, presentacionId: string): string =>
  `${rutaDeLaCompraDelProducto(productoId)}/${presentacionId}`;

/** Una presentación como la entrega la composición (la misma forma, sin importar de dónde venga; la UI no importa los módulos). */
export type PresentacionDeLaLista = Readonly<{
  id: string;
  nombre: string;
  /** Texto decimal de 4 decimales, en la unidad base del producto. */
  cantidad: string;
  dePesoVariable: boolean;
  activa: boolean;
  version: number;
}>;

export type ProductoDeLasPresentaciones = Readonly<{
  id: string;
  nombre: string;
  /** El símbolo de la unidad base («kg»); `null` si no se pudo leer. */
  unidadBase: string | null;
  activo: boolean;
}>;

export type PresentacionesDeLaPantalla = Readonly<{
  producto: ProductoDeLasPresentaciones;
  presentaciones: readonly PresentacionDeLaLista[];
}>;

const puede = (puedeEditar: boolean | undefined): boolean => puedeEditar === true;

/** «5 kg», o «≈ 4 kg» con peso variable. */
function cantidadParaVer(p: PresentacionDeLaLista, unidad: string | null): string {
  const base = formatearCantidadConUnidad(p.cantidad, unidad);
  return p.dePesoVariable ? `≈ ${base}` : base;
}

type FilaDePresentacion = Readonly<{
  id: string;
  nombre: string;
  cantidad: string;
  /** «De peso variable», o `null`. */
  marcaDePesoVariable: string | null;
  /** «Desactivado», o `null`. */
  marcaDeDesactivada: string | null;
  editar: Readonly<{ href: string; texto: string; apagado: boolean }>;
}>;

export type ListaDePresentacionesArmada = Readonly<{
  titulo: string;
  filas: readonly FilaDePresentacion[];
  /** «Sin presentaciones» si no hay ninguna; `null` si hay. */
  vacia: string | null;
  agregar: Readonly<{ href: string; texto: string; apagado: boolean }>;
}>;

export function armarLaListaDePresentaciones(
  dato: PresentacionesDeLaPantalla,
  puedeEditar: boolean | undefined,
  d: DiccionarioResuelto = {},
): ListaDePresentacionesArmada {
  const apagado = !puede(puedeEditar);
  return {
    titulo: texto(d, "compras.compra.como_se_compra"),
    filas: dato.presentaciones.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      cantidad: cantidadParaVer(p, dato.producto.unidadBase),
      marcaDePesoVariable: p.dePesoVariable
        ? texto(d, "catalogo.presentacion.peso_variable")
        : null,
      marcaDeDesactivada: p.activa ? null : texto(d, "catalogo.estado.desactivado"),
      editar: {
        href: rutaDeLaPresentacion(dato.producto.id, p.id),
        texto: texto(d, "catalogo.accion.editar"),
        apagado,
      },
    })),
    vacia: dato.presentaciones.length === 0 ? texto(d, "catalogo.presentacion.vacia") : null,
    agregar: {
      href: rutaDeLaPresentacionNueva(dato.producto.id),
      texto: texto(d, "catalogo.presentacion.agregar"),
      apagado,
    },
  };
}

export type FormularioDePresentacionArmado = Readonly<{
  /** `ALTA`: nombre, cantidad y «De peso variable». `EDICION`: solo el nombre; la cantidad se ve sin campo. */
  modo: "ALTA" | "EDICION";
  titulo: string;
  nombre: Readonly<{ etiqueta: string; valorInicial: string }>;
  /** Los dos rótulos de la misma cantidad (con el símbolo de la unidad base): el de siempre y el de peso variable. */
  cantidad: Readonly<{ etiqueta: string; etiquetaDePesoAproximado: string }>;
  pesoVariable: Readonly<{ etiqueta: string }>;
  /** Solo en la edición: lo que ya tiene, para mostrarlo sin campo. */
  actual: Readonly<{ rotulo: string; valor: string; marca: string | null }> | null;
  guardar: string;
  cancelar: Readonly<{ href: string; texto: string }>;
  puedeGuardar: boolean;
}>;

/** El formulario de agregar (`presentacion === null`) o de editar el nombre de una presentación. «Cancelar» vuelve a la lista. */
export function armarElFormularioDePresentacion(
  producto: ProductoDeLasPresentaciones,
  presentacion: PresentacionDeLaLista | null,
  puedeEditar: boolean | undefined,
  d: DiccionarioResuelto = {},
): FormularioDePresentacionArmado {
  const conUnidad = (rotulo: string) =>
    producto.unidadBase === null ? rotulo : `${rotulo} (${producto.unidadBase})`;
  const etiquetaDeCantidad = conUnidad(texto(d, "catalogo.presentacion.cantidad"));
  const etiquetaDePeso = conUnidad(texto(d, "catalogo.presentacion.peso_aproximado"));
  return {
    modo: presentacion === null ? "ALTA" : "EDICION",
    titulo: presentacion === null ? texto(d, "catalogo.presentacion.agregar") : presentacion.nombre,
    nombre: {
      etiqueta: texto(d, "catalogo.presentacion.nombre"),
      valorInicial: presentacion === null ? "" : presentacion.nombre,
    },
    cantidad: { etiqueta: etiquetaDeCantidad, etiquetaDePesoAproximado: etiquetaDePeso },
    pesoVariable: { etiqueta: texto(d, "catalogo.presentacion.peso_variable") },
    actual:
      presentacion === null
        ? null
        : {
            rotulo: presentacion.dePesoVariable ? etiquetaDePeso : etiquetaDeCantidad,
            valor: cantidadParaVer(presentacion, null),
            marca: presentacion.dePesoVariable
              ? texto(d, "catalogo.presentacion.peso_variable")
              : null,
          },
    guardar: texto(
      d,
      presentacion === null ? "catalogo.presentacion.agregar" : "catalogo.accion.guardar",
    ),
    cancelar: {
      href: rutaDeLaCompraDelProducto(producto.id),
      texto: texto(d, "catalogo.accion.cancelar"),
    },
    puedeGuardar: puede(puedeEditar),
  };
}

/** «Guardar» se ofrece con un nombre que no esté vacío y, al agregar, con una cantidad escrita; si son válidos para el negocio lo decide el servidor. */
export const sePuedeGuardarLaPresentacion = (
  modo: "ALTA" | "EDICION",
  nombre: string,
  cantidad: string,
): boolean => nombre.trim() !== "" && (modo === "EDICION" || cantidad !== "");

/** El botón de estado de la edición: «Desactivar» si está activa, «Reactivar» si no. */
export function textoDelEstado(activa: boolean, d: DiccionarioResuelto = {}): string {
  return texto(d, activa ? "catalogo.accion.desactivar" : "catalogo.accion.reactivar");
}
