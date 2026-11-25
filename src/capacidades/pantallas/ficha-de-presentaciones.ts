import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE LA PANTALLA «CÓMO SE COMPRA» DE UN PRODUCTO (T0; DDD:174: toda pantalla nace con ficha). Tres rutas bajo la ficha del producto: la lista de sus presentaciones de compra, agregar una y editar
 * su nombre (con «Desactivar» y «Reactivar»). Es solo una declaración: la comprueba `test/web/ficha-de-presentaciones.test.ts` contra el catálogo de textos y el de permisos. No crea acciones ni permisos
 * (usa `productos.editar` para escribir y `productos.ver` para ver). Los campos y sus datos son los de los caminos `agregar-presentacion-de-producto` y `renombrar-presentacion-de-producto` (no se repiten acá).
 * Previene: un botón o un texto que nadie aprobó, y una acción de permiso que se mueve sin que la ficha lo note.
 *
 * DIFERENCIAS CON LA MAQUETA (`presentaciones.html` y la solapa «Cómo se compra» de `productos.html`; cada desvío lo decidió el dueño el 25/11/2026):
 *  1. «Desactivar» y «Reactivar» en lugar de «Quitar»: el servidor no borra, apaga (pregunta 2 del plan). Revertir «quitar de verdad» exige una migración.
 *  2. Con «De peso variable» hay UN solo campo de cantidad, que pasa a llamarse «Peso aproximado» (la maqueta de productos dibujaba dos campos; el servidor guarda una sola cantidad: pregunta 3).
 *  3. La lista vacía dice «Sin presentaciones» (de la maqueta aprobada; no figuraba en «Textos nuevos»: pregunta 4).
 *  4. Todo rechazo sale como el genérico salvo la cantidad inválida, que tiene su texto aprobado bajo el campo (pregunta 5: nombre repetido con otra cantidad también es el genérico).
 *  5. Sin permiso (`productos.editar`) los botones de escribir se ven APAGADOS, sin texto extra (Interfaz sobria): decide el servidor al intentar.
 *  6. «Nueva compra» NO ofrece todavía las presentaciones: es el tramo T0b, aparte (pregunta 1).
 */

type FuenteDeTexto = Readonly<{ decidio: string; donde: string }>;
type TextoDeFicha = Readonly<{ usos: readonly string[]; fuente: FuenteDeTexto }>;
type BotonDeFicha = Readonly<{
  id: string;
  texto: ClaveDeTexto;
  hace: Readonly<{ envia: ClaveAccion }>;
  /** Sin permiso el botón sale apagado; no se esconde. */
  sinPermiso: "APAGADO";
}>;

export type FichaDePresentaciones = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  botones: readonly BotonDeFicha[];
  /** Los textos de los campos, por el campo del formulario. */
  rotulos: Readonly<Record<string, ClaveDeTexto>>;
  estados: Readonly<Record<"ERROR" | "ERROR_DE_CANTIDAD" | "LISTA_VACIA", ClaveDeTexto>>;
  textos: Readonly<Partial<Record<ClaveDeTexto, TextoDeFicha>>>;
  estadoDeLaFicha: "EN_CONSTRUCCION" | "TERMINADA";
}>;

const TABLA_DE_TEXTOS_NUEVOS: FuenteDeTexto = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la tabla «Textos nuevos» de la maqueta de productos) y 25/11/2026 (aprobó con «Si» las respuestas del plan de T0); por delegación (filas 173 y 174) el orquestador acepta el inventario y la ficha",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta productos.html (tabla Textos nuevos) y presentaciones.html; plan-t0-pantalla-de-presentaciones-2026-11-25.md sección C; DEC-0899",
};
const YA_APROBADO: FuenteDeTexto = {
  decidio:
    "el dueño, 09/11/2026 y 12/11/2026 (maqueta de productos aprobada), con la regla «manda la maqueta»; por delegación (fila 173) el orquestador acepta los textos ya aprobados",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta productos.html y presentaciones.html; DEC-0797 y DEC-0899",
};
const USO = "apps/web/ui/plantillas/catalogo/";

