"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { aplicarEstilos } from "../../primitivas/aplicar-estilos";
import { MARCA_DE_LA_ZONA } from "../../plantillas/facturacion/impresion/regla-de-pagina";
import {
  altoDeLaHojaEnMm,
  reglaDeLaHojaDelPapel,
  variablesDelPapel,
  type PapelParaImprimir,
} from "./hoja-del-papel";
import estilos from "./PapelImpreso.module.css";

export type PropsDePapelImpreso = Readonly<{
  papel: PapelParaImprimir;
  /** Avisa una vez: el alto ya está medido y la regla de página ya está adoptada (recién ahí se puede abrir el diálogo de impresión). */
  alEstarListo?: (() => void) | undefined;
}>;

/**
 * Las reglas de la página que se imprime (`@page` del ancho de la impresora y el alto medido, más «solo la hoja»), en una hoja de estilos CONSTRUIDA desde JavaScript (`adoptedStyleSheets`), no en un
 * etiqueta de estilo: la CSP real la bloquea sin nonce. Se adopta mientras el papel está montado y se quita al desmontarlo: una `@page` de 58 mm quedaría pegada a todo lo que se imprima después.
 * Sin hojas constructables en el navegador no se adopta nada y se imprime con el tamaño del navegador (mismo comportamiento que la factura).
 */
function EstiloDelPapel({ anchoMm, altoMm }: Readonly<{ anchoMm: number; altoMm: number }>) {
  const reglas = reglaDeLaHojaDelPapel(anchoMm, altoMm);
  useLayoutEffect(() => {
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

/**
 * El papel de una comanda, un aviso de anulación o un ticket: cada línea del modelo con su estilo (normal, negrita, grande o separador), de ancho fijo. Es la zona de impresión (`data-zona-de-impresion`):
 * al imprimir solo sale el papel. Mide su propio alto una vez cargadas las fuentes y lo vuelve a medir si cambia; recién con la regla de página adoptada avisa `alEstarListo`.
 * No lee datos ni decide nada: el servidor armó el modelo desde lo guardado.
 */
export function PapelImpreso({ papel, alEstarListo }: PropsDePapelImpreso) {
  const raiz = useRef<HTMLDivElement>(null);
  const [alto, setAlto] = useState<number | null>(null);
  const avisado = useRef(false);
  // El ancho va ANTES de medir el alto (los efectos de layout corren antes que los pasivos).
  useLayoutEffect(() => {
    aplicarEstilos(raiz.current, variablesDelPapel(papel.ancho));
  }, [papel.ancho]);
  useEffect(() => {
    const elemento = raiz.current;
    if (elemento === null) return;
    let vigente = true;
    const medir = async () => {
      await document.fonts.ready;
      if (vigente) setAlto(altoDeLaHojaEnMm(elemento.offsetHeight));
    };
    void medir();
    const observador = new ResizeObserver(() => void medir());
    observador.observe(elemento);
    return () => {
      vigente = false;
      observador.disconnect();
    };
  }, [papel]);
  useEffect(() => {
    // La regla de página ya se adoptó (efecto de layout de `EstiloDelPapel`, que corre antes que este): se puede imprimir.
    if (alto === null || avisado.current) return;
    avisado.current = true;
    alEstarListo?.();
  }, [alto, alEstarListo]);
  return (
    <div {...{ [MARCA_DE_LA_ZONA]: "" }}>
      {alto === null ? null : <EstiloDelPapel anchoMm={papel.ancho} altoMm={alto} />}
      <div ref={raiz} className={estilos["papel"]} data-papel="" data-ancho={papel.ancho}>
        {papel.lineas.map((linea, i) =>
          linea.estilo === "SEPARADOR" ? (
            // El índice es la clave: las líneas se imprimen en su orden y no se reordenan.
            <hr key={i} className={estilos["separador"]} />
          ) : (
            <p
              key={i}
              className={`${estilos["linea"]} ${
                linea.estilo === "GRANDE"
                  ? estilos["grande"]
                  : linea.estilo === "NEGRITA"
                    ? estilos["negrita"]
                    : ""
              }`}
            >
              {linea.texto}
            </p>
          ),
        )}
      </div>
    </div>
  );
}
