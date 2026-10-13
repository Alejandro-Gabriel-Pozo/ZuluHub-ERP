import axe from "axe-core";
import type { Locator } from "vitest/browser";
import "../tokens.css";

/**
 * Ayudas de las pruebas de componentes (corren en Chromium real, viewport de celular 390 x 844).
 * Este archivo no es una prueba: lo usan las pruebas de `ui/`.
 */

const ETIQUETAS_DE_AXE = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/**
 * Corre axe sobre `raiz` con el contraste incluido (es navegador real: calcula el color pintado) y
 * devuelve las violaciones como texto, para comparar con `[]`. Un componente suelto no es una página:
 * las reglas de página (una región principal, un `h1`, todo dentro de un landmark) solo se exigen con
 * `pagina: true`, que usan las plantillas.
 */
export async function violacionesDeAccesibilidad(
  raiz: Element = document.body,
  { pagina = false }: { pagina?: boolean } = {},
): Promise<string[]> {
  const resultado = await axe.run(raiz, {
    runOnly: { type: "tag", values: ETIQUETAS_DE_AXE },
    rules: pagina
      ? {}
      : {
          region: { enabled: false },
          "landmark-one-main": { enabled: false },
          "page-has-heading-one": { enabled: false },
        },
  });
  return resultado.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`,
  );
}

/**
 * Simula que el navegador pierde (o recupera) la conexión: cambia `navigator.onLine` y avisa con el
 * evento de siempre. Una red caída de verdad corta también la conexión de Vitest con su servidor, así
 * que no se usa `context.setOffline`. Hay que llamar a `restaurarConexion` al terminar.
 */
export function simularConexion(enLinea: boolean): void {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => enLinea });
  window.dispatchEvent(new Event(enLinea ? "online" : "offline"));
}

export function restaurarConexion(): void {
  Reflect.deleteProperty(navigator, "onLine");
}

/**
 * Un click del DOM, sin las esperas de Playwright (que no actúa sobre un botón `aria-disabled` ni sobre
 * dos toques en el mismo instante). Es el dedo que llega tarde o que toca dos veces.
 */
export function tocar(locator: Locator): void {
  const elemento = locator.element();
  if (elemento instanceof HTMLElement) elemento.click();
}
