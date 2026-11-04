import type { DiccionarioResuelto } from "../../../../../../src/capacidades/vocabulario/vocabulario";
import { formatearImporte } from "../formato-fiscal";
import estilos from "./HojaA4.module.css";
import { estiloDeLaGeometria } from "./geometria";
import { textoDeLaHoja, type HojaArmada } from "./modelo-de-la-hoja";
import type { Paginacion } from "./paginador";
import { EncabezadoDeHoja, PieDeHoja, TablaDeRenglones } from "./PiezasDeLaHoja";

export type PropsDeLasHojasA4 = Readonly<{
  a: HojaArmada;
  paginacion: Paginacion;
  /** El alto del pie, el mismo en todas las hojas (`altoFijoDelPie`). */
  altoDelPie: number;
  qrSvg: string;
  diccionario: DiccionarioResuelto;
}>;

/**
 * Las hojas A4 ya repartidas: 210 x 297 mm exactos, cada una con su encabezado, su tabla y su pie fijo (CAE, vencimiento y QR en TODAS).
 * La última lleva el bloque final (total, transparencia); las demás, «A transportar». «Hoja k de n» usa el `n` real del paginador.
 * Sin estado: el reparto y los altos llegan por props.
 */
export function HojasA4({ a, paginacion, altoDelPie, qrSvg, diccionario }: PropsDeLasHojasA4) {
  const n = paginacion.hojas.length;
  return (
    <div className={estilos["hojas"]}>
      {paginacion.hojas.map((hoja, k) => (
        <section
          // La hoja k es la k-ésima del reparto: el orden no cambia mientras se dibuja.
          key={k}
          className={estilos["hoja"]}
          style={estiloDeLaGeometria(altoDelPie)}
          data-hoja={k + 1}
        >
          <EncabezadoDeHoja a={a} />
          <TablaDeRenglones
            a={a}
            renglones={a.renglones.slice(hoja.desde, hoja.hasta)}
            transporte={hoja.transporte === null ? null : formatearImporte(hoja.transporte)}
          />
          <PieDeHoja
            a={a}
            qrSvg={qrSvg}
            hoja={textoDeLaHoja(diccionario, k + 1, n)}
            aTransportar={hoja.aTransportar === null ? null : formatearImporte(hoja.aTransportar)}
          />
        </section>
      ))}
    </div>
  );
}
