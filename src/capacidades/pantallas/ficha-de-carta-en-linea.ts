import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE LA PANTALLA «CARTA EN LÍNEA» (DDD:174: toda pantalla nace con ficha). Una ruta, `/catalogo/carta-en-linea`, de UNA sucursal: el estado de la carta y su botón, los tres textos, la identidad (cara,
 * color y logo; V1), la dirección pública con su QR y cuántos productos salen. Es solo una declaración: la comprueba `test/web/ficha-de-carta-en-linea.test.ts` contra el catálogo de textos y el de permisos.
 * No crea acciones ni permisos. Los campos y sus datos son los del formulario (`nombre-de-la-carta`, `rubro-de-la-carta`, `lugar-de-la-carta`, `cara-de-la-carta`, `color-de-la-carta` y `logo-de-la-carta`: no se
 * repiten acá). Previene: un botón o un texto que nadie aprobó, y una acción de permiso que se mueve sin que la ficha lo note.
 *
 * Estados: sin carta (solo el formulario), fuera de línea, en línea y sin sucursal elegida (la página manda a `/sucursal`). Sin permiso, los controles salen apagados y el servidor devuelve el genérico. Sin modales.
 *
 * DIFERENCIAS CON LA MAQUETA (la maqueta manda: cada desvío lleva su fundamento y lo decide el dueño):
 *  1. La maqueta de la identidad (`carta.html`) es de la EMPRESA con herencia por sucursal («Usar lo de la empresa» / «Propio»); acá cada sucursal elige su cara, su color y su logo propios (plan P4 del 16/11:
 *     «campos dentro de Carta en línea»). «Usar lo de la empresa» es la opción vacía del color y el logo vacío. Revertirlo cuesta una pantalla de empresa (otro tramo).
 *  2. El logo se pega como dirección de la imagen (fila 232, P3 «A»: dirección externa; no se suben archivos); la maqueta lo sube desde el celular. «Quitar» lo vacía.
 *  3. La cara sin elegir se muestra como «Día» (la que rige) y se guarda explícita al guardar. Los nombres «Día», «Boliche» y «Noche» y el rótulo «Cara» son SUPUESTO (DEC-0827): la maqueta los muestra, el rótulo
 *     exacto no está confirmado. Revertirlo cuesta cambiar cuatro textos del catálogo.
 *  4. El color de la empresa no se edita acá (no hay caso de uso que lo escriba): «Usar lo de la empresa» usa lo que haya. No hay selector de modelo (Libro, Cuadrícula): VYP-3.
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

export type FichaDeCartaEnLinea = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  botones: readonly BotonDeFicha[];
  /** Los textos de los campos del formulario, por el campo. */
  rotulos: Readonly<Record<string, ClaveDeTexto>>;
  estados: Readonly<Record<"ERROR", ClaveDeTexto>>;
  textos: Readonly<Partial<Record<ClaveDeTexto, TextoDeFicha>>>;
  estadoDeLaFicha: "EN_CONSTRUCCION" | "TERMINADA";
}>;

const DE_LA_CARTA: FuenteDeTexto = {
  decidio:
    "el dueño, filas 60 y 70 de decisiones-del-dueno-2026-11.md (aprobó la maqueta de Carta en línea); por delegación (fila 173) el orquestador acepta los textos ya aprobados",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta carta-en-linea.html (Textos por aprobar y Textos ya aprobados)",
};
const DE_LA_IDENTIDAD: FuenteDeTexto = {
  decidio:
    "el dueño, 09/11/2026 (aprobó las maquetas carta.html y carta-caras.html) y fila 171 del 15/11/2026; por delegación (fila 173) el orquestador acepta el inventario de textos (DEC-0827)",
  donde:
    "Pedernal-docs 10-ux-ui, maquetas carta.html y carta-caras.html (Colores, Logo, paletas, Usar lo de la empresa); DEC-0827",
};
const USO = "apps/web/ui/plantillas/carta/";

