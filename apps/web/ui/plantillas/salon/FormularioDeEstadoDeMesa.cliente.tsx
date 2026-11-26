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

export type PropsDeFormularioDeEstadoDeMesa = Readonly<{
  /** «Desactivar» o «Reactivar», ya resuelto. */
  texto: string;
  /** La acción de servidor (`desactivarMesaAccion` o `reactivarMesaAccion`, ligada a la mesa). */
  accion: AccionDeFormulario;
  /** Si la persona puede administrar las mesas: si no, el botón sale apagado (solo una ayuda: el guard decide). */
  apagado: boolean;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * «Desactivar» / «Reactivar» una mesa (maqueta `mesas.html`): un botón de envío sin campos. Repetir no duplica: desactivar lo ya desactivado (y reactivar lo ya activo) es éxito sin
 * escribir, y el botón ignora el segundo toque mientras corre. El error (por ejemplo, una mesa con cuenta abierta) sale debajo con el patrón común: el mensaje genérico.
 */
export function FormularioDeEstadoDeMesa({
  texto,
  accion,
  apagado,
}: PropsDeFormularioDeEstadoDeMesa) {
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
