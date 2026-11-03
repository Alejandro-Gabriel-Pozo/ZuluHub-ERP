import qrcode from "qrcode-generator";

/**
 * Dibuja un código QR YA COMO SVG en el servidor: el texto (la dirección `otpauth://` del segundo factor, que lleva el
 * secreto; la URL del QR de una factura) no viaja a ningún dibujante del navegador ni a un servicio externo (h5-p8
 * §2.4 ter). Es el único lugar que importa `qrcode-generator` (regla de arquitectura `qr-solo-en-su-adaptador`): lo
 * usan la autenticación de plataforma y, desde F9, la factura (ADR-014: se extrae al tener dos usos reales).
 *
 * El SVG lo arma este archivo a partir de la matriz de módulos, con SOLO formas (`<rect>` y `<path>`): ningún
 * atributo de texto lleva el texto codificado. Fondo blanco y módulos negros con cuatro módulos de margen (la
 * «zona silenciosa» que pide el estándar), también en modo oscuro: un lector lee mal un QR invertido.
 *
 * El nivel de corrección de errores lo elige quien llama (cada uso tiene su motivo; no hay valor por omisión) y la
 * etiqueta de accesibilidad también: sin etiqueta el SVG no lleva `role` ni `aria-label` y la pone quien lo inserta.
 */

const MARGEN_EN_MODULOS = 4;
/** Nivel de corrección de errores del estándar: «L» 7 %, «M» 15 %, «Q» 25 %, «H» 30 %. */
export type NivelDeCorreccion = "L" | "M" | "Q" | "H";

/** La matriz de módulos del QR (`true` = módulo oscuro), de `texto` en modo bytes. */
export function matrizDelQr(
  texto: string,
  correccion: NivelDeCorreccion,
): readonly (readonly boolean[])[] {
  const qr = qrcode(0, correccion);
  // Sin modo: la librería usa «Byte» por defecto (`mode || 'Byte'`), el que sirve para una dirección `otpauth` o una URL.
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, fila) =>
    Array.from({ length: n }, (_, columna) => qr.isDark(fila, columna)),
  );
}

const ESCAPES_DE_ATRIBUTO: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/** El SVG de la matriz: una forma por tramo horizontal de módulos oscuros. Con `etiqueta`, lleva `role="img"` y `aria-label`. */
export function svgDeLaMatriz(matriz: readonly (readonly boolean[])[], etiqueta?: string): string {
  const lado = matriz.length + 2 * MARGEN_EN_MODULOS;
  const tramos: string[] = [];
  matriz.forEach((fila, y) => {
    // Cada fila como texto de «1» (oscuro) y «0» (claro): los tramos de módulos oscuros consecutivos son los «1+».
    const texto = fila.map((oscuro) => (oscuro ? "1" : "0")).join("");
    for (const tramo of texto.matchAll(/1+/g)) {
      const ancho = tramo[0].length;
      tramos.push(
        `M${tramo.index + MARGEN_EN_MODULOS} ${y + MARGEN_EN_MODULOS}h${ancho}v1h-${ancho}z`,
      );
    }
  });
  const accesible =
    etiqueta === undefined
      ? ""
      : ` role="img" aria-label="${etiqueta.replace(/[&<>"]/g, (c) => ESCAPES_DE_ATRIBUTO[c] ?? c)}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges"${accesible}>` +
    `<rect width="${lado}" height="${lado}" fill="#ffffff"/>` +
    `<path d="${tramos.join("")}" fill="#000000"/></svg>`
  );
}

export const qrComoSvg = (
  texto: string,
  correccion: NivelDeCorreccion,
  etiqueta?: string,
): string => svgDeLaMatriz(matrizDelQr(texto, correccion), etiqueta);
