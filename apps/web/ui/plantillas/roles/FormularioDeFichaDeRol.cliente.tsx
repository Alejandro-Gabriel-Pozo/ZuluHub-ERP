"use client";

import { useState } from "react";
import { Campo } from "../../componentes/Campo";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { GrupoDeOpciones } from "../../componentes/GrupoDeOpciones";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import type { FichaDeRolArmada } from "./modelo-de-roles";
import estilos from "./PantallaDeRoles.module.css";

export type PropsDeFormularioDeFichaDeRol = Readonly<{
  ficha: FichaDeRolArmada;
  /** `guardarRolAccion` con el rol y la versión que se vio ya ligados (`bind`, Next los cifra): si otra persona lo cambió antes, el servidor rechaza y la ficha vuelve a leer. */
  accion: AccionDeFormulario;
  rutaDeLaLista: string;
}>;

const mismoConjunto = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * La ficha de un rol propio: nombre y, por módulo, una casilla por acción (lo cerrado se ve y se lee como tal, con su nota). El envío arma el pedido desde lo que se ve: el nombre y, SOLO si el conjunto de
 * acciones cambió, el conjunto final (`conjunto=1` más una `acciones` por casilla tildada). Así renombrar no toca las acciones (y no pierde las de un módulo que el plan hoy no incluye). El formulario no
 * se reinicia al terminar (`sinReiniciar`, en `FormularioDeAccion`). Mientras envía el botón no se puede volver a tocar; repetir la misma edición no escribe (el caso de uso lo resuelve).
 * Un rol archivado se ve, pero no se edita: la ficha solo ofrece «Reactivar» (en la página, no acá).
 */
export function FormularioDeFichaDeRol({
  ficha,
  accion,
  rutaDeLaLista,
}: PropsDeFormularioDeFichaDeRol) {
  const [nombre, setNombre] = useState(ficha.nombreInicial);
  const [elegidas, setElegidas] = useState<readonly string[]>(ficha.queHace.marcadas);
  const enviar: AccionDeFormulario = (previo, datos) => {
    const pedido = new FormData();
    pedido.set("nombre", nombre);
    if (!mismoConjunto(elegidas, ficha.queHace.marcadas)) {
      pedido.set("conjunto", "1");
      for (const id of elegidas) pedido.append("acciones", id);
    }
    void datos;
    return accion(previo, pedido);
  };
  return (
    <FormularioDeAccion accion={enviar}>
      <Campo
        dato="nombre-de-rol"
        etiqueta={ficha.nombre}
        nombre="nombre"
        valor={nombre}
        alCambiar={setNombre}
        autoComplete="off"
        deshabilitado={!ficha.activo}
      />
      <fieldset className={estilos["grupo"]}>
        <legend>{ficha.queHace.rotulo}</legend>
        {ficha.queHace.grupos.map((g) => (
          <GrupoDeOpciones
            key={g.modulo}
            dato="acciones-de-rol"
            nombre={g.nombre}
            varias
            opciones={g.opciones}
            valor={elegidas}
            alCambiar={(valor) =>
              setElegidas((previas) => [
                ...previas.filter((id) => !g.opciones.some((o) => o.id === id)),
                ...valor.filter((id) => g.opciones.some((o) => o.id === id)),
              ])
            }
            deshabilitado={!ficha.activo}
          />
        ))}
      </fieldset>
      <div className={estilos["botones"]}>
        {ficha.activo ? <BotonDeEnvio>{ficha.guardar}</BotonDeEnvio> : null}
        <EnlaceDeAccion href={rutaDeLaLista} variante="secundaria">
          {ficha.cancelar}
        </EnlaceDeAccion>
      </div>
    </FormularioDeAccion>
  );
}
