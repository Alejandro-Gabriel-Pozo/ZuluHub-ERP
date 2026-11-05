"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { aplicarEstilos } from "../../../primitivas/aplicar-estilos";
import { formatearImporte } from "../formato-fiscal";
import estilos from "./HojaA4.module.css";
import { variablesDeLaGeometria } from "./geometria";
import { leerLasMedidas, type Medidas } from "./medicion";
import { textoDeLaHoja, type HojaArmada } from "./modelo-de-la-hoja";
import { EncabezadoDeHoja, PieDeHoja, TablaDeRenglones } from "./PiezasDeLaHoja";
import type { DiccionarioResuelto } from "../../../../../../src/capacidades/vocabulario/vocabulario";

export type PropsDelMedidor = Readonly<{
  a: HojaArmada;
  qrSvg: string;
  diccionario: DiccionarioResuelto;
  /** Recibe las medidas cada vez que cambian (primera medición, fuentes que terminan de cargar, cambio de ancho). */
  alMedir: (medidas: Medidas) => void;
}>;

/**
 * La tabla de medición: UNA tabla oculta, fuera de pantalla y sin transformar, con todos los renglones, el encabezado, la fila
 * «Transporte» y el pie final, con el mismo ancho útil y la misma letra que la hoja. Primero se inserta el contenido y recién DESPUÉS se
 * espera `document.fonts.ready` (el navegador pide una fuente cuando algo la usa: esperar antes mide con la de reemplazo). Se vuelve a
 * medir si cambia su tamaño o termina de cargar una fuente. Previene: cortes de hoja calculados con una tipografía que no es la impresa.
 */
export function MedidorDeLaHoja({ a, qrSvg, diccionario, alMedir }: PropsDelMedidor) {
  const raiz = useRef<HTMLDivElement>(null);
  // Las variables van ANTES de medir: el efecto de abajo corre después de este (los de layout corren primero) y el ancho útil sale de ellas.
  useLayoutEffect(() => {
    aplicarEstilos(raiz.current, variablesDeLaGeometria(null));
  }, []);
  useEffect(() => {
    const elemento = raiz.current;
    if (elemento === null) return;
    let vigente = true;
    const medir = async () => {
      await document.fonts.ready;
      if (!vigente) return;
      const medidas = leerLasMedidas(elemento);
      if (medidas !== null) alMedir(medidas);
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
  }, [a, alMedir]);
  return (
    <div ref={raiz} className={estilos["medidor"]} aria-hidden="true" data-medidor="">
      <EncabezadoDeHoja a={a} />
      <TablaDeRenglones
        a={a}
        renglones={a.renglones}
        transporte={formatearImporte("0")}
        paraMedir
      />
      <PieDeHoja
        a={a}
        qrSvg={qrSvg}
        hoja={textoDeLaHoja(diccionario, 1, 1)}
        aTransportar={null}
        paraMedir
      />
    </div>
  );
}
