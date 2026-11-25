"use client";

import { useActionState, useEffect, useState } from "react";
import { Boton } from "../../../componentes/Boton.cliente";
import { ProveedorDeEnvioDeFormulario } from "../../../patrones/EnvioDeFormulario.cliente";
import { ErrorDeRespuesta } from "../../../patrones/ErrorDeRespuesta";
import { Superposicion } from "../../../patrones/Superposicion";
import { Pila } from "../../../primitivas/Pila";
import { FACTURA_INICIAL, type ResultadoDeLaFactura } from "./resultado-de-factura";

type AccionDeAnular = (
  previo: ResultadoDeLaFactura,
  datos: FormData,
) => Promise<ResultadoDeLaFactura>;

export type PropsDeAnularConciliacion = Readonly<{
  /** `anularConciliacionAccion` con la factura y la conciliación ya ligadas (`.bind`): ningún id viaja en el formulario. */
  accion: AccionDeAnular;
  textos: Readonly<{
    anularConciliacion: string;
    anular: string;
    cancelar: string;
    cerrar: string;
  }>;
}>;

/**
 * «Anular conciliación» (maqueta `compra-conciliar.html`): el botón de una fila de la lista de conciliaciones del detalle, para gerente y administrador. Abre una hoja que pide confirmar (SIN motivo: la entrada de
 * `anularConciliacion` no lo lleva, decisión del dueño del 25/11/2026). Se apaga mientras envía (un segundo toque no manda nada) y repetirlo es seguro en el servidor (una conciliación se anula una sola vez: el
 * espejo es único). Si salió bien recarga el detalle; si el servidor rechaza muestra el error ya traducido (el genérico) y el detalle de atrás se vuelve a leer. Mostrar no es autorizar: el servidor decide si se puede.
 */
export function AnularConciliacion({ accion, textos }: PropsDeAnularConciliacion) {
  const [abierta, setAbierta] = useState(false);
  const [resultado, anular, anulando] = useActionState(accion, FACTURA_INICIAL);
  const ruta = resultado.estado === "HECHO" ? resultado.ruta : null;
  useEffect(() => {
    if (ruta !== null) window.location.assign(ruta);
  }, [ruta]);
  return (
    <>
      <Boton
        variante="peligro"
        alTocar={() => {
          setAbierta(true);
        }}
      >
        {textos.anularConciliacion}
      </Boton>
      <Superposicion
        abierta={abierta}
        proposito="editar"
        titulo={textos.anularConciliacion}
        alCerrar={() => {
          setAbierta(false);
        }}
        cerrable={!anulando}
        etiquetaDeCerrar={textos.cerrar}
      >
        <form action={anular}>
          <ProveedorDeEnvioDeFormulario value={anulando}>
            <Pila separacion={3}>
              {resultado.estado === "ERROR" ? <ErrorDeRespuesta error={resultado.error} /> : null}
              <Boton
                variante="secundaria"
                alTocar={() => {
                  setAbierta(false);
                }}
              >
                {textos.cancelar}
              </Boton>
              <Boton
                tipo="submit"
                variante="peligro"
                enviando={anulando || resultado.estado === "HECHO"}
              >
                {textos.anular}
              </Boton>
            </Pila>
          </ProveedorDeEnvioDeFormulario>
        </form>
      </Superposicion>
    </>
  );
}
