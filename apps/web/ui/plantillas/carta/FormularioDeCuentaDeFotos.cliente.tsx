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

export type PropsDeFormularioDeCuentaDeFotos = Readonly<{
  formulario: CuentasDeFotosArmadas["declarar"];
  /** La acción de servidor (`declararLaCuentaAccion`), ligada a la clave de idempotencia que fijó la página al abrirse. */
  accion: AccionDeFormulario;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * Declarar una cuenta de fotos: un campo (la cuenta, con su dato) y «Guardar». La clave de idempotencia va ligada a la acción por la página: el doble toque y el reintento declaran UNA cuenta, y el
 * botón ignora el segundo toque mientras envía. Qué es una cuenta válida, el tope de 2 y la repetición los decide el servidor: el error, si lo hay, sale debajo con el patrón común (el genérico).
 */
export function FormularioDeCuentaDeFotos({
  formulario,
  accion,
}: PropsDeFormularioDeCuentaDeFotos) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  const [cuenta, setCuenta] = useState("");
  return (
    <form action={enviar} onReset={sinReiniciar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={3}>
          <Campo
            dato="cuenta-de-foto"
            etiqueta={formulario.cuenta}
            nombre="cuenta"
            valor={cuenta}
            alCambiar={setCuenta}
            autoComplete="off"
            autoCapitalize="off"
          />
          <BotonDeEnvio>{formulario.guardar}</BotonDeEnvio>
          {resultado.error === null ? null : <ErrorDeRespuesta error={resultado.error} />}
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
