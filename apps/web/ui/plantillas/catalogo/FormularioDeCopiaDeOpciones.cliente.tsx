"use client";

import { useActionState, useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { Selector } from "../../componentes/Selector";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import type { CopiaArmada } from "./modelo-de-opciones";

export type PropsDeFormularioDeCopiaDeOpciones = Readonly<{
  copia: CopiaArmada;
  /** La acción de servidor (`copiarOpcionesAccion` ya ligada al producto, a la versión y a la clave de la copia). */
  accion: AccionDeFormulario;
  /** Si el servidor deja copiar hoy: si no, «Copiar» sale apagado (solo una ayuda: el guard decide; DEC-0346). */
  puedeGuardar: boolean;
}>;

const SIN_ERROR: Readonly<{ error: ErrorPublico | null }> = { error: null };

/**
 * «Copiar de otro producto» (maqueta `productos.html`, función `vCopia`): el producto de origen y «Copiar». La copia trae los grupos que el producto no tiene y es independiente del
 * origen; qué se copia exactamente lo decide el servidor. SUPUESTO (DEC-0526): no se dibuja la vista previa de lo que se copia que trae la maqueta (pediría las opciones de cada
 * candidato y repetiría una regla del servidor); si no hay nada para copiar, el servidor lo rechaza con el mensaje genérico. Sin productos de dónde copiar, no hay selector.
 */
export function FormularioDeCopiaDeOpciones({
  copia,
  accion,
  puedeGuardar,
}: PropsDeFormularioDeCopiaDeOpciones) {
  const [resultado, enviar, enviando] = useActionState(accion, SIN_ERROR);
  const [origen, setOrigen] = useState(copia.producto?.opciones[0]?.valor ?? "");
  if (copia.producto === null) return null;
  return (
    <form action={enviar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={3}>
          <Selector
            dato="producto-de-origen-de-copia-de-opciones"
            etiqueta={copia.producto.etiqueta}
            nombre="productoOrigenId"
            valor={origen}
            alCambiar={setOrigen}
            opciones={copia.producto.opciones}
          />
          {resultado.error === null ? null : <ErrorDeRespuesta error={resultado.error} />}
          {puedeGuardar ? (
            <BotonDeEnvio>{copia.copiar}</BotonDeEnvio>
          ) : (
            <Boton deshabilitado>{copia.copiar}</Boton>
          )}
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
