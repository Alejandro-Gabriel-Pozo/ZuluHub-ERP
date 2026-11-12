"use client";

import { useState } from "react";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { Selector } from "../../componentes/Selector";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import type { MedioDeLaLista, OpcionDeTipo } from "./modelo-de-medios-de-pago";

export type PropsDeFormularioDeMedio = Readonly<{
  /** El medio que se edita; `null`: es un alta. */
  original: MedioDeLaLista | null;
  tipos: readonly OpcionDeTipo[];
  /** La acción de servidor (`agregarMedioAccion` o `editarMedioAccion` ya ligada al id y la versión). */
  accion: AccionDeFormulario;
  textos: Readonly<{ tipo: string; nombre: string; guardar: string }>;
  /** Si el servidor deja guardar hoy: si no, «Guardar» sale apagado (solo una ayuda: el guard decide). */
  puedeGuardar: boolean;
}>;

/**
 * Alta y edición de un medio de pago en una sola pantalla (maqueta `medios.html`, 09/11/2026): el tipo de una lista cerrada (no se cambia después: en la edición sale
 * apagado) y el nombre, opcional. La validez la decide el servidor: acá no se valida nada. El error vuelve debajo, con el texto del catálogo. Repetir el
 * envío no duplica: el servidor devuelve el medio que ya existe (alta) o no escribe (versión igual).
 */
export function FormularioDeMedio({
  original,
  tipos,
  accion,
  textos,
  puedeGuardar,
}: PropsDeFormularioDeMedio) {
  const [tipo, setTipo] = useState(original?.tipo ?? tipos[0]?.valor ?? "");
  const [nombre, setNombre] = useState(original?.nombre ?? "");
  return (
    <FormularioDeAccion accion={accion}>
      <Selector
        dato="tipo-de-medio-de-pago"
        etiqueta={textos.tipo}
        nombre="tipo"
        valor={tipo}
        alCambiar={setTipo}
        opciones={tipos}
        deshabilitado={original !== null}
      />
      <Campo
        dato="nombre-de-medio-de-pago"
        etiqueta={textos.nombre}
        nombre="nombre"
        valor={nombre}
        alCambiar={setNombre}
        autoComplete="off"
      />
      {puedeGuardar ? (
        <BotonDeEnvio>{textos.guardar}</BotonDeEnvio>
      ) : (
        <Boton deshabilitado>{textos.guardar}</Boton>
      )}
    </FormularioDeAccion>
  );
}
