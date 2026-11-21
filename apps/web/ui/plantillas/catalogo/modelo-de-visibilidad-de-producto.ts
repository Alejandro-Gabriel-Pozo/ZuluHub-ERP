import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * El modelo de vista de la tarjeta de visibilidad de la ficha de un producto (A15; maqueta aprobada `productos.html`, función `vVisib`): de dónde está oculto el producto y qué puede hacer la
 * persona, las filas con su aviso y su botón, y NADA más. Puro: sin React ni servidor. Los textos salen del catálogo (`catalogo.ocultar.*`, T13 con su fuente en `catalogo-catalogo.ts`); no se arma
 * ningún texto nuevo.
 *
 * Una fila por alcance: «este local» (solo si hay un local con el que se trabaja: nunca se asume «todas») y «toda la empresa». Oculto: el aviso del alcance y «Volver a mostrar»; visible: «Ocultar»
 * (en el local) u «Ocultar en toda la empresa». Sin permiso el botón sale apagado, no desaparece (maqueta, caso «Operador»): el servidor igual decide.
 */

/** Dónde está oculto el producto, como lo entrega la composición. */
export type VisibilidadDeLaPantalla = Readonly<{ local: boolean | null; empresa: boolean }>;

/** Lo que la persona puede hoy (la ayuda que apaga el botón; la decisión es del servidor). */
export type PermisosDeOcultar = Readonly<{ local: boolean; empresa: boolean }>;

export type FilaDeVisibilidad = Readonly<{
  alcance: "LOCAL" | "EMPRESA";
  /** El estado actual: el botón pide el contrario. */
  oculto: boolean;
  /** El aviso (`null` si está visible). */
  aviso: string | null;
  boton: string;
  /** Si el botón se puede tocar. */
  puede: boolean;
}>;

export function armarLaVisibilidad(
  visibilidad: VisibilidadDeLaPantalla,
  permisos: PermisosDeOcultar,
  d: DiccionarioResuelto = {},
): readonly FilaDeVisibilidad[] {
  const filas: FilaDeVisibilidad[] = [];
  if (visibilidad.local !== null) {
    filas.push({
      alcance: "LOCAL",
      oculto: visibilidad.local,
      aviso: visibilidad.local ? texto(d, "catalogo.ocultar.oculto") : null,
      boton: texto(
        d,
        visibilidad.local ? "catalogo.ocultar.volver_a_mostrar" : "catalogo.ocultar.ocultar",
      ),
      puede: permisos.local,
    });
  }
  filas.push({
    alcance: "EMPRESA",
    oculto: visibilidad.empresa,
    aviso: visibilidad.empresa ? texto(d, "catalogo.ocultar.oculto_en_la_empresa") : null,
    boton: texto(
      d,
      visibilidad.empresa
        ? "catalogo.ocultar.volver_a_mostrar"
        : "catalogo.ocultar.ocultar_en_la_empresa",
    ),
    puede: permisos.empresa,
  });
  return filas;
}
