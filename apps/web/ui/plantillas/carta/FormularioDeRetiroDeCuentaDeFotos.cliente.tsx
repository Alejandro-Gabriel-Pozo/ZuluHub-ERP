"use client";

import { useActionState, useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { Campo } from "../../componentes/Campo";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import { sinReiniciar } from "../../patrones/sin-reinicio";
import type { CuentasDeFotosArmadas } from "./modelo-de-cuentas-de-fotos";

export type PropsDeFormularioDeRetiroDeCuentaDeFotos = Readonly<{
  formulario: CuentasDeFotosArmadas["retirar"];
  /** La acción de servidor (`retirarLaCuentaAccion`), ligada a la cuenta (su id) y a la versión que la persona vio. */
  accion: AccionDeFormulario;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * Retirar una cuenta de fotos: el motivo (con su dato) y «Quitar». La cuenta y su versión van ligadas a la acción por la página (cifradas, no viajan en un campo): retirar dos veces es lo mismo que una, y
 * si otra persona la cambió antes el servidor rechaza sin escribir y la página recarga. Un motivo mal escrito o vacío lo rechaza el servidor (el genérico).
 */
export function FormularioDeRetiroDeCuentaDeFotos({
  formulario,
  accion,
}: PropsDeFormularioDeRetiroDeCuentaDeFotos) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  const [motivo, setMotivo] = useState("");
  return (
    <form action={enviar} onReset={sinReiniciar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={2}>
          <Campo
            dato="motivo-de-retiro-de-la-cuenta-de-foto"
            etiqueta={formulario.motivo}
            nombre="motivo"
            valor={motivo}
            alCambiar={setMotivo}
            autoComplete="off"
          />
          <BotonDeEnvio>{formulario.quitar}</BotonDeEnvio>
          {resultado.error === null ? null : <ErrorDeRespuesta error={resultado.error} />}
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
