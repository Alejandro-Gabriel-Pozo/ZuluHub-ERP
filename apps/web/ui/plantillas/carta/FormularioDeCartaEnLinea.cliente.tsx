"use client";

import { useActionState, useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import type { CartaEnLineaArmada } from "./modelo-de-carta-en-linea";

export type PropsDeFormularioDeCartaEnLinea = Readonly<{
  formulario: CartaEnLineaArmada["formulario"];
  /** La acción de servidor (`guardarLosTextosAccion`), ligada a la carta, la sucursal y la versión que se vio. */
  accion: AccionDeFormulario;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * Los textos de la carta (maqueta `carta-en-linea.html`): nombre, rubro y lugar. La validez la decide el servidor: acá solo se ofrece «Guardar» con un nombre que no esté vacío y con permiso. Un
 * error que apunta al nombre se asocia a él (`aria-describedby`); el resto sale debajo con el patrón común. Repetir el envío no duplica: la clave de la carta (y su versión) va ligada a la acción por
 * la página, y el botón solo ignora el segundo toque. Sin permiso, «Guardar» sale apagado.
 */
export function FormularioDeCartaEnLinea({ formulario, accion }: PropsDeFormularioDeCartaEnLinea) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  const [nombre, setNombre] = useState(formulario.nombre.valorInicial);
  const [rubro, setRubro] = useState(formulario.rubro.valorInicial);
  const [lugar, setLugar] = useState(formulario.lugar.valorInicial);
  const error = resultado.error;
  const delNombre = error?.campo === "nombre";
  return (
    <form action={enviar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={3}>
          <Campo
            dato="nombre-de-la-carta"
            etiqueta={formulario.nombre.etiqueta}
            nombre="nombre"
            valor={nombre}
            alCambiar={setNombre}
            autoComplete="off"
            error={delNombre ? texto({}, error.clave) : undefined}
          />
          <Campo
            dato="rubro-de-la-carta"
            etiqueta={formulario.rubro.etiqueta}
            nombre="rubro"
            valor={rubro}
            alCambiar={setRubro}
            autoComplete="off"
          />
          <Campo
            dato="lugar-de-la-carta"
            etiqueta={formulario.lugar.etiqueta}
            nombre="lugar"
            valor={lugar}
            alCambiar={setLugar}
            autoComplete="off"
          />
          {error === null || delNombre ? null : <ErrorDeRespuesta error={error} />}
          {formulario.puedeGuardar && nombre.trim() !== "" ? (
            <BotonDeEnvio>{formulario.guardar}</BotonDeEnvio>
          ) : (
            <Boton deshabilitado>{formulario.guardar}</Boton>
          )}
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
