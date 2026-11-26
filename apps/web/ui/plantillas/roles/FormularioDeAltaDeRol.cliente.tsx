"use client";

import { useState } from "react";
import { Campo } from "../../componentes/Campo";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { GrupoDeOpciones } from "../../componentes/GrupoDeOpciones";
import { Selector } from "../../componentes/Selector";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import type { FormularioDeAltaDeRolArmado } from "./modelo-de-roles";
import estilos from "./PantallaDeRoles.module.css";

export type PropsDeFormularioDeAltaDeRol = Readonly<{
  formulario: FormularioDeAltaDeRolArmado;
  /** `crearRolAccion` con el id del rol ya ligado (`bind`): lo genera la página al abrir el formulario y es la clave de idempotencia del alta (un doble toque o un reintento no crea dos). */
  accion: AccionDeFormulario;
  rutaDeLaLista: string;
}>;

/**
 * «Nuevo rol»: nombre y de dónde empieza (sin acciones, una plantilla base o copiando otro rol). El envío arma el pedido desde lo que se ve (`origen`, y `rolDeOrigen` solo si se eligió copiar). Las acciones se
 * eligen en la ficha, con el rol ya creado. Mientras envía el botón no se puede volver a tocar; la repetición inocua la garantiza el servidor (el mismo id devuelve el mismo rol). Lo que valida el servidor
 * (el nombre, el plan, los topes) vuelve como error; esta pantalla no replica ninguna regla.
 */
export function FormularioDeAltaDeRol({
  formulario,
  accion,
  rutaDeLaLista,
}: PropsDeFormularioDeAltaDeRol) {
  const [nombre, setNombre] = useState("");
  const [origen, setOrigen] = useState<string>("VACIO");
  const [rolDeOrigen, setRolDeOrigen] = useState<string>(
    formulario.copiarDe?.opciones[0]?.id ?? "",
  );
  const enviar: AccionDeFormulario = (previo, datos) => {
    const pedido = new FormData();
    pedido.set("nombre", nombre);
    pedido.set("origen", origen);
    if (origen === "ROL") pedido.set("rolDeOrigen", rolDeOrigen);
    void datos;
    return accion(previo, pedido);
  };
  return (
    <FormularioDeAccion accion={enviar}>
      <Campo
        dato="nombre-de-rol"
        etiqueta={formulario.nombre}
        nombre="nombre"
        valor={nombre}
        alCambiar={setNombre}
        autoComplete="off"
      />
      <GrupoDeOpciones
        dato="origen-de-rol"
        nombre={formulario.origen.rotulo}
        varias={false}
        opciones={formulario.origen.opciones}
        valor={[origen]}
        alCambiar={(v) => setOrigen(v[0] ?? "VACIO")}
      />
      {origen === "ROL" && formulario.copiarDe !== null ? (
        <Selector
          dato="rol-de-origen"
          etiqueta={formulario.copiarDe.rotulo}
          nombre="rolDeOrigen"
          valor={rolDeOrigen}
          alCambiar={setRolDeOrigen}
          opciones={formulario.copiarDe.opciones.map((o) => ({
            valor: o.id,
            etiqueta: o.etiqueta,
          }))}
        />
      ) : null}
      <div className={estilos["botones"]}>
        <BotonDeEnvio>{formulario.guardar}</BotonDeEnvio>
        <EnlaceDeAccion href={rutaDeLaLista} variante="secundaria">
          {formulario.cancelar}
        </EnlaceDeAccion>
      </div>
    </FormularioDeAccion>
  );
}
