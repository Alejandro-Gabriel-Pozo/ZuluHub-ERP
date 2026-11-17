"use client";

import { useState } from "react";
import { Campo } from "../../componentes/Campo";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeConfiguracion } from "./FormularioDeConfiguracion.cliente";

export type PropsDeFormularioDeCaja = Readonly<{
  /** El nombre actual de la caja que se edita; `null`: es un alta. */
  nombreOriginal: string | null;
  accion: AccionDeFormulario;
  textos: Readonly<{ nombre: string; guardar: string }>;
  puedeGuardar: boolean;
}>;

/**
 * Alta y edición de una caja (maqueta `medios.html`, 09/11/2026): solo su nombre. La sucursal es la elegida en el dispositivo y la fija el servidor, no el formulario. Sumar
 * una caja por encima de lo que incluye el plan lo rechaza el servidor al guardar, con el mensaje genérico: la pantalla no replica la regla del plan.
 */
export function FormularioDeCaja({
  nombreOriginal,
  accion,
  textos,
  puedeGuardar,
}: PropsDeFormularioDeCaja) {
  const [nombre, setNombre] = useState(nombreOriginal ?? "");
  return (
    <FormularioDeConfiguracion
      accion={accion}
      textoGuardar={textos.guardar}
      puedeGuardar={puedeGuardar && nombre.trim() !== ""}
    >
      <Campo
        dato="nombre-de-caja"
        etiqueta={textos.nombre}
        nombre="nombre"
        valor={nombre}
        alCambiar={setNombre}
        autoComplete="off"
      />
    </FormularioDeConfiguracion>
  );
}
