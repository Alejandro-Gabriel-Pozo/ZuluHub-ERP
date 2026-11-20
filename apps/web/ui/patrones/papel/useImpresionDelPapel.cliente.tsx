"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import type { PapelParaImprimir } from "./hoja-del-papel";
import { PapelImpreso } from "./PapelImpreso.cliente";

/** Cuánto se espera a que el papel mida su alto y adopte su regla de página antes de darlo por fallido. */
const ESPERA_MAXIMA_MS = 5000;

export type ImpresionDelPapel = Readonly<{
  /** El papel en pantalla (para «Ver en pantalla» y para que el diálogo de impresión lo tenga delante); `null` si todavía no hay ninguno. */
  zona: ReactNode;
  /** Muestra el papel y abre el diálogo de impresión del sistema (`window.print`). Termina cuando el diálogo se cierra; lanza si no pudo abrirlo. */
  imprimir: (papel: PapelParaImprimir) => Promise<void>;
  /** Muestra el papel en pantalla sin imprimirlo. */
  mostrar: (papel: PapelParaImprimir) => void;
  /** Saca el papel de la pantalla y suelta su regla de página. */
  ocultar: () => void;
}>;

/**
 * Lo común a toda impresión en el navegador (S-2; E7 §3.10, PP-1: sin dependencia nueva): pone el papel en la zona de impresión, espera a que su regla de página esté adoptada y recién entonces abre el diálogo del
 * sistema. Lo usan la hoja de prueba de una impresora, el botón «Imprimir» de una comanda o un ticket (S-5) y «Ver en pantalla». El navegador NO confirma que salió el papel: `imprimir` termina al cerrarse el diálogo y
 * no dice si salió; quien declara «Impresa» declara lo que el dispositivo hizo (S-13), no una verificación.
 * Previene: abrir el diálogo antes de que `@page` rija (el papel sale con el tamaño del navegador).
 */
export function useImpresionDelPapel(): ImpresionDelPapel {
  const [papel, setPapel] = useState<PapelParaImprimir | null>(null);
  const [lote, setLote] = useState(0);
  const esperando = useRef<(() => void) | null>(null);

  const alEstarListo = useCallback(() => {
    esperando.current?.();
    esperando.current = null;
  }, []);

  const mostrar = useCallback((nuevo: PapelParaImprimir) => {
    setLote((n) => n + 1);
    setPapel(nuevo);
  }, []);

  const ocultar = useCallback(() => {
    setPapel(null);
  }, []);

  const imprimir = useCallback(
    async (nuevo: PapelParaImprimir) => {
      let temporizador: ReturnType<typeof setTimeout> | undefined;
      const listo = new Promise<void>((resolver, rechazar) => {
        esperando.current = resolver;
        temporizador = setTimeout(() => {
          esperando.current = null;
          rechazar(new Error("el papel no se midió a tiempo"));
        }, ESPERA_MAXIMA_MS);
      });
      mostrar(nuevo);
      try {
        await listo;
      } finally {
        clearTimeout(temporizador);
      }
      window.print();
    },
    [mostrar],
  );

  return {
    zona:
      papel === null ? null : <PapelImpreso key={lote} papel={papel} alEstarListo={alEstarListo} />,
    imprimir,
    mostrar,
    ocultar,
  };
}
