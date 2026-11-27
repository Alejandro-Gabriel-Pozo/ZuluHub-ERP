"use client";

import { useState } from "react";
import { texto } from "../../../../../../src/capacidades/vocabulario/vocabulario";
import { AreaDeTexto } from "../../../componentes/AreaDeTexto";
import { Boton } from "../../../componentes/Boton.cliente";
import { BotonDeEnvio } from "../../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../../patrones/FormularioDeAccion.cliente";

export type PropsDeFormularioDeCancelarConteo = Readonly<{
  /** La acción de servidor con el conteo ya ligado (`bind`): cancelar dos veces es uno. */
  accion: AccionDeFormulario;
  /** Si la persona puede cancelar (el servidor igual decide). */
  puedeEnviar: boolean;
}>;

/**
 * «Cancelar conteo» (FP-STK-10): pide el motivo (obligatorio, lo valida el servidor) y no cambia nada del libro. Sale apagado sin el permiso (`conteos.cancelar`: gerente y administrador). Un conteo aplicado no se cancela
 * (lo rechaza el servidor). Después de cancelar se vuelve a «Abrir conteo».
 */
export function FormularioDeCancelarConteo({
  accion,
  puedeEnviar,
}: PropsDeFormularioDeCancelarConteo) {
  const [motivo, setMotivo] = useState("");
  return (
    <FormularioDeAccion accion={accion}>
      <AreaDeTexto
        dato="detalle-de-movimiento-de-stock"
        etiqueta={texto({}, "stock.accion.detalle")}
        nombre="motivo"
        valor={motivo}
        alCambiar={setMotivo}
      />
      {puedeEnviar && motivo.trim() !== "" ? (
        <BotonDeEnvio variante="secundaria">{texto({}, "stock.conteo.cancelar")}</BotonDeEnvio>
      ) : (
        <Boton deshabilitado variante="secundaria">
          {texto({}, "stock.conteo.cancelar")}
        </Boton>
      )}
    </FormularioDeAccion>
  );
}
