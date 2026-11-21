"use client";

import { useEffect, type RefObject } from "react";
import { HOLGURA_DEL_TICKET_MM, pxAMm } from "./geometria";

/**
 * Mide el alto de un ticket de rollo en milímetros (`offsetHeight`: el alto de diseño, que no cambia con el `transform` de la vista previa) una vez cargadas las fuentes y lo vuelve a medir si cambia el tamaño, una fuente
 * o el `contenido` (lo que dibuja el ticket: si cambia, se mide de nuevo). Chromium NO respeta `@page { size: 80mm auto }`: sin el largo en mm el ticket sale en una hoja de otro tamaño. El alto se redondea hacia arriba y se le suma una holgura: nunca queda corto.
 * Lo comparten el ticket fiscal (`TicketDe80mm`) y el ticket del cliente del mostrador (`PapelDelTicket`): una sola medición.
 */
export function useAltoDelTicket(
  raiz: RefObject<HTMLElement | null>,
  alMedirElAlto: (altoEnMm: number) => void,
  contenido: unknown,
): void {
  useEffect(() => {
    const elemento = raiz.current;
    if (elemento === null) return;
    let vigente = true;
    const medir = async () => {
      await document.fonts.ready;
      if (!vigente) return;
      alMedirElAlto(Math.ceil(pxAMm(elemento.offsetHeight)) + HOLGURA_DEL_TICKET_MM);
    };
    void medir();
    const observador = new ResizeObserver(() => void medir());
    observador.observe(elemento);
    const alCargarUnaFuente = () => void medir();
    document.fonts.addEventListener("loadingdone", alCargarUnaFuente);
    return () => {
      vigente = false;
      observador.disconnect();
      document.fonts.removeEventListener("loadingdone", alCargarUnaFuente);
    };
  }, [raiz, alMedirElAlto, contenido]);
}
