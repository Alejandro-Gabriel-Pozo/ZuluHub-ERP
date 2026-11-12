import { porcentajeDesdeTexto, type Porcentaje } from "../../../primitivas/cantidad/porcentaje";

/**
 * Alícuotas de IVA que reconoce Pedernal (sembradas desde ARCA, ADR-006). "0" es gravada al 0 %;
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

/**
 * Las alícuotas que el producto ofrece al elegirla, EN EL ORDEN en que se muestran: las seis de ARCA, sin «EXENTO» ni «NO_GRAVADO» (dueño, 12/11/2026,
 * «Recomendadas en todas, aprobado», `decisiones-del-dueno-2026-11.md`; el orden es el de la maqueta `productos.html`, aprobado por el orquestador el 12/11).
 * El servidor del producto sigue aceptando las ocho (`esCodigoDeAlicuota`) y Emitir también: esto es solo lo que se OFRECE. Una sola fuente: la pantalla y su
 * validación derivan de acá; una prueba falla si ARCA suma un código que nadie decidió si se ofrece. Previene: una lista de seis repetida a mano en la pantalla.
 */
export const ALICUOTAS_DEL_PRODUCTO = [
  "21",
  "10.5",
  "27",
  "5",
  "2.5",
  "0",
] as const satisfies readonly CodigoDeAlicuota[];

export type AlicuotaDelProducto = (typeof ALICUOTAS_DEL_PRODUCTO)[number];

export function esAlicuotaDelProducto(texto: string): texto is AlicuotaDelProducto {
  return (ALICUOTAS_DEL_PRODUCTO as readonly string[]).includes(texto);
}

/** El porcentaje de la alícuota, o `null` si no lleva IVA (exento y no gravado). */
export function porcentajeDeAlicuota(codigo: CodigoDeAlicuota): Porcentaje | null {
  return codigo === "EXENTO" || codigo === "NO_GRAVADO" ? null : porcentajeDesdeTexto(codigo);
}
