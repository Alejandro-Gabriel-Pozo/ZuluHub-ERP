"use client";

import { useState } from "react";
import { REGLA_DE_CANTIDAD } from "../../../../../../src/capacidades/experiencia/reglas-de-cantidad";
import type { ErrorPublico } from "../../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../../src/capacidades/vocabulario/vocabulario";
import { Campo } from "../../../componentes/Campo";
import { CampoNumero } from "../../../componentes/CampoNumero";
import { ErrorDeRespuesta } from "../../../patrones/ErrorDeRespuesta";
import {
  hayQueGuardar,
  idDelRegistro,
  sinCerosDeSobra,
  type FilaDeLaCarga,
} from "./modelo-de-conteo";
import estilos from "./CargaDeConteo.module.css";

type ArticuloParaContar = Readonly<{
  articuloId: string;
  nombre: string;
  /** La unidad de stock del artículo (solo lectura), ya con su texto. */
  unidad: string;
  /** Lo último guardado de este artículo en el conteo abierto, o `null`. */
  contado: string | null;
}>;

export type PropsDeCargaDeConteo = Readonly<{
  articulos: readonly ArticuloParaContar[];
  /** La acción de servidor que guarda UN artículo (el conteo ya está ligado): devuelve el error ya traducido o `{ error: null }`. */
  guardar: (
    entrada: Readonly<{ id: string; articuloId: string; cantidad: string; hora: string }>,
  ) => Promise<Readonly<{ error: ErrorPublico | null }>>;
}>;

/**
 * La carga del conteo abierto (maqueta `stock-conteo.html`, FP-STK-10): una fila por artículo con «Contado» (cero es válido) y «Hora del conteo» (vacía = la de la carga). Cada artículo se guarda AL SALIR del campo, sin
 * botón: guardar lo mismo otra vez (un reintento tras un fallo) reusa el mismo id y no duplica; recontar es otro id y vale el último. El servidor valida cantidad y hora; un fallo se muestra en la fila. El conteo es a ciegas:
 * acá no hay nada de lo que el sistema creía. Los campos numéricos entregan texto canónico, nunca `number`.
 */
export function CargaDeConteo({ articulos, guardar }: PropsDeCargaDeConteo) {
  const [filas, setFilas] = useState<readonly FilaDeLaCarga[]>(
    articulos.map((a) => {
      const contado = a.contado === null ? "" : sinCerosDeSobra(a.contado);
      return {
        articuloId: a.articuloId,
        contado,
        hora: "",
        guardado: a.contado === null ? null : { contado, hora: "" },
        intento: null,
      };
    }),
  );
  const [errores, setErrores] = useState<Readonly<Record<string, ErrorPublico | null>>>({});

  const poner = (articuloId: string, cambio: (f: FilaDeLaCarga) => FilaDeLaCarga) =>
    setFilas((actuales) => actuales.map((f) => (f.articuloId === articuloId ? cambio(f) : f)));

  const guardarFila = async (articuloId: string) => {
    const fila = filas.find((f) => f.articuloId === articuloId);
    if (fila === undefined || !hayQueGuardar(fila)) return;
    const id = idDelRegistro(fila, () => crypto.randomUUID());
    const enviado = { contado: fila.contado, hora: fila.hora };
    poner(articuloId, (f) => ({ ...f, intento: { id, ...enviado } }));
    const r = await guardar({ id, articuloId, cantidad: enviado.contado, hora: enviado.hora });
    setErrores((e) => ({ ...e, [articuloId]: r.error }));
    if (r.error === null) poner(articuloId, (f) => ({ ...f, guardado: enviado, intento: null }));
  };

  return (
    <ul className={estilos["filas"]}>
      {filas.map((fila, i) => {
        const articulo = articulos[i];
        if (articulo === undefined) return null;
        const error = errores[fila.articuloId] ?? null;
        return (
          <li key={fila.articuloId} className={estilos["fila"]}>
            <strong className={estilos["nombre"]}>{articulo.nombre}</strong>
            <CampoNumero
              dato="cantidad-contada"
              etiqueta={texto({}, "stock.conteo.contado")}
              valor={fila.contado}
              alCambiar={(v) => poner(fila.articuloId, (f) => ({ ...f, contado: v }))}
              regla={REGLA_DE_CANTIDAD}
              alSalirDelCampo={() => void guardarFila(fila.articuloId)}
            />
            <span className={estilos["unidad"]}>{articulo.unidad}</span>
            <Campo
              dato="hora-del-conteo"
              etiqueta={texto({}, "stock.conteo.hora")}
              tipo="time"
              valor={fila.hora}
              alCambiar={(v) => poner(fila.articuloId, (f) => ({ ...f, hora: v }))}
              alSalir={() => void guardarFila(fila.articuloId)}
            />
            {error === null ? null : <ErrorDeRespuesta error={error} />}
          </li>
        );
      })}
    </ul>
  );
}
