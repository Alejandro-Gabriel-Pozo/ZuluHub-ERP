import type { ReactNode } from "react";
import { Aviso } from "../componentes/Aviso";
import { Texto } from "../primitivas/Texto";

export type PropsDePorQueNoPuedo = Readonly<{
  /** El texto del motivo, ya resuelto (`motivo.<MOTIVO>`). La UI no inventa mensajes. */
  texto: string;
  /** El código estable del motivo (`MODULO_NO_ACTIVO`): la marca cambia la redacción, nunca el código. */
  codigo: string;
  /** La referencia `PD-…` ya resuelta («Referencia: PD-…»), si el motivo la lleva. */
  textoDeReferencia?: string | undefined;
  /** Qué se puede hacer (por ejemplo, pedirlo al gerente). */
  accion?: ReactNode;
  /** Para enlazarlo desde el control deshabilitado con `aria-describedby`. */
  id?: string | undefined;
}>;

/**
 * «Por qué no puedo» ([01] §8.4): en la administración, lo que el actor no puede hacer se muestra
 * deshabilitado Y explicado. Este es el texto de la explicación, con el código al lado.
 */
export function PorQueNoPuedo({
  texto,
  codigo,
  textoDeReferencia,
  accion,
  id,
}: PropsDePorQueNoPuedo) {
  return (
    <div id={id}>
      <Aviso tono="info" accion={accion}>
        <Texto>{texto}</Texto>
        <Texto variante="chico">
          <code>{codigo}</code>
          {textoDeReferencia !== undefined ? ` · ${textoDeReferencia}` : ""}
        </Texto>
      </Aviso>
    </div>
  );
}
