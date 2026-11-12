"use client";

import type { ReactNode } from "react";
import { Boton } from "../../componentes/Boton.cliente";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";

/**
 * El esqueleto de los tres formularios de la configuración de caja (medios de pago, cuentas de cobro y cajas; maqueta `medios.html`, 09/11/2026): los campos de cada uno,
 * el error del servidor debajo y «Guardar» al pie, que sale apagado si el servidor no deja guardar hoy (solo una ayuda: el guard decide). Se extrajo cuando la segunda pantalla
 * real lo necesitó (ADR-014). Repetir el envío no duplica: lo evita la regla de repetición de cada acción; el botón solo ignora el segundo toque.
 */
export function FormularioDeConfiguracion({
  accion,
  textoGuardar,
  puedeGuardar,
  children,
}: Readonly<{
  accion: AccionDeFormulario;
  textoGuardar: string;
  puedeGuardar: boolean;
  children: ReactNode;
}>) {
  return (
    <FormularioDeAccion accion={accion}>
      {children}
      {puedeGuardar ? (
        <BotonDeEnvio>{textoGuardar}</BotonDeEnvio>
      ) : (
        <Boton deshabilitado>{textoGuardar}</Boton>
      )}
    </FormularioDeAccion>
  );
}
