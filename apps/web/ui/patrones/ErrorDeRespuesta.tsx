import type { ReactNode } from "react";
import type { ErrorPublico } from "../../../../src/capacidades/experiencia/respuesta";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../src/capacidades/vocabulario/vocabulario";
import { Aviso } from "../componentes/Aviso";
import { Texto } from "../primitivas/Texto";
import { ErrorConReferencia } from "./ErrorConReferencia";
import { PorQueNoPuedo } from "./PorQueNoPuedo";

export type PropsDeErrorDeRespuesta = Readonly<{
  /** Lo que devolvió el traductor único (`aRespuesta`): código, clave del texto y presentación. Nada interno. */
  error: ErrorPublico;
  diccionario?: DiccionarioResuelto;
  /** Lo que se puede hacer (un «Reintentar», un «Ingresar de nuevo»). */
  accion?: ReactNode;
}>;

/**
 * Muestra un error ya traducido con el patrón que le toca ([01] §6.3): lo inesperado, con su referencia
 * `ZH-…`; el motivo del guard, como «por qué no puedo»; la sesión vencida, como aviso; el resto, un aviso
 * con el texto y el código al lado. La interfaz no inventa mensajes: busca la clave que trae el error.
 */
export function ErrorDeRespuesta({ error, diccionario = {}, accion }: PropsDeErrorDeRespuesta) {
  const mensaje = texto(diccionario, error.clave);
  if (error.presentacion === "INESPERADO") {
    return (
      <ErrorConReferencia
        texto={mensaje}
        textoDeReferencia={
          error.referencia === undefined
            ? ""
            : texto(diccionario, "error.referencia", { referencia: error.referencia })
        }
        accion={accion}
      />
    );
  }
  if (error.presentacion === "POR_QUE_NO_PUEDO") {
    return <PorQueNoPuedo texto={mensaje} codigo={error.codigo} accion={accion} />;
  }
  return (
    <Aviso tono={error.presentacion === "SESION" ? "aviso" : "peligro"} accion={accion}>
      <Texto>{mensaje}</Texto>
      <Texto variante="chico">
        <code>{error.codigo}</code>
      </Texto>
    </Aviso>
  );
}
