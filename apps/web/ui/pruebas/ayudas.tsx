import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { userEvent, type Locator } from "vitest/browser";
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
 * `pagina: true`, que usan las plantillas. Antes de medir espera a que terminen las transiciones y animaciones finitas en curso (las infinitas, como un esqueleto, no): tras un
 * cambio de estado (un botón que se habilita) el fondo está a medio camino y el contraste medido no es el final
 * (previene una violación de `color-contrast` intermitente en un navegador lento, como el del CI).
 */
export async function violacionesDeAccesibilidad(
  raiz: Element = document.body,
  { pagina = false }: { pagina?: boolean } = {},
): Promise<string[]> {
  const enCurso = document
    .getAnimations()
    .filter((animacion) => animacion.effect?.getComputedTiming().iterations !== Infinity);
  await Promise.all(enCurso.map((animacion) => animacion.finished.catch(() => undefined)));
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

/** Los cinco estados de un componente interactivo ([01] §4.1): la lista de verificación de cada uno. */
const ESTADOS_DE_COMPONENTE = ["normal", "foco", "cargando", "error", "deshabilitado"] as const;
export type EstadoDeComponente = (typeof ESTADOS_DE_COMPONENTE)[number];

/** Una casilla de la lista: la prueba de ese estado, o por qué no aplica (con motivo, no un «n/a»). */
export type CasillaDeEstado = (() => Promise<void>) | Readonly<{ noAplica: string }>;

/**
 * La matriz de estados de un componente interactivo, como lista de verificación DENTRO de sus pruebas: no se
 * puede omitir un estado (el tipo exige los cinco) y «no aplica» pide una razón de al menos 15 caracteres, que
 * queda a la vista en el nombre de la prueba. Un componente nuevo que no la declare no pasa la revisión.
 */
export function matrizDeEstados(
  componente: string,
  casillas: Readonly<Record<EstadoDeComponente, CasillaDeEstado>>,
): void {
  describe(`${componente}: matriz de estados`, () => {
    for (const estado of ESTADOS_DE_COMPONENTE) {
      const casilla = casillas[estado];
      if (typeof casilla === "function") {
        it(estado, casilla);
      } else {
        it(`${estado}: no aplica (${casilla.noAplica})`, () => {
          expect(casilla.noAplica.trim().length).toBeGreaterThanOrEqual(15);
        });
      }
    }
  });
}

/**
 * El foco por teclado se ve: un Tab lleva el foco al elemento y el anillo (contorno sólido de 3 px o más, el de
 * `:focus-visible` de los tokens) se pinta. `anillo` es el elemento que lo dibuja si no es el mismo que recibe el
 * foco (el campo de importe lo dibuja en su fila).
 */
export async function verificarFoco(
  elemento: HTMLElement,
  anillo: Element = elemento,
): Promise<void> {
  await userEvent.tab();
  expect(document.activeElement).toBe(elemento);
  const estilo = getComputedStyle(anillo);
  expect(estilo.outlineStyle).toBe("solid");
  expect(parseFloat(estilo.outlineWidth)).toBeGreaterThanOrEqual(3);
}
