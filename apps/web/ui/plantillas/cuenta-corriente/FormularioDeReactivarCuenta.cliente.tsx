"use client";

import { useState } from "react";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";

export type PropsDeFormularioDeReactivarCuenta = Readonly<{
  /** La acción de servidor con el cliente, la ficha y la versión que se vio ya ligados (`bind`): si otra persona la cambió antes, el servidor rechaza. */
  accion: AccionDeFormulario;
  textos: Readonly<{ motivo: string; reactivar: string }>;
  puedeGuardar: boolean;
}>;

/**
 * Reactivar la cuenta corriente de un cliente (CC-5, A2; maqueta `cuenta-corriente-ficha-listado-y-cobro.html`): el motivo es obligatorio y el botón sale apagado sin él o sin permiso. Qué motivo es válido
 * (una línea de la lista de permitidos, de largo acotado) y que la versión sea la vigente lo decide el servidor al enviar. Sin pie explicativo.
 */
export function FormularioDeReactivarCuenta({
  accion,
  textos,
  puedeGuardar,
}: PropsDeFormularioDeReactivarCuenta) {
  const [motivo, setMotivo] = useState("");
  return (
    <FormularioDeAccion accion={accion}>
      <Campo
        dato="motivo-de-reactivacion-de-cuenta-corriente"
        etiqueta={textos.motivo}
        nombre="motivo"
        valor={motivo}
        alCambiar={setMotivo}
        autoComplete="off"
      />
      {puedeGuardar && motivo.trim() !== "" ? (
        <BotonDeEnvio>{textos.reactivar}</BotonDeEnvio>
      ) : (
        <Boton deshabilitado>{textos.reactivar}</Boton>
      )}
    </FormularioDeAccion>
  );
}
