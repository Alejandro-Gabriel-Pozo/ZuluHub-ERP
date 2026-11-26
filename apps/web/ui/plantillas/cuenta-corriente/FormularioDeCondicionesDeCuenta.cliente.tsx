"use client";

import { useState } from "react";
import { Boton } from "../../componentes/Boton.cliente";
import { CampoImporte } from "../../componentes/CampoImporte";
import { CampoNumero } from "../../componentes/CampoNumero";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import estilos from "./CuentaCorriente.module.css";

export type PropsDeFormularioDeCondicionesDeCuenta = Readonly<{
  /** La acción de servidor con el cliente, la ficha y la versión que se vio ya ligados (`bind`): si otra persona la cambió antes, el servidor rechaza. */
  accion: AccionDeFormulario;
  textos: Readonly<{ plazo: string; limite: string; guardar: string; cancelar: string }>;
  /** Lo que hoy tiene la ficha: el plazo en días y el límite como texto decimal exacto. */
  actual: Readonly<{ plazoDias: number; limite: string }>;
  digitosDelPlazo: number;
  /** Adónde vuelve «Cancelar»: la ficha. Es un enlace: cancelar no manda nada. */
  hrefDeCancelar: string;
  puedeGuardar: boolean;
}>;

/**
 * Cambiar el plazo y el límite de la cuenta de un cliente (CC-5, A2; botón «Cambiar plazo o límite» de la ficha). Se puede también con la cuenta suspendida. El límite solo se guarda: lo hace cumplir el
 * cargo de una venta a cuenta, y bajarlo por debajo del saldo no toca el saldo. Una versión vieja o un valor inválido los rechaza el servidor al guardar. Sin permiso o con un dato vacío, «Guardar» sale apagado.
 */
export function FormularioDeCondicionesDeCuenta({
  accion,
  textos,
  actual,
  digitosDelPlazo,
  hrefDeCancelar,
  puedeGuardar,
}: PropsDeFormularioDeCondicionesDeCuenta) {
  const [plazo, setPlazo] = useState(String(actual.plazoDias));
  const [limite, setLimite] = useState(actual.limite);
  return (
    <FormularioDeAccion accion={accion}>
      <CampoNumero
        dato="plazo-de-cuenta-corriente"
        etiqueta={textos.plazo}
        nombre="plazoDias"
        valor={plazo}
        alCambiar={setPlazo}
        regla={{ decimales: 0, enterosMaximos: digitosDelPlazo }}
      />
      <CampoImporte
        dato="limite-de-cuenta-corriente"
        etiqueta={textos.limite}
        nombre="limite"
        valor={limite}
        alCambiar={setLimite}
      />
      <div className={estilos["acciones"]}>
        <a className={estilos["secundario"]} href={hrefDeCancelar}>
          {textos.cancelar}
        </a>
        {puedeGuardar && plazo !== "" && limite !== "" ? (
          <BotonDeEnvio>{textos.guardar}</BotonDeEnvio>
        ) : (
          <Boton deshabilitado>{textos.guardar}</Boton>
        )}
      </div>
    </FormularioDeAccion>
  );
}
