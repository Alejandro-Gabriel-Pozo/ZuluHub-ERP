import type { CondicionIva as CondicionIvaReceptor } from "../../../primitivas/identificacion-fiscal/condicion-iva";
import type { LetraDeComprobante } from "./comprobante-emitido";

/**
 * Condición frente al IVA del RECEPTOR (spec H7 facturación §B.3.2). Los once valores y su guarda
 * viven en `primitivas/identificacion-fiscal/condicion-iva` (los usa también el directorio de clientes,
 * que no puede importar fiscal); acá se reexportan con los nombres de fiscal. Es distinta de
 * `CondicionIva` de `emisor.ts` (la del EMISOR, tres valores): un emisor es responsable inscripto,
 * monotributo o exento; un receptor puede ser cualquiera de las once.
 */
export {
  CONDICIONES_DE_IVA as CONDICIONES_DE_IVA_DEL_RECEPTOR,
  esCondicionIva as esCondicionIvaReceptor,
  type CondicionIva as CondicionIvaReceptor,
} from "../../../primitivas/identificacion-fiscal/condicion-iva";

/**
 * Qué clases de comprobante admite cada condición, columna por columna de la tabla de WSFE v4.8
 * (l. 5718-5727): «A/ALEY», «B» y «C». La columna «49» (bienes usados) no se emite.
 */
const CLASES_QUE_ADMITE: Readonly<Record<CondicionIvaReceptor, readonly LetraDeComprobante[]>> = {
  RESPONSABLE_INSCRIPTO: ["A", "C"],
  EXENTO: ["B", "C"],
  CONSUMIDOR_FINAL: ["B", "C"],
  MONOTRIBUTO: ["A", "C"],
  NO_CATEGORIZADO: ["B", "C"],
  PROVEEDOR_DEL_EXTERIOR: ["B", "C"],
  CLIENTE_DEL_EXTERIOR: ["B", "C"],
  IVA_LIBERADO_LEY_19640: ["B", "C"],
  MONOTRIBUTISTA_SOCIAL: ["A", "C"],
  IVA_NO_ALCANZADO: ["B", "C"],
  MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO: ["A", "C"],
};

/** ¿Puede un receptor con esta condición recibir un comprobante de esa letra? (rechazos 10242 y 10243). */
export function condicionAdmiteLetra(
  condicion: CondicionIvaReceptor,
  letra: LetraDeComprobante,
): boolean {
  return CLASES_QUE_ADMITE[condicion].includes(letra);
}