export const FICHA_DE_CARTA_EN_LINEA = {
  archivos: [
    "apps/web/app/s/app/(operacion)/catalogo/carta-en-linea/page.tsx",
    "apps/web/app/s/app/acciones-de-carta-en-linea.ts",
    "apps/web/servidor/carta-en-linea.ts",
    `${USO}PantallaDeCartaEnLinea.tsx`,
    `${USO}FormularioDeCartaEnLinea.cliente.tsx`,
    `${USO}FormularioDeEstadoDeCarta.cliente.tsx`,
    `${USO}DireccionDeLaCarta.cliente.tsx`,
    `${USO}modelo-de-carta-en-linea.ts`,
  ],
  rutas: ["/catalogo/carta-en-linea"],
  botones: [
    {
      id: "guardar",
      texto: "catalogo.accion.guardar",
      hace: { envia: "vidrieras.editar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "poner",
      texto: "catalogo.carta.poner",
      hace: { envia: "vidrieras.publicar_en_linea" },
      sinPermiso: "APAGADO",
    },
    {
      id: "sacar",
      texto: "catalogo.carta.sacar",
      hace: { envia: "vidrieras.retirar_de_linea" },
      sinPermiso: "APAGADO",
    },
    {
      id: "quitar-el-logo",
      texto: "catalogo.carta.quitar",
      hace: { envia: "vidrieras.editar" },
      sinPermiso: "APAGADO",
    },
  ],
  rotulos: {
    nombre: "catalogo.dato.nombre",
    rubro: "catalogo.carta.rubro",
    lugar: "catalogo.carta.lugar",
    cara: "catalogo.carta.cara",
    paleta: "catalogo.carta.colores",
    colorPropio: "catalogo.carta.otro_color",
    logo: "catalogo.carta.direccion_de_la_imagen",
  },
  // Todo rechazo del servidor sale como el genérico: no se crea un texto por motivo.
  estados: { ERROR: "catalogo.error.accion_no_permitida" },
  textos: {
    "catalogo.carta.titulo": { usos: ["título de la pantalla"], fuente: DE_LA_CARTA },
    "catalogo.dato.nombre": { usos: ["rótulo del campo"], fuente: DE_LA_CARTA },
    "catalogo.carta.rubro": { usos: ["rótulo del campo"], fuente: DE_LA_CARTA },
    "catalogo.carta.lugar": { usos: ["rótulo del campo"], fuente: DE_LA_CARTA },
    "catalogo.accion.guardar": { usos: ["botón del formulario"], fuente: DE_LA_CARTA },
    "catalogo.carta.poner": {
      usos: ["botón de estado, carta fuera de línea"],
      fuente: DE_LA_CARTA,
    },
    "catalogo.carta.sacar": { usos: ["botón de estado, carta en línea"], fuente: DE_LA_CARTA },
    "catalogo.carta.en_linea": { usos: ["insignia de estado"], fuente: DE_LA_CARTA },
    "catalogo.carta.fuera_de_linea": { usos: ["insignia de estado"], fuente: DE_LA_CARTA },
    "catalogo.carta.direccion": { usos: ["título de la dirección pública"], fuente: DE_LA_CARTA },
    "catalogo.accion.copiar": { usos: ["botón que copia la dirección"], fuente: DE_LA_CARTA },
    "vidriera.producto.enlace_copiado": { usos: ["aviso al copiar"], fuente: DE_LA_CARTA },
    "catalogo.carta.descargar_qr": { usos: ["enlace que descarga el QR"], fuente: DE_LA_CARTA },
    "catalogo.carta.no_disponible": {
      usos: ["bajo la dirección mientras la carta está fuera de línea"],
      fuente: DE_LA_CARTA,
    },
    "catalogo.carta.salen": { usos: ["contador de productos que salen"], fuente: DE_LA_CARTA },
    "catalogo.carta.sale_uno": { usos: ["contador, un solo producto"], fuente: DE_LA_CARTA },
    "catalogo.precio.sin_precio": {
      usos: ["motivo de un producto que no sale"],
      fuente: DE_LA_CARTA,
    },
    "catalogo.carta.sin_seccion": {
      usos: ["motivo de un producto que no sale"],
      fuente: DE_LA_CARTA,
    },
    "catalogo.estado.desactivado": {
      usos: ["motivo de un producto que no sale"],
      fuente: DE_LA_CARTA,
    },
    "catalogo.carta.oculto": { usos: ["motivo de un producto que no sale"], fuente: DE_LA_CARTA },
    "catalogo.carta.cara": { usos: ["leyenda del grupo de caras"], fuente: DE_LA_IDENTIDAD },
    "catalogo.carta.cara_dia": { usos: ["opción de cara"], fuente: DE_LA_IDENTIDAD },
    "catalogo.carta.cara_boliche": { usos: ["opción de cara"], fuente: DE_LA_IDENTIDAD },
    "catalogo.carta.cara_noche": { usos: ["opción de cara"], fuente: DE_LA_IDENTIDAD },
    "catalogo.carta.colores": {
      usos: ["rótulo del desplegable de colores"],
      fuente: DE_LA_IDENTIDAD,
    },
    "catalogo.carta.usar_empresa": { usos: ["primera opción del color"], fuente: DE_LA_IDENTIDAD },
    "catalogo.carta.paleta_azul": { usos: ["opción de color"], fuente: DE_LA_IDENTIDAD },
    "catalogo.carta.paleta_verde": { usos: ["opción de color"], fuente: DE_LA_IDENTIDAD },
    "catalogo.carta.paleta_bordo": { usos: ["opción de color"], fuente: DE_LA_IDENTIDAD },
    "catalogo.carta.paleta_tostado": { usos: ["opción de color"], fuente: DE_LA_IDENTIDAD },
    "catalogo.carta.paleta_negro": { usos: ["opción de color"], fuente: DE_LA_IDENTIDAD },
    "catalogo.carta.paleta_violeta": { usos: ["opción de color"], fuente: DE_LA_IDENTIDAD },
    "catalogo.carta.otro_color": {
      usos: ["última opción del color y rótulo del campo del color propio"],
      fuente: DE_LA_IDENTIDAD,
    },
    "catalogo.carta.contraste_aviso": {
      usos: ["aviso bajo el color cuando el sistema lo oscurece para que se lea"],
      fuente: DE_LA_IDENTIDAD,
    },
    "catalogo.carta.color_invalido": {
      usos: ["error del color propio mal escrito"],
      fuente: DE_LA_IDENTIDAD,
    },
    "catalogo.carta.logo": { usos: ["leyenda del grupo del logo"], fuente: DE_LA_IDENTIDAD },
    "catalogo.carta.direccion_de_la_imagen": {
      usos: ["rótulo del campo del logo"],
      fuente: DE_LA_IDENTIDAD,
    },
    "catalogo.carta.direccion_no_sirve": {
      usos: ["error de la dirección del logo"],
      fuente: DE_LA_IDENTIDAD,
    },
    "catalogo.carta.quitar": { usos: ["botón que vacía el logo"], fuente: DE_LA_IDENTIDAD },
    "catalogo.error.accion_no_permitida": {
      usos: ["rechazo del servidor al guardar o cambiar el estado"],
      fuente: DE_LA_CARTA,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDeCartaEnLinea;