export const FICHA_DE_PRESENTACIONES = {
  archivos: [
    "apps/web/app/s/app/(operacion)/catalogo/productos/[id]/compra/page.tsx",
    "apps/web/app/s/app/(operacion)/catalogo/productos/[id]/compra/nueva/page.tsx",
    "apps/web/app/s/app/(operacion)/catalogo/productos/[id]/compra/[presentacionId]/page.tsx",
    "apps/web/app/s/app/acciones-de-presentaciones.ts",
    "apps/web/servidor/presentaciones.ts",
    "src/composicion/presentaciones-web.ts",
    "src/composicion/entradas-de-presentaciones.ts",
    `${USO}PantallaDePresentaciones.tsx`,
    `${USO}FormularioDePresentacion.cliente.tsx`,
    `${USO}modelo-de-presentaciones.ts`,
  ],
  rutas: [
    "/catalogo/productos/[id]/compra",
    "/catalogo/productos/[id]/compra/nueva",
    "/catalogo/productos/[id]/compra/[presentacionId]",
  ],
  botones: [
    {
      id: "agregar-en-la-lista",
      texto: "catalogo.presentacion.agregar",
      hace: { envia: "productos.editar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "agregar",
      texto: "catalogo.presentacion.agregar",
      hace: { envia: "productos.editar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "editar",
      texto: "catalogo.accion.editar",
      hace: { envia: "productos.editar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "guardar",
      texto: "catalogo.accion.guardar",
      hace: { envia: "productos.editar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "desactivar",
      texto: "catalogo.accion.desactivar",
      hace: { envia: "productos.editar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "reactivar",
      texto: "catalogo.accion.reactivar",
      hace: { envia: "productos.editar" },
      sinPermiso: "APAGADO",
    },
  ],
  rotulos: {
    nombre: "catalogo.presentacion.nombre",
    cantidad: "catalogo.presentacion.cantidad",
    cantidadDePesoVariable: "catalogo.presentacion.peso_aproximado",
    pesoVariable: "catalogo.presentacion.peso_variable",
  },
  // Todo rechazo sale como el genérico salvo la cantidad inválida (bajo el campo); la lista vacía lleva su texto.
  estados: {
    ERROR: "catalogo.error.accion_no_permitida",
    ERROR_DE_CANTIDAD: "catalogo.error.cantidad_mayor_que_cero",
    LISTA_VACIA: "catalogo.presentacion.vacia",
  },
  textos: {
    "catalogo.presentacion.nombre": {
      usos: ["rótulo del nombre, en agregar y en editar"],
      fuente: TABLA_DE_TEXTOS_NUEVOS,
    },
    "catalogo.presentacion.cantidad": {
      usos: ["rótulo de la cantidad al agregar, con el símbolo de la unidad base"],
      fuente: TABLA_DE_TEXTOS_NUEVOS,
    },
    "catalogo.presentacion.peso_aproximado": {
      usos: [
        "rótulo de la misma cantidad si la presentación es de peso variable (agregar y editar)",
      ],
      fuente: TABLA_DE_TEXTOS_NUEVOS,
    },
    "catalogo.presentacion.peso_variable": {
      usos: ["casilla al agregar y marca en la lista y en editar"],
      fuente: TABLA_DE_TEXTOS_NUEVOS,
    },
    "catalogo.presentacion.agregar": {
      usos: ["botón de la lista, título y botón de agregar"],
      fuente: TABLA_DE_TEXTOS_NUEVOS,
    },
    "catalogo.presentacion.vacia": {
      usos: ["la lista de un producto sin presentaciones"],
      fuente: TABLA_DE_TEXTOS_NUEVOS,
    },
    "catalogo.accion.editar": { usos: ["botón de cada tarjeta de la lista"], fuente: YA_APROBADO },
    "catalogo.accion.guardar": { usos: ["botón de la edición"], fuente: YA_APROBADO },
    "catalogo.accion.cancelar": { usos: ["agregar y editar"], fuente: YA_APROBADO },
    "catalogo.accion.desactivar": {
      usos: ["botón de la edición si está activa"],
      fuente: YA_APROBADO,
    },
    "catalogo.accion.reactivar": {
      usos: ["botón de la edición si está desactivada"],
      fuente: YA_APROBADO,
    },
    "catalogo.estado.desactivado": {
      usos: ["marca de la tarjeta de una presentación desactivada"],
      fuente: YA_APROBADO,
    },
    "catalogo.error.cantidad_mayor_que_cero": {
      usos: ["error bajo el campo de la cantidad"],
      fuente: YA_APROBADO,
    },
    "catalogo.error.accion_no_permitida": { usos: ["todo otro rechazo"], fuente: YA_APROBADO },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePresentaciones;
