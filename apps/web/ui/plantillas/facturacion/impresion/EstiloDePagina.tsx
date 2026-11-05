import { useLayoutEffect } from "react";
import type { FormatoDeImpresion } from "./modelo-de-la-hoja";
import { reglaDePagina, SOLO_LA_HOJA } from "./regla-de-pagina";

export type PropsDelEstiloDePagina = Readonly<{
  formato: FormatoDeImpresion;
  altoDelTicketEnMm: number | null;
}>;

/**
 * Las reglas de la página que se imprime: `@page` SOLO del formato elegido (el A4 usa `size: A4`; el ticket, su largo medido, porque
 * Chromium no respeta `size: 80mm auto`) más la regla que deja solo la hoja. Van en una hoja de estilos CONSTRUIDA desde JavaScript
 * (`new CSSStyleSheet()` + `adoptedStyleSheets`), no en un `<style>`: un `<style>` sin nonce lo bloquea la CSP y el nonce del
 * documento no sirve en una navegación del cliente (el pedido de datos de Next trae otro nonce que el del documento). Una hoja
 * construida no depende del nonce, y la `@page` de una hoja adoptada rige al imprimir (spike en Chromium con la CSP real).
 * Se adopta mientras la vista está montada y se quita al desmontarla: una `@page` con el tamaño del ticket quedaría pegada a todo lo
 * que se imprima después. Previene: `@page` y «solo la hoja» sin aplicar en producción (A4 y ticket impresos con el tamaño del navegador).
 * Chequeo: `sin-estilos-en-linea.test.tsx` (nada de `<style>` ni `style=` en el HTML) y `ticket.test.tsx`/`hoja-a4.test.tsx`.
 */
export function EstiloDePagina({ formato, altoDelTicketEnMm }: PropsDelEstiloDePagina) {
  const reglas = `${reglaDePagina(formato, altoDelTicketEnMm) ?? ""}${SOLO_LA_HOJA}`;
  useLayoutEffect(() => {
    // Previene: vista en blanco (TypeError) en navegadores sin hojas constructables; sin ellas se imprime con el tamaño del navegador.
    if (
      !("adoptedStyleSheets" in document) ||
      typeof CSSStyleSheet !== "function" ||
      typeof CSSStyleSheet.prototype.replaceSync !== "function"
    )
      return undefined;
    const hoja = new CSSStyleSheet();
    hoja.replaceSync(reglas);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, hoja];
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((h) => h !== hoja);
    };
  }, [reglas]);
  return null;
}
