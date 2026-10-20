import qrcode from "qrcode-generator";

/**
 * El código QR del alta del segundo factor, YA DIBUJADO como SVG en el servidor (h5-p8 §2.4 ter): la dirección
 * `otpauth://` (que lleva el secreto) no viaja a ningún dibujante del navegador ni a un servicio externo. Es el único
 * lugar que importa `qrcode-generator` (regla de arquitectura `qr-solo-en-la-autenticacion-de-plataforma`).
 *
 * El SVG lo arma este archivo a partir de la matriz de módulos, con SOLO formas (`<rect>` y `<path>`): ningún
 * atributo de texto lleva la dirección ni el secreto. Fondo blanco y módulos negros con cuatro módulos de margen (la
 * «zona silenciosa» que pide el estándar), también en modo oscuro: una aplicación autenticadora lee mal un QR invertido.
 */

const MARGEN_EN_MODULOS = 4;
/** Nivel de corrección de errores «M» (15 %): el habitual de las direcciones `otpauth`. */
const CORRECCION_DE_ERRORES = "M";

/** La matriz de módulos del QR (`true` = módulo oscuro), de `texto` en modo bytes. */
export function matrizDelQr(texto: string): readonly (readonly boolean[])[] {
  const qr = qrcode(0, CORRECCION_DE_ERRORES);
  // Sin modo: la librería usa «Byte» por defecto (`mode || 'Byte'`), el único que sirve para una dirección `otpauth`.
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, fila) =>
    Array.from({ length: n }, (_, columna) => qr.isDark(fila, columna)),
  );
}

/** El SVG de la matriz: una forma por tramo horizontal de módulos oscuros. */
export function svgDeLaMatriz(matriz: readonly (readonly boolean[])[]): string {
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
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges" ` +
    `role="img" aria-label="Código QR para la aplicación autenticadora">` +
    `<rect width="${lado}" height="${lado}" fill="#ffffff"/>` +
    `<path d="${tramos.join("")}" fill="#000000"/></svg>`
  );
}

export const qrComoSvg = (texto: string): string => svgDeLaMatriz(matrizDelQr(texto));
