import type { LetraDeComprobante } from "./comprobante-emitido";

/**
 * Condición frente al IVA del RECEPTOR (spec H7 facturación §B.3.2). Son once valores: los que
 * lista la tabla «Condición Frente al IVA del receptor» de WSFE v4.8 (l. 5712-5727). Se guardan los
 * NOMBRES; los códigos de ARCA (1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16) viven en el adaptador, con su
 * prueba contra lo que devuelva `FEParamGetCondicionIvaReceptor`.
 *
 * Es distinta de `CondicionIva` (la del EMISOR, tres valores en `emisor.ts`): un emisor es
 * responsable inscripto, monotributo o exento; un receptor puede ser cualquiera de estos once.
 */
export const CONDICIONES_DE_IVA_DEL_RECEPTOR = [
  "RESPONSABLE_INSCRIPTO",
  "EXENTO",
  "CONSUMIDOR_FINAL",
  "MONOTRIBUTO",
  "NO_CATEGORIZADO",
  "PROVEEDOR_DEL_EXTERIOR",
  "CLIENTE_DEL_EXTERIOR",
  "IVA_LIBERADO_LEY_19640",
  "MONOTRIBUTISTA_SOCIAL",
  "IVA_NO_ALCANZADO",
  "MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO",
] as const;

export type CondicionIvaReceptor = (typeof CONDICIONES_DE_IVA_DEL_RECEPTOR)[number];

export function esCondicionIvaReceptor(texto: string): texto is CondicionIvaReceptor {
  return (CONDICIONES_DE_IVA_DEL_RECEPTOR as readonly string[]).includes(texto);
}

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
