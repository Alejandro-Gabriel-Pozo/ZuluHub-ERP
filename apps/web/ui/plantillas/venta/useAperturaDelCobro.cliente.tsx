"use client";

import { useEffect, useRef } from "react";

/** Tras abrir el cobro, un toque en «Cobrar» se ignora este rato: el segundo toque de un doble toque no cobra solo (decisión 171, `venta-rapida-v4.html:478`). */
export const ESPERA_AL_ABRIR_EL_COBRO_MS = 500;

/**
 * Lo que la venta necesita al abrir y cerrar la vista de cobro: la espera de apertura (una guarda síncrona, no estado) y el foco, que vuelve al botón «Cobrar» de la barra al volver a la cuenta.
 * Previene: que un doble toque en «Cobrar» de la barra cobre solo. Chequeo: `PantallaDeVentaRapida.cobrar.test.tsx` (doble toque).
 */
export function useAperturaDelCobro(cobrando: boolean, abrir: () => void) {
  const esperaAlAbrirElCobro = useRef(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const envolturaDeCobrar = useRef<HTMLDivElement>(null);
  const yaCobro = useRef(false);

  useEffect(
    () => () => {
      if (temporizador.current !== null) clearTimeout(temporizador.current);
    },
    [],
  );

  useEffect(() => {
    if (cobrando) {
      yaCobro.current = true;
      return;
    }
    if (yaCobro.current) envolturaDeCobrar.current?.querySelector("button")?.focus();
  }, [cobrando]);

  const abrirElCobro = () => {
    esperaAlAbrirElCobro.current = true;
    if (temporizador.current !== null) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => {
      esperaAlAbrirElCobro.current = false;
    }, ESPERA_AL_ABRIR_EL_COBRO_MS);
    abrir();
  };

  return { esperaAlAbrirElCobro, envolturaDeCobrar, abrirElCobro };
}
