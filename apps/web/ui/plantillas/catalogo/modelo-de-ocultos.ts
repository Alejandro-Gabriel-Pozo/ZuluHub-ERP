import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import type { PermisosDeOcultar } from "./modelo-de-visibilidad-de-producto";

/**
 * El modelo de vista de la lista de productos ocultos (C2; maqueta aprobada `productos.html`, función `vListaOcultos`): por producto, su nombre, el aviso de cada alcance donde está oculto y
 * si se puede tocar «Volver a mostrar». Puro: sin React ni servidor. Los textos salen del catálogo (`catalogo.ocultar.*`, T13, fuente en `catalogo-catalogo.ts`); no se arma ninguno nuevo.
 * Sin permiso el botón sale apagado (como en la tarjeta de la ficha; maqueta, caso «Operador»): lo oculto en toda la empresa solo lo muestra quien puede ocultar en la empresa. El
 * servidor igual decide.
 */

/** Un producto oculto como lo entrega la composición. */
export type OcultoDeLaLista = Readonly<{
  productoId: string;
  nombre: string;
  local: boolean;
  empresa: boolean;
}>;

type FilaDeOculto = Readonly<{
  productoId: string;
  nombre: string;
  /** «Oculto en toda la empresa» y/o «Oculto» (en el local), en ese orden (el de la maqueta). */
  avisos: readonly string[];
  /** Si «Volver a mostrar» se puede tocar. */
  puede: boolean;
}>;

export type ListaDeOcultosArmada = Readonly<{
  filas: readonly FilaDeOculto[];
  /** «Sin resultados» si no hay ninguno; `null` si los hay. */
  vacio: string | null;
  /** El texto del botón de cada fila. */
  boton: string;
}>;

export function armarLosOcultos(
  ocultos: readonly OcultoDeLaLista[],
  permisos: PermisosDeOcultar,
  d: DiccionarioResuelto = {},
): ListaDeOcultosArmada {
  return {
    filas: ocultos.map((o) => ({
      productoId: o.productoId,
      nombre: o.nombre,
      avisos: [
        ...(o.empresa ? [texto(d, "catalogo.ocultar.oculto_en_la_empresa")] : []),
        ...(o.local ? [texto(d, "catalogo.ocultar.oculto")] : []),
      ],
      puede: (!o.empresa || permisos.empresa) && (!o.local || permisos.local),
    })),
    vacio: ocultos.length === 0 ? texto(d, "catalogo.lista.sin_resultados") : null,
    boton: texto(d, "catalogo.ocultar.volver_a_mostrar"),
  };
}
