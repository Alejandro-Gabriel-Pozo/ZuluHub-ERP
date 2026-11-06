/**
 * Pone estilos a un elemento por la API de estilos del elemento (CSSOM), nunca con un atributo `style=` escrito en el HTML.
 * Las claves son nombres CSS (`width`, `transform`, `--hoja-ancho`): `setProperty` sirve para propiedades y variables.
 * Previene: estilos que la CSP real (`style-src` sin `unsafe-inline`) bloquea cuando salen en el HTML del servidor, y que React
 * no vuelve a poner al hidratar (ya están en el DOM): la geometría de la hoja de impresión quedaba sin aplicar en producción.
 * Chequeo: `sin-estilos-en-linea.test.tsx` y `hoja-a4.test.tsx` (variables aplicadas, sin atributo `style` inicial).
 * `null` se acepta para usarla directo como `ref` de React.
 */
export function aplicarEstilos(
  elemento: HTMLElement | null,
  estilos: Readonly<Record<string, string>>,
): void {
  if (elemento === null) return;
  for (const [nombre, valor] of Object.entries(estilos)) elemento.style.setProperty(nombre, valor);
}
