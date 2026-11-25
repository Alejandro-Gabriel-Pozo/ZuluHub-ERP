"use client";

import { useActionState, useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { Selector } from "../../componentes/Selector";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import estilos from "./PantallasDeMesas.module.css";
import type { FormularioDeImpresoraArmado } from "./modelo-de-impresoras";

export type PropsDeFormularioDeImpresora = Readonly<{
  formulario: FormularioDeImpresoraArmado;
  /** La acción de servidor (`crearImpresoraAccion` ligada al id de la impresora, o `editarImpresoraAccion` ligada a la impresora y su versión). */
  accion: AccionDeFormulario;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * Alta y edición de una impresora (maqueta `imprimir.html`, «Agregar impresora»: el mismo formulario): nombre, para qué sirve y papel, «Cancelar» y «Guardar». La validez la decide el servidor (nombre de 1 a 40, que
 * no se repita en la sucursal, uso y papel de las listas cerradas): acá solo se ofrece «Guardar» con el nombre escrito (la maqueta: sin nombre no se guarda). El error sale debajo con el patrón común: el genérico.
 * Repetir el envío no duplica: el id de la impresora (o la versión) va ligado a la acción por la página y el botón ignora el segundo toque. Sin permiso, «Guardar» sale apagado.
 */
export function FormularioDeImpresora({ formulario, accion }: PropsDeFormularioDeImpresora) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  const [nombre, setNombre] = useState(formulario.nombre.valorInicial);
  const [uso, setUso] = useState(formulario.uso.valorInicial);
  const [papel, setPapel] = useState(formulario.papel.valorInicial);
  const completo = nombre.trim() !== "";
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
              dato="nombre-de-impresora"
              etiqueta={formulario.nombre.etiqueta}
              nombre="nombre"
              valor={nombre}
              alCambiar={setNombre}
              autoComplete="off"
            />
            <Selector
              dato="uso-de-impresora"
              etiqueta={formulario.uso.etiqueta}
              nombre="uso"
              valor={uso}
              alCambiar={setUso}
              opciones={formulario.uso.opciones}
            />
            <Selector
              dato="papel-de-impresora"
              etiqueta={formulario.papel.etiqueta}
              nombre="papelMm"
              valor={papel}
              alCambiar={setPapel}
              opciones={formulario.papel.opciones}
            />
            {resultado.error === null ? null : <ErrorDeRespuesta error={resultado.error} />}
            <div className={estilos["acciones"]}>
              <a className={estilos["secundario"]} href={formulario.cancelar.href}>
                {formulario.cancelar.texto}
              </a>
              {formulario.puedeGuardar && completo ? (
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
