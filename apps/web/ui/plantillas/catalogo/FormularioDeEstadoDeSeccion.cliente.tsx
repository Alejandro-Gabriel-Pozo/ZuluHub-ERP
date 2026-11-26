"use client";

import { useActionState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import { sinReiniciar } from "../../patrones/sin-reinicio";

export type PropsDeFormularioDeEstadoDeSeccion = Readonly<{
  /** «Desactivar» o «Reactivar», ya resuelto. */
  texto: string;
  /** La acción de servidor (`desactivarSeccionAccion` o `reactivarSeccionAccion`, ligada a la sección). */
  accion: AccionDeFormulario;
  /** Si la persona puede editar: si no, el botón sale apagado (solo una ayuda: el guard decide; DEC-0346). */
  apagado: boolean;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * «Desactivar» / «Reactivar» una sección (maqueta `productos-secciones.html`): un botón de envío sin campos. Es el mismo botón en el mismo lugar cuando cambia el estado (solo cambia su texto
 * y su acción), así el foco no se pierde al tocarlo. Repetir no duplica: desactivar lo ya desactivado (y reactivar lo ya activo) es éxito sin escribir; el botón solo ignora el segundo toque.
 * El error, si lo hay, sale debajo con el patrón común.
 */
export function FormularioDeEstadoDeSeccion({
  texto,
  accion,
  apagado,
}: PropsDeFormularioDeEstadoDeSeccion) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  return (
    <form action={enviar} onReset={sinReiniciar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={2}>
          {apagado ? (
            <Boton variante="secundaria" deshabilitado>
              {texto}
            </Boton>
          ) : (
            <BotonDeEnvio variante="secundaria">{texto}</BotonDeEnvio>
          )}
          {resultado.error === null ? null : <ErrorDeRespuesta error={resultado.error} />}
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
