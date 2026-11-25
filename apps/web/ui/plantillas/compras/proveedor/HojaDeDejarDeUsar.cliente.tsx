"use client";

import { useActionState, useEffect, useState } from "react";
import { Boton } from "../../../componentes/Boton.cliente";
import { BotonDeEnvio } from "../../../patrones/BotonDeEnvio.cliente";
import { ProveedorDeEnvioDeFormulario } from "../../../patrones/EnvioDeFormulario.cliente";
import { ErrorDeRespuesta } from "../../../patrones/ErrorDeRespuesta";
import { Superposicion } from "../../../patrones/Superposicion";
import { Pila } from "../../../primitivas/Pila";
import {
  FICHA_DE_PROVEEDOR_INICIAL,
  type ResultadoDeFichaDeProveedor,
} from "./resultado-de-proveedor";

export type PropsDeHojaDeDejarDeUsar = Readonly<{
  /** «Dejar de usar»: el verbo del botón y el título de la hoja. */
  verbo: string;
  /** Qué se deja de usar («00005», «Factura A»): se suma al título para el lector de pantalla. */
  objeto: string;
  /** La explicación de la hoja, ya resuelta. */
  descripcion: string;
  textoDeCancelar: string;
  textoDeCerrar: string;
  /** La acción con el proveedor y el objeto ya ligados (`.bind`): no viajan en el formulario. */
  accion: (
    previo: ResultadoDeFichaDeProveedor,
    datos: FormData,
  ) => Promise<ResultadoDeFichaDeProveedor>;
  rutaDeLaFicha: string;
}>;

/**
 * «Dejar de usar» un punto de venta o un comprobante de la ficha (maqueta `compra.html`, modal `rmpv`): una hoja de confirmación con «Cancelar» y el verbo. El botón no se vuelve a tocar mientras envía;
 * repetirlo es seguro en el servidor (uno ya apagado no escribe ni audita). Si salió bien, vuelve a cargar la ficha; si no, el error ya traducido queda en la hoja.
 */
export function HojaDeDejarDeUsar({
  verbo,
  objeto,
  descripcion,
  textoDeCancelar,
  textoDeCerrar,
  accion,
  rutaDeLaFicha,
}: PropsDeHojaDeDejarDeUsar) {
  const [abierta, setAbierta] = useState(false);
  const [resultado, enviar, enviando] = useActionState(accion, FICHA_DE_PROVEEDOR_INICIAL);
  const hecho = resultado.estado === "HECHO";
  useEffect(() => {
    if (hecho) window.location.assign(rutaDeLaFicha);
  }, [hecho, rutaDeLaFicha]);
  const titulo = `${verbo} ${objeto}`;
  return (
    <>
      <Boton
        variante="secundaria"
        alTocar={() => {
          setAbierta(true);
        }}
      >
        {titulo}
      </Boton>
      <Superposicion
        abierta={abierta}
        proposito="confirmar"
        titulo={titulo}
        alCerrar={() => {
          setAbierta(false);
        }}
        cerrable={!enviando}
        etiquetaDeCerrar={textoDeCerrar}
      >
        <form action={enviar}>
          <ProveedorDeEnvioDeFormulario value={enviando}>
            <Pila separacion={3}>
              <p>{descripcion}</p>
              {resultado.estado === "ERROR" ? <ErrorDeRespuesta error={resultado.error} /> : null}
              <Boton
                variante="secundaria"
                ancho="completo"
                alTocar={() => {
                  setAbierta(false);
                }}
              >
                {textoDeCancelar}
              </Boton>
              <BotonDeEnvio ancho="completo">{verbo}</BotonDeEnvio>
            </Pila>
          </ProveedorDeEnvioDeFormulario>
        </form>
      </Superposicion>
    </>
  );
}
