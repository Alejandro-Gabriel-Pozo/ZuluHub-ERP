import { TIPOS_DE_DOCUMENTO, type DocumentoDelReceptor } from "../dominio/receptor";
import { deLaLista, exigir } from "./repositorios";

/**
 * El documento del receptor como lo guarda la base (`receptor_documento_tipo` y `receptor_documento_numero`). Lo leen el
 * comprobante completo y el listado: una sola lectura del par tipo y número, para que las dos pantallas muestren lo mismo.
 */
export function documentoDelReceptorDeLaBase(
  tipo: string,
  numero: string | null,
): DocumentoDelReceptor {
  return tipo === "SIN_IDENTIFICAR"
    ? { tipo }
    : {
        tipo: deLaLista(TIPOS_DE_DOCUMENTO, tipo, "tipo de documento del receptor"),
        numero: exigir(numero, "receptor_documento_numero"),
      };
}
