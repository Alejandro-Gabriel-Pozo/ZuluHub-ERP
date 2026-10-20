/**
 * Contraste WCAG 2.x entre dos colores `#rrggbb`. Lo usan `tokens.test.ts` (los pares de color del sistema) y
 * `test/web/contraste-de-superficies.test.ts`, que lo compara con la cuenta de `modulos/marcas` para que las
 * dos nunca se separen. Este archivo no es una prueba y no importa nada: se puede cargar en Node y en el navegador.
 */

function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}

/** La razón de contraste entre dos colores `#rrggbb`: de 1 (iguales) a 21 (negro sobre blanco). */
export function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return ((claro ?? 0) + 0.05) / ((oscuro ?? 0) + 0.05);
}
