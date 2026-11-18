"use client";

import { useRef, useState } from "react";
import { Boton } from "../../componentes/Boton.cliente";
import { hojaDePrueba } from "../../patrones/papel/textos-de-imprimir";
import { useImpresionDelPapel } from "../../patrones/papel/useImpresionDelPapel.cliente";

/** Un toque a menos de esto del cierre del diálogo es el segundo de un doble toque (el navegador entrega al terminar los que quedaron en cola mientras el diálogo bloqueaba la página): no abre otro. */
const ESPERA_TRAS_EL_DIALOGO_MS = 1000;

export type PropsDeBotonDePruebaDeImpresora = Readonly<{
  /** «Imprimir prueba», ya resuelto. */
  texto: string;
  /** «Imprimiendo», ya resuelto: lo que dice el botón mientras corre. */
  textoImprimiendo: string;
  nombre: string;
  papelMm: number;
}>;

/**
 * «Imprimir prueba» de una impresora (maqueta `imprimir.html`): abre el diálogo de impresión del sistema con una hoja fija (el nombre de la impresora y su ancho de papel). Es SOLO del navegador (SUPUESTO DEC-0717):
 * no pide nada al servidor, no registra ningún trabajo y no cambia ningún dato; por eso no depende de un permiso de administración. Mientras corre el botón se apaga y justo después el segundo toque de un doble toque se ignora (no abre un segundo diálogo).
 * Chequeo: `BotonDePruebaDeImpresora.test.tsx` (Chromium real).
 */
export function BotonDePruebaDeImpresora({
  texto,
  textoImprimiendo,
  nombre,
  papelMm,
}: PropsDeBotonDePruebaDeImpresora) {
  const [enCurso, setEnCurso] = useState(false);
  const enVuelo = useRef(false);
  const cerroEn = useRef(Number.NEGATIVE_INFINITY);
  const impresion = useImpresionDelPapel();
  const probar = async () => {
    if (enVuelo.current || performance.now() - cerroEn.current < ESPERA_TRAS_EL_DIALOGO_MS) return;
    enVuelo.current = true;
    setEnCurso(true);
    try {
      await impresion.imprimir(hojaDePrueba(nombre, papelMm));
    } catch {
      // No hay nada que declarar ni reintentar: es una hoja de prueba, sin trabajo registrado. Quien no vio salir el diálogo vuelve a tocar.
    } finally {
      impresion.ocultar();
      cerroEn.current = performance.now();
      enVuelo.current = false;
      setEnCurso(false);
    }
  };
  return (
    <>
      <Boton
        variante="secundaria"
        enviando={enCurso}
        textoEnviando={textoImprimiendo}
        alTocar={() => void probar()}
      >
        {texto}
      </Boton>
      {impresion.zona}
    </>
  );
}
