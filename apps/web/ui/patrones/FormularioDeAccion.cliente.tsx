"use client";

import { useActionState, type ReactNode } from "react";
import type { ErrorPublico } from "../../../../src/capacidades/experiencia/respuesta";
import type { DiccionarioResuelto } from "../../../../src/capacidades/vocabulario/vocabulario";
import { Pila } from "../primitivas/Pila";
import { ErrorDeRespuesta } from "./ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "./EnvioDeFormulario.cliente";

/** Lo que devuelve una acción de formulario: nada si salió bien (redirige) o el error ya traducido. */
type ResultadoDeFormulario = Readonly<{ error: ErrorPublico | null }>;

export type AccionDeFormulario = (
  previo: ResultadoDeFormulario,
  datos: FormData,
) => Promise<ResultadoDeFormulario>;

export type PropsDeFormularioDeAccion = Readonly<{
  accion: AccionDeFormulario;
  /** Los campos y el botón (`BotonDeEnvio`). */
  children: ReactNode;
  diccionario?: DiccionarioResuelto;
}>;

const SIN_ERROR: ResultadoDeFormulario = { error: null };

/**
 * Un formulario cuya acción es del servidor. Anda sin JavaScript (el formulario se envía igual) y, con él,
 * muestra el error de la acción debajo, con el patrón que le toca. No guarda nada: el error es la última
 * respuesta del servidor.
 */
export function FormularioDeAccion({ accion, children, diccionario }: PropsDeFormularioDeAccion) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  return (
    <form action={enviar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={3}>
          {children}
          {resultado.error === null ? null : (
            <ErrorDeRespuesta
              error={resultado.error}
              {...(diccionario === undefined ? {} : { diccionario })}
            />
          )}
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
