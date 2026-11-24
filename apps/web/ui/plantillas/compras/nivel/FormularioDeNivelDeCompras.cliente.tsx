"use client";

import { useActionState, useRef, useState } from "react";
import { Boton } from "../../../componentes/Boton.cliente";
import { Selector } from "../../../componentes/Selector";
import { ProveedorDeEnvioDeFormulario } from "../../../patrones/EnvioDeFormulario.cliente";
import { ErrorDeRespuesta } from "../../../patrones/ErrorDeRespuesta";
import { Pila } from "../../../primitivas/Pila";
import {
  hayCambios,
  nivelVigente,
  opcionesDeNivel,
  type NivelParaLaPantalla,
  type TextosDeNivelDeCompras,
} from "./modelo-de-nivel-de-compras";
import { GUARDAR_EL_NIVEL_INICIAL, type ResultadoDeGuardarElNivel } from "./resultado-de-nivel";

export type PropsDeFormularioDeNivelDeCompras = Readonly<{
  inicial: NivelParaLaPantalla;
  /** `guardarNivelDeComprasAccion`, con la versión que se vio ya ligada (`.bind`): la versión no viaja en el formulario. */
  accion: (
    versionVista: number,
    previo: ResultadoDeGuardarElNivel,
    datos: FormData,
  ) => Promise<ResultadoDeGuardarElNivel>;
  textos: TextosDeNivelDeCompras;
}>;

/**
 * «Nivel de compras» (maqueta `compra-nivel.html`): un selector con los niveles y «Guardar». «Guardar» está apagado mientras no haya nada distinto de lo vigente y no se vuelve a tocar mientras envía
 * (`Boton` con `enviando`). Si salió bien, la pantalla sigue con el nivel y la versión que devolvió el servidor; si otra persona lo cambió antes, el servidor rechaza sin escribir, se muestra el error
 * genérico y el selector pasa al nivel que quedó. Sin pedir confirmación ni explicar (sobrio). Mostrar no es autorizar: el servidor decide.
 */
export function FormularioDeNivelDeCompras({
  inicial,
  accion,
  textos,
}: PropsDeFormularioDeNivelDeCompras) {
  // La versión que se vio vive en una referencia: cada guardado lleva la última que devolvió el servidor, sin depender de qué copia de la acción esté viva.
  const version = useRef(inicial.version);
  const [resultado, enviar, enviando] = useActionState(
    async (previo: ResultadoDeGuardarElNivel, datos: FormData) => {
      const siguiente = await accion(version.current, previo, datos);
      if (siguiente.estado === "HECHO") version.current = siguiente.version;
      else if (siguiente.estado === "ERROR" && siguiente.vigente !== null) {
        version.current = siguiente.vigente.version;
      }
      return siguiente;
    },
    GUARDAR_EL_NIVEL_INICIAL,
  );
  const vigente = nivelVigente(resultado, inicial.nivel);
  const [elegido, setElegido] = useState<string>(inicial.nivel);
  const [resultadoVisto, setResultadoVisto] = useState(resultado);
  if (resultadoVisto !== resultado) {
    // Tras guardar (o tras el rechazo por versión) el selector pasa al nivel que quedó vigente.
    setResultadoVisto(resultado);
    setElegido(vigente);
  }
  return (
    <form action={enviar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={3}>
          <Selector
            dato="nivel-de-compras"
            etiqueta={textos.titulo}
            nombre="nivel"
            valor={elegido}
            alCambiar={setElegido}
            opciones={opcionesDeNivel(inicial.niveles, textos)}
          />
          {resultado.estado === "ERROR" ? <ErrorDeRespuesta error={resultado.error} /> : null}
          <Boton tipo="submit" enviando={enviando} deshabilitado={!hayCambios(vigente, elegido)}>
            {textos.guardar}
          </Boton>
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
