"use client";

import { useState } from "react";
import { GrupoDeOpciones } from "../../componentes/GrupoDeOpciones";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import type { EditorDeSucursalesArmado } from "./modelo-de-usuarios";

export type PropsDeFormularioDeSucursalesDeUsuario = Readonly<{
  /** La acción de servidor con la persona ya ligada (`bind`): lo arma la página. Recibe una casilla tildada por cada `sucursales` del formulario; ninguna es el conjunto vacío. */
  accion: AccionDeFormulario;
  editor: EditorDeSucursalesArmado;
}>;

/**
 * El bloque «Sucursales» de la ficha de un empleado (maqueta `usuarios.html`, `vUsuario`): una casilla por sucursal activa y «Guardar». Se manda el CONJUNTO FINAL: lo tildado, o nada si no hay ninguna
 * (válido: el empleado queda sin sucursales). El envío arma él mismo el pedido desde lo que se ve tildado (no depende de que el navegador omita las casillas sin marcar), así «ninguna» es siempre
 * una elección explícita de quien tocó «Guardar». Mientras envía el botón no se puede volver a tocar; la repetición inocua la garantiza el servidor (el mismo conjunto no escribe).
 * Al terminar la acción React REINICIA el formulario y las casillas vuelven a como se dibujaron la primera vez, aunque lo tildado (el estado) sea otro: la pantalla mostraba una cosa y el
 * siguiente «Guardar» mandaba otra (medido en Chromium: tras guardar Centro y Norte, las casillas volvían a «solo Centro» unos 150 ms después). Por eso, al reiniciarse, se vuelven a dibujar
 * desde el estado (`key`). Chequeo: `Usuarios.test.tsx`.
 */
export function FormularioDeSucursalesDeUsuario({
  accion,
  editor,
}: PropsDeFormularioDeSucursalesDeUsuario) {
  const [elegidas, setElegidas] = useState<readonly string[]>(() =>
    editor.opciones.filter((o) => o.marcada).map((o) => o.id),
  );
  const [reinicios, setReinicios] = useState(0);
  const enviar: AccionDeFormulario = (previo) => {
    const datos = new FormData();
    for (const id of elegidas) datos.append("sucursales", id);
    return accion(previo, datos);
  };
  return (
    <FormularioDeAccion
      accion={enviar}
      alReiniciar={() => {
        setReinicios((n) => n + 1);
      }}
    >
      <GrupoDeOpciones
        key={reinicios}
        dato="sucursales-de-usuario"
        nombre={editor.rotulo}
        varias
        opciones={editor.opciones.map((o) => ({ id: o.id, etiqueta: o.nombre }))}
        valor={elegidas}
        alCambiar={setElegidas}
      />
      <BotonDeEnvio>{editor.guardar}</BotonDeEnvio>
    </FormularioDeAccion>
  );
}
