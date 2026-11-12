"use client";

import type { ReactNode } from "react";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";

/**
 * Un botón de la tarjeta de un medio (desactivar o reactivar): un formulario de una sola acción del servidor, ya ligada al id del medio. Anda sin JavaScript y,
 * con él, el segundo toque se ignora mientras la acción corre. Lo que evita el efecto doble de verdad es la regla de repetición de la acción (desactivar lo
 * desactivado no escribe ni audita). El error, si lo hay, sale debajo con el patrón común.
 */
export function AccionDeMedio({
  accion,
  children,
}: Readonly<{ accion: AccionDeFormulario; children: ReactNode }>) {
  return (
    <FormularioDeAccion accion={accion}>
      <BotonDeEnvio variante="secundaria">{children}</BotonDeEnvio>
    </FormularioDeAccion>
  );
}
