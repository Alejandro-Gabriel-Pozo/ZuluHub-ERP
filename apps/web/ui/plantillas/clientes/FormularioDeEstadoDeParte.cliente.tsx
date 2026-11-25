"use client";

import { useActionState, useEffect } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import { RUTA_DE_CLIENTES } from "./modelo-de-directorio";

export type PropsDeFormularioDeEstadoDeParte = Readonly<{
  /** «Desactivar» o «Reactivar», ya resuelto. */
  texto: string;
  /** La acción de servidor (`desactivarParteAccion` o `reactivarParteAccion`, ligada a la parte). */
  accion: AccionDeFormulario;
  /** Si la persona puede cambiar el estado: si no, el botón sale apagado (solo una ayuda: el guard decide). */
  apagado: boolean;
}>;

type Estado = Readonly<{ error: ErrorPublico | null; hecho: boolean }>;

const SIN_ERROR: Estado = { error: null, hecho: false };

/**
 * «Desactivar» / «Reactivar» una parte (maqueta `directorio.html`): un botón de envío sin campos. Repetir no duplica: desactivar lo ya desactivado (y reactivar lo ya activo) es éxito sin
 * escribir ni auditar, y el botón ignora el segundo toque mientras corre. La acción no redirige (un `redirect` dentro de una acción pierde el host): al terminar bien, la pantalla vuelve
 * a la lista. El error sale debajo con el patrón común.
 */
export function FormularioDeEstadoDeParte({
  texto,
  accion,
  apagado,
}: PropsDeFormularioDeEstadoDeParte) {
  const [resultado, enviar, enviando] = useActionState(
    async (previo: Estado, datos: FormData): Promise<Estado> => {
      const r = await accion({ error: previo.error }, datos);
      return { error: r.error, hecho: r.error === null };
    },
    SIN_ERROR,
  );
  useEffect(() => {
    if (resultado.hecho) window.location.assign(RUTA_DE_CLIENTES);
  }, [resultado.hecho]);
  return (
    <form action={enviar}>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={2}>
          {apagado ? (
            <Boton variante="secundaria" deshabilitado>
              {texto}
            </Boton>
          ) : (
            <BotonDeEnvio variante="secundaria">{texto}</BotonDeEnvio>
          )}
          {resultado.error === null ? null : <ErrorDeRespuesta error={resultado.error} />}
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
