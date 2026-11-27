"use client";

import { useState } from "react";
import { Campo } from "../../componentes/Campo";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import type { FormularioDeAltaDeSucursalArmado } from "./modelo-de-sucursales";
import estilos from "./PantallaDeSucursales.module.css";

export type PropsDeFormularioDeAltaDeSucursal = Readonly<{
  formulario: FormularioDeAltaDeSucursalArmado;
  accion: AccionDeFormulario;
  rutaDeLaLista: string;
}>;

/**
 * «Nueva sucursal»: solo el nombre. Mientras envía el botón no se puede volver a tocar; la repetición inocua (doble toque, reintento) la garantiza el servidor: el mismo nombre devuelve la misma sucursal. Lo que valida
 * el servidor (el nombre, el plan, los topes) vuelve como error; esta pantalla no replica ninguna regla.
 */
export function FormularioDeAltaDeSucursal({
  formulario,
  accion,
  rutaDeLaLista,
}: PropsDeFormularioDeAltaDeSucursal) {
  const [nombre, setNombre] = useState("");
  const enviar: AccionDeFormulario = (previo, datos) => {
    const pedido = new FormData();
    pedido.set("nombre", nombre);
    void datos;
    return accion(previo, pedido);
  };
  return (
    <FormularioDeAccion accion={enviar}>
      <Campo
        dato="nombre-de-sucursal"
        etiqueta={formulario.nombre}
        nombre="nombre"
        valor={nombre}
        alCambiar={setNombre}
        autoComplete="off"
      />
      <div className={estilos["botones"]}>
        <BotonDeEnvio>{formulario.guardar}</BotonDeEnvio>
        <EnlaceDeAccion href={rutaDeLaLista} variante="secundaria">
          {formulario.cancelar}
        </EnlaceDeAccion>
      </div>
    </FormularioDeAccion>
  );
}
