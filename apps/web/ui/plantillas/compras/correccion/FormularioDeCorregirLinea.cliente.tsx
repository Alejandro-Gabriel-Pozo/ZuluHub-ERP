"use client";

import { useActionState, useEffect, useState } from "react";
import { AreaDeTexto } from "../../../componentes/AreaDeTexto";
import { Boton } from "../../../componentes/Boton.cliente";
import { CampoImporte } from "../../../componentes/CampoImporte";
import { ProveedorDeEnvioDeFormulario } from "../../../patrones/EnvioDeFormulario.cliente";
import { ErrorDeRespuesta } from "../../../patrones/ErrorDeRespuesta";
import { Pila } from "../../../primitivas/Pila";
import { CORREGIR_INICIAL, type ResultadoDeCorregir } from "./resultado-de-correccion";

export type PropsDeFormularioDeCorregirLinea = Readonly<{
  /** `corregirLaLineaAccion` con la compra, la línea, las correcciones que se vieron y la clave de este intento ya ligadas (`.bind`): no viajan en el formulario. */
  accion: (previo: ResultadoDeCorregir, datos: FormData) => Promise<ResultadoDeCorregir>;
  textos: Readonly<{
    /** El rótulo del precio de la línea («Precio por Kilogramo»). */
    precio: string;
    motivo: string;
    corregir: string;
  }>;
}>;

/**
 * «Corregir» una línea de la compra (maqueta `compra-corregir-anular.html`, `vForm`): el precio nuevo y el motivo. El precio arranca VACÍO (la maqueta lo precarga, pero el campo de importe trabaja con
 * dos decimales y un precio guardado con más se recortaría en silencio: quien corrige escribe el que corresponde). «Corregir» queda apagado hasta tener precio y motivo y no se vuelve a tocar mientras
 * envía (`Boton` con `enviando`); repetir el envío es seguro en el servidor (la clave de este intento repite la misma corrección sin escribir dos veces). Si salió bien navega a la ficha, que ya
 * muestra la corrección; si no, el error ya traducido queda debajo. Mostrar no es autorizar: el servidor decide.
 */
export function FormularioDeCorregirLinea({ accion, textos }: PropsDeFormularioDeCorregirLinea) {
  const [precio, setPrecio] = useState("");
  const [motivo, setMotivo] = useState("");
  const [resultado, enviar, enviando] = useActionState(accion, CORREGIR_INICIAL);
  const ruta = resultado.estado === "HECHO" ? resultado.ruta : null;
  useEffect(() => {
    if (ruta !== null) window.location.assign(ruta);
  }, [ruta]);
  return (
    <form action={enviar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={3}>
          <CampoImporte
            dato="precio-corregido-de-compra"
            etiqueta={textos.precio}
            nombre="precio"
            valor={precio}
            alCambiar={setPrecio}
          />
          <AreaDeTexto
            dato="motivo-de-correccion-de-compra"
            etiqueta={textos.motivo}
            nombre="motivo"
            valor={motivo}
            alCambiar={setMotivo}
          />
          {resultado.estado === "ERROR" ? <ErrorDeRespuesta error={resultado.error} /> : null}
          <Boton
            tipo="submit"
            enviando={enviando || ruta !== null}
            deshabilitado={precio === "" || motivo.trim() === ""}
          >
            {textos.corregir}
          </Boton>
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
