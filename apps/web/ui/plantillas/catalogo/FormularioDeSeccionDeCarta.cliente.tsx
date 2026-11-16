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
import estilos from "./PantallasDeSecciones.module.css";
import { sePuedeGuardarElNombre, type FormularioDeSeccionArmado } from "./modelo-de-secciones";

export type PropsDeFormularioDeSeccionDeCarta = Readonly<{
  formulario: FormularioDeSeccionArmado;
  /** La acción de servidor (`crearSeccionAccion` ligada a la clave de creación, o `renombrarSeccionAccion` ligada a la sección y su versión). */
  accion: AccionDeFormulario;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * El nombre de una sección de la carta (maqueta `productos-secciones.html`: «Nueva sección» y «Renombrar», el mismo formulario): el nombre, «Cancelar» y «Guardar». La validez la decide el
 * servidor: acá solo se ofrece «Guardar» con un nombre que no esté vacío. Un error que apunta al campo se asocia a él (`aria-describedby`); el resto sale debajo con el patrón común. Repetir el
 * envío no duplica: la clave de creación (o la versión) va ligada a la acción por la página, y el botón solo ignora el segundo toque. Sin permiso, «Guardar» sale apagado.
 */
export function FormularioDeSeccionDeCarta({
  formulario,
  accion,
}: PropsDeFormularioDeSeccionDeCarta) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  const [nombre, setNombre] = useState(formulario.nombre.valorInicial);
  const error = resultado.error;
  const delNombre = error?.campo === "nombre";
  return (
    <div className={estilos["raiz"]}>
      <a
        className={estilos["volver"]}
        href={formulario.volver.href}
        aria-label={formulario.volver.etiqueta}
      >
        <span aria-hidden="true">‹</span>
      </a>
      <form action={enviar}>
        <ProveedorDeEnvioDeFormulario value={enviando}>
          <Pila separacion={3}>
            <Campo
              dato="nombre-de-seccion-de-carta"
              etiqueta={formulario.nombre.etiqueta}
              nombre="nombre"
              valor={nombre}
              alCambiar={setNombre}
              autoComplete="off"
              error={delNombre ? texto({}, error.clave) : undefined}
            />
            {error === null || delNombre ? null : <ErrorDeRespuesta error={error} />}
            <div className={estilos["acciones"]}>
              <a className={estilos["secundario"]} href={formulario.cancelar.href}>
                {formulario.cancelar.texto}
              </a>
              {formulario.puedeGuardar && sePuedeGuardarElNombre(nombre) ? (
                <BotonDeEnvio>{formulario.guardar}</BotonDeEnvio>
              ) : (
                <Boton deshabilitado>{formulario.guardar}</Boton>
              )}
            </div>
          </Pila>
        </ProveedorDeEnvioDeFormulario>
      </form>
    </div>
  );
}
