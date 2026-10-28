import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Aviso } from "../../componentes/Aviso";
import type { TonoDeEstado } from "../../componentes/Insignia";

const TONO: Readonly<Record<ErrorPublico["presentacion"], TonoDeEstado>> = {
  AVISO: "aviso",
  POR_QUE_NO_PUEDO: "info",
  SESION: "aviso",
  INESPERADO: "peligro",
};

/**
 * Un error de la lectura del comprobante: solo el texto del catálogo y, si el error es inesperado, la referencia
 * `PD-…` para soporte. Nunca el código ni detalle técnico alguno (el traductor único ya los dejó afuera).
 */
export function ErrorDelDetalle({
  error,
  diccionario = {},
}: Readonly<{ error: ErrorPublico; diccionario?: DiccionarioResuelto }>) {
  return (
    <Aviso tono={TONO[error.presentacion]}>
      <p>{texto(diccionario, error.clave)}</p>
      {error.referencia === undefined ? null : (
        <p>{texto(diccionario, "error.referencia", { referencia: error.referencia })}</p>
      )}
    </Aviso>
  );
}
