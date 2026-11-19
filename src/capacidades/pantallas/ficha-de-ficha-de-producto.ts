import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE LA PANTALLA «FICHA DEL PRODUCTO» (solapa «Datos»; DDD:174: toda pantalla nace con ficha). Una ruta, `/catalogo/productos/[id]`, con un solo «Guardar» que lleva los datos del producto y,
 * para materia prima, insumo y reventa activos, el tilde «Se controla el stock» (PR-3 de Catálogo). Es solo una declaración: la comprueba `test/web/ficha-de-ficha-de-producto.test.ts` contra el catálogo
 * de textos y el de permisos. No crea acciones ni permisos. Los campos y sus datos son los del camino `guardar-ficha-de-producto` y `controlar-el-stock-de-un-producto` (no se repiten acá).
 * Previene: un botón o un texto que nadie aprobó, y una acción de permiso que se mueve sin que la ficha lo note.
 *
 * DIFERENCIAS CON LA MAQUETA (`productos.html`; la maqueta manda: cada desvío lleva su fundamento y lo decide el dueño):
 *  1. La casilla se dibuja DESPUÉS del enlace «Secciones» y antes de «Guardar»; en la práctica son clases distintas (el enlace solo existe para lo que se vende y la casilla solo para lo que se controla),
 *     así que nunca conviven: no hay orden que decidir.
 *  2. La casilla no se dibuja para el elaborado ni el vendible (la maqueta la dibuja para toda clase salvo vendible): hasta que exista producción rige E5 S-6 / E6 S-5 (DDD fila 91, resuelto por el
 *     ingeniero el 12/11/2026, a corregir por el dueño). Revertirlo cuesta cambiar `seControlaStockLaClase`.
 *  3. Sin permiso (`articulos.controlar`) la casilla se ve apagada con su estado real, sin texto extra (Interfaz sobria): decide el servidor al guardar.
 *  4. La casilla nace sin tildar y el alta no la ofrece (DDD filas 100 y 104).
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

export type FichaDeFichaDeProducto = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  botones: readonly BotonDeFicha[];
  /** Los textos de los campos de la solapa «Datos», por el campo del formulario. */
  rotulos: Readonly<Record<string, ClaveDeTexto>>;
  estados: Readonly<Record<"ERROR", ClaveDeTexto>>;
  textos: Readonly<Partial<Record<ClaveDeTexto, TextoDeFicha>>>;
  estadoDeLaFicha: "EN_CONSTRUCCION" | "TERMINADA";
}>;

const DEL_DUENO: FuenteDeTexto = {
  decidio:
    "el dueño, 09/11/2026 y 12/11/2026 (aprobó la maqueta de productos y su tabla «Textos nuevos»), con la regla «manda la maqueta»; decisiones-del-dueno-2026-11.md filas 100 y 104; por delegación (fila 173) el orquestador acepta los textos ya aprobados",
  donde: "Pedernal-docs 10-ux-ui, maqueta productos.html (vDatos, tabla Textos nuevos); DEC-0797",
};
const USO = "apps/web/ui/plantillas/catalogo/";

export const FICHA_DE_FICHA_DE_PRODUCTO = {
  archivos: [
    "apps/web/app/s/app/(operacion)/catalogo/productos/[id]/page.tsx",
    "apps/web/app/s/app/acciones-de-productos.ts",
    "apps/web/servidor/ficha-de-producto.ts",
    "apps/web/servidor/control-de-stock.ts",
    "apps/web/ui/componentes/Casilla.tsx",
    `${USO}FormularioDeFichaDeProducto.cliente.tsx`,
    `${USO}modelo-de-ficha-de-producto.ts`,
  ],
  rutas: ["/catalogo/productos/[id]"],
  botones: [
    {
      id: "guardar",
      texto: "catalogo.accion.guardar",
      hace: { envia: "productos.editar" },
      sinPermiso: "APAGADO",
    },
  ],
  rotulos: {
    nombre: "catalogo.dato.nombre",
    nombreDeCocina: "catalogo.dato.nombre_de_cocina",
    codigo: "catalogo.dato.codigo_interno",
    codigoDeBarras: "catalogo.dato.codigo_de_barras",
    alicuota: "catalogo.dato.alicuota_de_iva",
    seccionDeCartaId: "catalogo.dato.seccion_de_la_carta",
    seControlaElStock: "catalogo.dato.se_controla_el_stock",
  },
  // Todo rechazo del tilde sale como el genérico: no se crea un texto por motivo.
  estados: { ERROR: "catalogo.error.accion_no_permitida" },
  textos: {
    "catalogo.accion.guardar": { usos: ["botón único de la ficha"], fuente: DEL_DUENO },
    "catalogo.dato.nombre": { usos: ["rótulo del campo"], fuente: DEL_DUENO },
    "catalogo.dato.nombre_de_cocina": { usos: ["rótulo del campo"], fuente: DEL_DUENO },
    "catalogo.dato.codigo_interno": { usos: ["rótulo del campo"], fuente: DEL_DUENO },
    "catalogo.dato.codigo_de_barras": { usos: ["rótulo del campo"], fuente: DEL_DUENO },
    "catalogo.dato.alicuota_de_iva": { usos: ["rótulo del campo"], fuente: DEL_DUENO },
    "catalogo.dato.seccion_de_la_carta": { usos: ["rótulo del campo"], fuente: DEL_DUENO },
    "catalogo.dato.se_controla_el_stock": {
      usos: [
        "rótulo de la casilla, antes de «Guardar», solo si el producto admite control de stock",
      ],
      fuente: DEL_DUENO,
    },
    "catalogo.error.accion_no_permitida": {
      usos: ["rechazo al guardar (también el del tilde)"],
      fuente: DEL_DUENO,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDeFichaDeProducto;
