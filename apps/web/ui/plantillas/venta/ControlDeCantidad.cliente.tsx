"use client";

import { useState } from "react";
import { CampoNumero } from "../../componentes/CampoNumero";
import estilos from "./VentaRapida.module.css";
import {
  DIEZMILESIMOS_POR_UNIDAD,
  MAXIMO_DE_DIEZMILESIMOS,
  aDiezmilesimos,
  cantidadParaLeer,
  deDiezmilesimos,
  esCantidadValida,
  fraccionesOfrecidas,
  type FormaDeCantidad,
} from "./modelo-de-venta-rapida";

export type PropsDeControlDeCantidad = Readonly<{
  forma: FormaDeCantidad;
  /** La cantidad con la que arranca, en diezmilésimos; `null` = vacía. Para empezar de nuevo, el que arma la pantalla cambia la `key`. */
  inicial: number | null;
  textos: Readonly<{ cantidad: string; cantidadNoValida: string; borrar: string }>;
  /** El nombre de la unidad de venta (peso, volumen…), solo para la forma `MEDIDA`. */
  nombreDeLaUnidad: string | null;
  /** Atajos de la hoja: los números del 1 al 6 en un producto por unidad; en uno por fracciones, además de sus fracciones, el 1, 2 y 3 y «Borrar» (en la cuenta solo van las fracciones). */
  conAtajos: boolean;
  /** El importe que dio el servidor para esta cantidad, ya con formato; solo se muestra en un producto por fracciones, a la derecha de la cantidad. Ausente: nada. */
  importe?: string | undefined;
  /** Cada cambio: la cantidad si es una que el servidor aceptaría, o `null` (vacía o no válida). */
  alCambiar: (cantidad: number | null) => void;
}>;

const ATAJOS_DE_UNIDAD = [1, 2, 3, 4, 5, 6] as const;
const ENTEROS_QUE_SUMAN = [1, 2, 3] as const;
const REGLA_ENTERA = { decimales: 0, enterosMaximos: 4 } as const;
const REGLA_DE_MEDIDA = { decimales: 4, enterosMaximos: 4 } as const;

/**
 * Cómo se carga la cantidad de un producto (decisiones 162 y 166; maqueta `venta-rapida-v4.html`), sin botones − ni +:
 *  - por unidad: se escribe el entero (o se toca un número del 1 al 6);
 *  - por fracciones: el entero va en el campo y cada toque en una fracción (o, en la hoja, en 1, 2, 3) SUMA a ese entero («4» y ½ da «4 ½»); «Borrar» (solo en la hoja) deja la cantidad vacía;
 *  - por peso, volumen…: un decimal con coma en la unidad del producto.
 * La cantidad es un campo con dato (`cantidad-de-venta`). El control solo arma la cantidad; si es válida (mayor que cero, hasta 9999, múltiplo del paso) la entrega, y si no, entrega `null`: el
 * servidor vuelve a validar todo. Sin textos propios: todos llegan resueltos.
 */
export function ControlDeCantidad({
  forma,
  inicial,
  textos,
  nombreDeLaUnidad,
  conAtajos,
  importe,
  alCambiar,
}: PropsDeControlDeCantidad) {
  const [escrito, setEscrito] = useState(inicial === null ? "" : deDiezmilesimos(inicial));
  const [total, setTotal] = useState(inicial ?? 0);

  const emitir = (cantidad: number | null) => {
    alCambiar(cantidad !== null && esCantidadValida(cantidad, forma.paso) ? cantidad : null);
  };

  if (forma.tipo === "FRACCIONES") {
    const entera = Math.floor(total / DIEZMILESIMOS_POR_UNIDAD);
    const resto = total % DIEZMILESIMOS_POR_UNIDAD;
    const poner = (nuevo: number) => {
      setTotal(nuevo);
      emitir(nuevo);
    };
    const sumandos = [
      ...fraccionesOfrecidas(forma.porciones).map((f) => ({ valor: f.valor, rotulo: f.rotulo })),
      ...(conAtajos
        ? ENTEROS_QUE_SUMAN.map((n) => ({
            valor: n * DIEZMILESIMOS_POR_UNIDAD,
            rotulo: String(n),
          }))
        : []),
    ];
    return (
      <div className={estilos["cantidad"]}>
        <CampoNumero
          dato="cantidad-de-venta"
          etiqueta={textos.cantidad}
          valor={entera === 0 ? "" : String(entera)}
          alCambiar={(valor) => {
            // Escribir el entero NO toca la fracción ya elegida: «4» y ½ es «4 ½».
            poner((aDiezmilesimos(valor === "" ? "0" : valor) ?? 0) + resto);
          }}
          regla={REGLA_ENTERA}
        />
        <div className={estilos["resultadoDeFracciones"]}>
          <p className={estilos["lectura"]} aria-live="polite">
            {total === 0 ? "" : cantidadParaLeer(total, forma)}
          </p>
          {importe === undefined ? null : (
            <p className={estilos["importeDeLaCantidad"]}>{importe}</p>
          )}
        </div>
        <div className={estilos["atajos"]} role="group" aria-label={textos.cantidad}>
          {sumandos.map((s) => (
            <button
              key={s.valor}
              type="button"
              className={estilos["atajo"]}
              disabled={total + s.valor > MAXIMO_DE_DIEZMILESIMOS}
              onClick={() => {
                poner(total + s.valor);
              }}
            >
              {s.rotulo}
            </button>
          ))}
          {conAtajos ? (
            <button
              type="button"
              className={estilos["atajo"]}
              disabled={total === 0}
              onClick={() => {
                poner(0);
              }}
            >
              {textos.borrar}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const decimal = forma.tipo === "MEDIDA";
  const cantidad = escrito === "" ? null : aDiezmilesimos(escrito);
  const noValida = escrito !== "" && (cantidad === null || !esCantidadValida(cantidad, forma.paso));
  const poner = (valor: string) => {
    setEscrito(valor);
    emitir(valor === "" ? null : aDiezmilesimos(valor));
  };
  return (
    <div className={estilos["cantidad"]}>
      <div className={estilos["conUnidad"]}>
        <CampoNumero
          dato="cantidad-de-venta"
          etiqueta={textos.cantidad}
          valor={escrito}
          alCambiar={poner}
          regla={decimal ? REGLA_DE_MEDIDA : REGLA_ENTERA}
          error={noValida ? textos.cantidadNoValida : undefined}
        />
        {decimal && nombreDeLaUnidad !== null ? (
          <span className={estilos["unidad"]}>{nombreDeLaUnidad}</span>
        ) : null}
      </div>
      {conAtajos && forma.tipo === "UNIDAD" ? (
        <div className={estilos["atajos"]} role="group" aria-label={textos.cantidad}>
          {ATAJOS_DE_UNIDAD.map((n) => (
            <button
              key={n}
              type="button"
              className={estilos["atajo"]}
              aria-pressed={escrito === String(n)}
              onClick={() => {
                poner(String(n));
              }}
            >
              {n}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
