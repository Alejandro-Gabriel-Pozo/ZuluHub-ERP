import type { CodigoDeAlicuota, SolicitudDeAutorizacion } from "../../modulos/fiscal/publico";

/**
 * Los códigos numéricos de ARCA que viven en el adaptador (los de tipo de comprobante, tipo de documento y
 * moneda están en el dominio de fiscal, `codigos-de-arca.ts`). Cada tabla se lee de `FEParamGet*` contra
 * homologación real (informe del espía F0, 2026-10-14) y una prueba la compara con la grabación.
 */

type Concepto = SolicitudDeAutorizacion["concepto"];
type CondicionIvaDelReceptor = SolicitudDeAutorizacion["receptor"]["condicionIva"];

/** `FEParamGetTiposConcepto`: 1 productos, 2 servicios, 3 productos y servicios. */
export const ID_DE_CONCEPTO: Readonly<Record<Concepto, number>> = {
  PRODUCTOS: 1,
  SERVICIOS: 2,
  PRODUCTOS_Y_SERVICIOS: 3,
};

/**
 * `FEParamGetCondicionIvaReceptor`, obligatorio siempre (RG 5616): 1, 6, 13 y 16 son de las clases A/ALEY/C;
 * 4, 7, 8, 9, 10 y 15, de B/C; 5 (consumidor final), de C/49.
 */
export const ID_DE_CONDICION_IVA: Readonly<Record<CondicionIvaDelReceptor, number>> = {
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTO: 6,
  NO_CATEGORIZADO: 7,
  PROVEEDOR_DEL_EXTERIOR: 8,
  CLIENTE_DEL_EXTERIOR: 9,
  IVA_LIBERADO_LEY_19640: 10,
  MONOTRIBUTISTA_SOCIAL: 13,
  IVA_NO_ALCANZADO: 15,
  MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO: 16,
};

/**
 * `FEParamGetTiposIva`, VERIFICADA en homologación real: 3 = 0 %, 4 = 10,5 %, 5 = 21 %, 6 = 27 %, 8 = 5 %,
 * 9 = 2,5 % (el SDK de TypeScript tiene 7 y 8: está equivocado). El exento y el no gravado no llevan alícuota
 * en `Iva`: no figuran.
 */
export const ID_DE_ALICUOTA: Readonly<Partial<Record<CodigoDeAlicuota, number>>> = {
  "0": 3,
  "10.5": 4,
  "21": 5,
  "27": 6,
  "5": 8,
  "2.5": 9,
};

/** La alícuota de un `Id` de IVA que informa ARCA, o `null` si no es una de las que Pedernal conoce. */
export function alicuotaDeId(id: string): CodigoDeAlicuota | null {
  const hallada = (Object.entries(ID_DE_ALICUOTA) as [CodigoDeAlicuota, number][]).find(
    ([, numero]) => String(numero) === id,
  );
  return hallada === undefined ? null : hallada[0];
}

/** Las seis tablas de `FEParamGet*` que lee el adaptador (los nombres de las operaciones son `FEParamGet<tabla>`). */
export const TABLAS_DE_PARAMETROS = [
  "TiposCbte",
  "TiposDoc",
  "TiposIva",
  "CondicionIvaReceptor",
  "TiposConcepto",
  "TiposMonedas",
] as const;

export type TablaDeParametros = (typeof TABLAS_DE_PARAMETROS)[number];
