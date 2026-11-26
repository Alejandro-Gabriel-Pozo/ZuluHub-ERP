"use client";

import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";

export type PropsDeAccionDeEstadoDeRol = Readonly<{
  /** `archivarRolAccion` o `reactivarRolAccion` con el rol ya ligado (`bind`): el id no viaja en un campo. */
  accion: AccionDeFormulario;
  /** «Archivar» o «Reactivar», ya resuelto. */
  texto: string;
}>;

/**
 * «Archivar» o «Reactivar» un rol, de la ficha: un solo botón que envía la acción. Mientras envía no se puede volver a tocar; repetirla es inocua (archivar lo ya archivado y reactivar lo ya activo no escriben).
 * Archivar es reversible (se reactiva) y el servidor lo rechaza si el rol tiene personas, así que no pide confirmación aparte. Si el servidor rechaza, el genérico sale debajo.
 */
export function AccionDeEstadoDeRol({ accion, texto }: PropsDeAccionDeEstadoDeRol) {
  return (
    <FormularioDeAccion accion={accion}>
      <BotonDeEnvio variante="secundaria">{texto}</BotonDeEnvio>
    </FormularioDeAccion>
  );
}
