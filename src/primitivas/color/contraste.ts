/**
 * Color `#rrggbb` y razón de contraste WCAG: UNA sola definición, que usan el tema de marca (`modulos/marcas`) y el
 * color de la carta (`capacidades/experiencia/vidriera`). Subió a primitiva porque `capacidades` no importa
 * módulos de negocio (regla `capacidades-sin-negocio`) y la fórmula ya estaba escrita en otros lugares.
 */

/** Un color es `#rrggbb` con letras minúsculas: nada de `#fff`, `rgb()`, `url()` ni nombres. */
export const COLOR_RRGGBB = /^#[0-9a-f]{6}$/;

/** El canal de dos dígitos hexadecimales que empieza en `inicio` de un `#rrggbb`. */
const canalEn = (color: string, inicio: number): number =>
  Number.parseInt(color.slice(inicio, inicio + 2), 16);

/**
 * Un canal sRGB (0 a 255) pasado a luz lineal (WCAG 2.x). El corte entre el tramo recto y la curva está
 * entre el canal 10 y el 11 (0,03928 · 255 = 10,02), igual que con 0,04045 de la norma sRGB: se compara
 * el canal entero y no el cociente, que nunca cae justo en el corte.
 */
function canalLineal(canal: number): number {
  const c = canal / 255;
  return canal <= 10 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** La luminancia relativa WCAG de un color `#rrggbb`: 0 el negro, 1 el blanco. */
export function luminanciaRelativa(color: string): number {
  return (
    0.2126 * canalLineal(canalEn(color, 1)) +
    0.7152 * canalLineal(canalEn(color, 3)) +
    0.0722 * canalLineal(canalEn(color, 5))
  );
}

/**
 * La razón de contraste WCAG entre dos colores `#rrggbb`, de 1 (iguales) a 21 (negro y blanco). No
 * depende del orden. Sin redondear: 4,499 no pasa por 4,5.
 */
export function razonDeContraste(a: string, b: string): number {
  const la = luminanciaRelativa(a);
  const lb = luminanciaRelativa(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
