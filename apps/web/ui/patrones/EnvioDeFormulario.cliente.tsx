"use client";

import { createContext, useContext } from "react";

/**
 * Si el formulario que envuelve está enviando ahora. Lo fija `FormularioDeAccion` (con el `isPending` de
 * `useActionState`) y lo lee `BotonDeEnvio`. Se hace con un contexto y no con `useFormStatus` de `react-dom`
 * para que ningún archivo de la interfaz importe `react-dom` directo: el empaquetador de las pruebas de
 * componentes lo optimiza aparte la primera vez y recarga la página a mitad de la corrida.
 */
const EnvioDeFormularioContexto = createContext(false);

export const ProveedorDeEnvioDeFormulario = EnvioDeFormularioContexto;

export function useEnvioDeFormulario(): boolean {
  return useContext(EnvioDeFormularioContexto);
}
