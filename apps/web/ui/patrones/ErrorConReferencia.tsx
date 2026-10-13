import type { ReactNode } from "react";
import { Aviso } from "../componentes/Aviso";
import { Texto } from "../primitivas/Texto";

export type PropsDeErrorConReferencia = Readonly<{
  /** El texto del error, ya resuelto (`error.<CODIGO>`, `error.inesperado`). */
  texto: string;
  /** La referencia ya resuelta («Referencia: ZH-…»): es lo que se le da a soporte para encontrar el registro. */
  textoDeReferencia: string;
  /** El código estable del error, si lo hay. */
  codigo?: string | undefined;
  /** Lo que se puede hacer: un «Reintentar» (es seguro, todo es idempotente). */
  accion?: ReactNode;
}>;

/** Error del servidor mostrado en contexto: qué pasó, qué se puede hacer y la referencia `ZH-…`. */
export function ErrorConReferencia({
  texto,
  textoDeReferencia,
  codigo,
  accion,
}: PropsDeErrorConReferencia) {
  return (
    <Aviso tono="peligro" accion={accion}>
      <Texto>{texto}</Texto>
      <Texto variante="chico">
        {codigo !== undefined ? <code>{codigo}</code> : null}
        {codigo !== undefined ? " · " : ""}
        {textoDeReferencia}
      </Texto>
    </Aviso>
  );
}
