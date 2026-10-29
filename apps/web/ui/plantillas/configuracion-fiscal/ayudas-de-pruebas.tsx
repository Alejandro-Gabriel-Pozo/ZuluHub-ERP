import { expect } from "vitest";
import { page } from "vitest/browser";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { ArmazonDeOperacion } from "../sesion/ArmazonDeOperacion";
import type { ReactNode } from "react";

/**
 * Ayudas de las pruebas de Configuración fiscal en Chromium (celular de 390 px y escritorio de 1280 px). Este archivo no es una
 * prueba: lo usan las de esta carpeta.
 */

/** La pantalla dentro del armazón de operación, como la sirve la página. */
export const enArmazon = (titulo: string, contenido: ReactNode): ReactNode => (
  <ArmazonDeOperacion
    titulo={titulo}
    marca="Hotel del Lago"
    empresa="Café del Puerto"
    modulos={[
      {
        clave: "comprobantes",
        href: "/facturacion/comprobantes",
        etiqueta: texto({}, "fiscal.pantalla.listado_titulo"),
        icono: "comprobantes",
      },
    ]}
  >
    {contenido}
  </ArmazonDeOperacion>
);

/** Se ve de verdad: ni `hidden`, ni `display:none`. */
const visible = (el: Element): boolean =>
  el.closest("[hidden]") === null && el.checkVisibility({ visibilityProperty: true });

/**
 * El alto de la ventana alcanza para toda la página: la barra inferior es `sticky` y, con la página más larga que la ventana, tapa
 * lo que está más abajo (axe lo cuenta como control tapado).
 */
export const ventana = (ancho: number): Promise<void> =>
  page.viewport(ancho, ancho < 800 ? 2600 : 1600);

/** Cada texto visible llega a 16 px, cada control visible a 48 px de alto y la página no se corre hacia el costado. */
export function legibleYTocable(): void {
  const chicos: string[] = [];
  for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
    const tieneTexto = [...el.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
    );
    if (!tieneTexto || !visible(el)) continue;
    const tamano = Number.parseFloat(getComputedStyle(el).fontSize);
    if (tamano < 16) chicos.push(`${el.tagName.toLowerCase()} ${tamano}px: ${el.textContent}`);
  }
  expect(chicos).toEqual([]);
  const bajos: string[] = [];
  for (const el of document.body.querySelectorAll<HTMLElement>(
    "button, a[href], select, input:not([type=hidden]), summary",
  )) {
    if (!visible(el)) continue;
    const alto = el.getBoundingClientRect().height;
    if (alto < 48) bajos.push(`${el.tagName.toLowerCase()} ${alto}px: ${el.textContent}`);
  }
  expect(bajos).toEqual([]);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}
