"use client";

import { useActionState } from "react";
import type { ErrorPublico } from "../../../../../../src/capacidades/experiencia/respuesta";
import { BotonDeEnvio } from "../../../patrones/BotonDeEnvio.cliente";
import { ErrorDeRespuesta } from "../../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../../primitivas/Pila";

export type PropsDeFormularioDeEstadoDeDeposito = Readonly<{
  /** «Desactivar» o «Reactivar», ya resuelto. */
  texto: string;
  /** La acción de servidor con el depósito y el sentido ya ligados (`bind`): sin campos. */
  accion: AccionDeFormulario;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * «Desactivar» o «Reactivar» un depósito (maqueta `stock-depositos-gestion.html`, 25/11/2026): un botón de envío sin campos y sin confirmación, porque no destruye nada (se puede reactivar).
 * Repetir no duplica ni audita de nuevo: el servidor devuelve éxito si ya estaba así, y el botón ignora el segundo toque. Si el servidor lo rechaza (es el de venta, tiene existencia o un conteo
 * abierto) el motivo sale debajo con el patrón común. Solo se dibuja para quien tiene el permiso: el guard igual decide en el servidor.
 */
export function FormularioDeEstadoDeDeposito({
  texto,
  accion,
}: PropsDeFormularioDeEstadoDeDeposito) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  return (
    <form action={enviar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={2}>
          <BotonDeEnvio variante="secundaria">{texto}</BotonDeEnvio>
          {resultado.error === null ? null : <ErrorDeRespuesta error={resultado.error} />}
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
