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

export type PropsDeFormularioDeEstadoDeCarta = Readonly<{
  /** «Poner en línea» o «Sacar de línea», ya resuelto. */
  texto: string;
  /** La acción de servidor, ligada a la carta, su versión y el estado que pide (`estadoDeLaCartaAccion`). */
  accion: AccionDeFormulario;
  /** Si la persona puede (o la carta no tiene productos que salgan): si no, el botón sale apagado (solo una ayuda: el guard decide). */
  apagado: boolean;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * «Poner en línea» / «Sacar de línea» (maqueta `carta-en-linea.html`): un botón de envío sin campos. La acción pide un ESTADO, no alterna: el segundo toque (o un reintento) es éxito sin escribir, y
 * el botón ignora el segundo toque mientras envía. El error, si lo hay, sale debajo con el patrón común.
 */
export function FormularioDeEstadoDeCarta({
  texto,
  accion,
  apagado,
}: PropsDeFormularioDeEstadoDeCarta) {
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
            <BotonDeEnvio>{texto}</BotonDeEnvio>
          )}
          {resultado.error === null ? null : <ErrorDeRespuesta error={resultado.error} />}
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
