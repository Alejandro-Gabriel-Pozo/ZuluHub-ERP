import { porcentajeDesdeTexto, type Porcentaje } from "../../../primitivas/cantidad/porcentaje";

/**
 * Alícuotas de IVA que reconoce ZuluHub (sembradas desde ARCA, ADR-006). "0" es gravada al 0 %;
 * "EXENTO" y "NO_GRAVADO" no llevan IVA: neto = total.
 */
export const CODIGOS_DE_ALICUOTA = [
  "0",
  "2.5",
  "5",
  "10.5",
  "21",
  "27",
  "EXENTO",
  "NO_GRAVADO",
] as const;

export type CodigoDeAlicuota = (typeof CODIGOS_DE_ALICUOTA)[number];

export function esCodigoDeAlicuota(texto: string): texto is CodigoDeAlicuota {
  return (CODIGOS_DE_ALICUOTA as readonly string[]).includes(texto);
}

/** El porcentaje de la alícuota, o `null` si no lleva IVA (exento y no gravado). */
export function porcentajeDeAlicuota(codigo: CodigoDeAlicuota): Porcentaje | null {
  return codigo === "EXENTO" || codigo === "NO_GRAVADO" ? null : porcentajeDesdeTexto(codigo);
}
