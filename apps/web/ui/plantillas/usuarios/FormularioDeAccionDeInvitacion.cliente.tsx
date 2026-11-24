"use client";

import { useActionState, useEffect } from "react";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { Pila } from "../../primitivas/Pila";
import {
  ACCION_DE_INVITACION_INICIAL,
  type ResultadoDeAccionDeInvitacion,
} from "./resultado-de-usuarios";

export type PropsDeFormularioDeAccionDeInvitacion = Readonly<{
  /** `reenviarInvitacionAccion` o `revocarInvitacionAccion`, con el id de la invitación ya ligado (`.bind`): el id no viaja en el formulario. */
  accion: (
    previo: ResultadoDeAccionDeInvitacion,
    datos: FormData,
  ) => Promise<ResultadoDeAccionDeInvitacion>;
  /** El verbo del botón, ya resuelto («Reenviar», «Revocar»). */
  texto: string;
  variante?: "primaria" | "secundaria" | "peligro";
}>;

/**
 * Un botón de acción sobre una invitación (maqueta `usuarios.html`, `vInvitacion`): un formulario de un solo botón. Mientras envía no se vuelve a tocar (`BotonDeEnvio`); repetir la acción es
 * seguro en el servidor (reenviar devuelve la misma nueva, revocar no escribe dos veces). Si salió bien, navega a lo que dice la acción (`window.location.assign`: la acción no redirige); si
 * no, el error ya traducido queda debajo del botón.
 */
export function FormularioDeAccionDeInvitacion({
  accion,
  texto,
  variante,
}: PropsDeFormularioDeAccionDeInvitacion) {
  const [resultado, enviar, enviando] = useActionState(accion, ACCION_DE_INVITACION_INICIAL);
  const ruta = resultado.estado === "HECHO" ? resultado.ruta : null;

  useEffect(() => {
    if (ruta !== null) window.location.assign(ruta);
  }, [ruta]);

  return (
    <form action={enviar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={3}>
          <BotonDeEnvio {...(variante === undefined ? {} : { variante })}>{texto}</BotonDeEnvio>
          {resultado.estado === "ERROR" ? <ErrorDeRespuesta error={resultado.error} /> : null}
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
