"use client";

import { useState } from "react";
import { Selector } from "../../componentes/Selector";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import type { EditorDeRolDeUsuarioArmado } from "./modelo-de-roles";

export type PropsDeFormularioDeRolDeUsuario = Readonly<{
  editor: EditorDeRolDeUsuarioArmado;
  /** `asignarRolAccion` con la persona ya ligada (`bind`, Next la cifra): del formulario solo viaja el rol elegido. */
  accion: AccionDeFormulario;
}>;

/**
 * El bloque «Rol» de la ficha de una persona (solo el gerente): un selector con los dos roles base y los roles propios activos, y «Guardar». El envío arma el pedido desde lo que se ve (`rol`: `BASE:<rol>` o
 * `PROPIO:<id>`). Mientras envía el botón no se puede volver a tocar; la repetición inocua la garantiza el servidor (el mismo rol no escribe ni audita). El formulario no se reinicia al terminar (`sinReiniciar`, en
 * `FormularioDeAccion`). Lo que el servidor rechaza (un rol archivado, otra empresa, el gerente) vuelve como el genérico; esta pantalla no replica ninguna regla.
 */
export function FormularioDeRolDeUsuario({ editor, accion }: PropsDeFormularioDeRolDeUsuario) {
  const [rol, setRol] = useState(editor.valorInicial);
  const enviar: AccionDeFormulario = (previo, datos) => {
    const pedido = new FormData();
    pedido.set("rol", rol);
    void datos;
    return accion(previo, pedido);
  };
  return (
    <FormularioDeAccion accion={enviar}>
      <Selector
        dato="rol-de-usuario"
        etiqueta={editor.rotulo}
        nombre="rol"
        valor={rol}
        alCambiar={setRol}
        opciones={editor.opciones}
      />
      <BotonDeEnvio>{editor.guardar}</BotonDeEnvio>
    </FormularioDeAccion>
  );
}
