"use client";

import { useActionState, useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import { Superposicion } from "../../patrones/Superposicion";
import type { DesactivarArmado } from "./modelo-de-usuarios";
import estilos from "./PantallaDeUsuarios.module.css";

type ResultadoDeDesactivar = Readonly<{ error: ErrorPublico | null }>;

export type PropsDeConfirmacionDeDesactivar = Readonly<{
  /** La acción del servidor con el id de la persona ya ligado (`.bind`): el id no viaja en un campo. */
  accion: (previo: ResultadoDeDesactivar) => Promise<ResultadoDeDesactivar>;
  textos: DesactivarArmado;
}>;

const SIN_ERROR: ResultadoDeDesactivar = { error: null };

/**
 * «Desactivar» de la ficha de una persona (maqueta `usuarios.html`, «Confirmar desactivar»; el dueño pidió confirmar, 23/11/2026): el botón abre un cuadro (`Superposicion`, propósito «confirmar»: el foco inicial va
 * al título y nunca al botón que desactiva, Escape cierra y el foco vuelve a «Desactivar») con «Cancelar» y «Desactivar». Mientras la acción corre el cuadro no se cierra ni se puede volver a confirmar: un doble toque es un
 * solo envío (y, aunque llegara el segundo, desactivar lo ya desactivado no escribe ni audita). Si el servidor rechaza, el genérico sale en el cuadro y queda abierto. Si sale bien, la acción vuelve a pedir la página: la
 * ficha ya no ofrece «Desactivar» y este componente deja de dibujarse con el cuadro.
 */
export function ConfirmacionDeDesactivar({ accion, textos }: PropsDeConfirmacionDeDesactivar) {
  const [abierta, setAbierta] = useState(false);
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  return (
    <>
      <Boton variante="peligro" ancho="completo" alTocar={() => setAbierta(true)}>
        {textos.boton}
      </Boton>
      <Superposicion
        abierta={abierta}
        titulo={textos.titulo}
        proposito="confirmar"
        alCerrar={() => setAbierta(false)}
        cerrable={!enviando}
        etiquetaDeCerrar={textos.cerrar}
      >
        <form action={enviar}>
          <ProveedorDeEnvioDeFormulario value={enviando}>
            <div className={estilos["cuerpo"]}>
              <p className={estilos["detalle-de-confirmar"]}>{textos.detalle}</p>
              {resultado.error === null ? null : <ErrorDeRespuesta error={resultado.error} />}
              <div className={estilos["acciones"]}>
                <Boton
                  variante="secundaria"
                  ancho="completo"
                  deshabilitado={enviando}
                  alTocar={() => setAbierta(false)}
                >
                  {textos.cancelar}
                </Boton>
                <Boton
                  tipo="submit"
                  variante="peligro"
                  ancho="completo"
                  enviando={enviando}
                  textoEnviando={textos.enviando}
                >
                  {textos.confirmar}
                </Boton>
              </div>
            </div>
          </ProveedorDeEnvioDeFormulario>
        </form>
      </Superposicion>
    </>
  );
}
