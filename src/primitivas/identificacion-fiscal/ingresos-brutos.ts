/**
 * FICHA DEL DATO: INGRESOS BRUTOS (IIBB) del emisor. Vive acá y no en `modulos/fiscal` porque es la regla del dato (una regla, un lugar): el dominio,
 * la pantalla de datos fiscales y la base la importan o la copian con prueba.
 *
 * - Qué es: cómo se declara Ingresos Brutos en los datos fiscales de un emisor: el NÚMERO de inscripción o la condición «No contribuyente»
 *   (D-115/D-116, dueño, 2026-11-05; RG 1415 Anexo II A.I.a punto 4: el comprobante lleva el número de inscripción en Ingresos Brutos o la
 *   condición de no contribuyente). Pedernal-docs `11-especificaciones/h7-fiscal.md` §B.3 (`iibb_numero`, `iibb_condicion`).
 * - Largo del número: hasta `LARGO_MAXIMO_DEL_NUMERO_DE_IIBB` (30), SUPUESTO (DEC-0047): no es un requisito verificado de ARCA. Era un
 *   literal en `modulos/fiscal/dominio/datos-fiscales.ts`; se movió acá sin cambiar el valor.
 * - Condiciones: las que la base puede tener guardadas. Solo `NO_CONTRIBUYENTE` sigue vigente al editar; las otras tres (supuesto del diseño,
 *   sin fuente) quedan para LEER filas viejas.
 */
export const LARGO_MAXIMO_DEL_NUMERO_DE_IIBB = 30;

export const CONDICION_NO_CONTRIBUYENTE = "NO_CONTRIBUYENTE" as const;

export const CONDICIONES_DE_IIBB = [
  "LOCAL",
  "CONVENIO_MULTILATERAL",
  "EXENTO",
  CONDICION_NO_CONTRIBUYENTE,
] as const;

export type CondicionIibb = (typeof CONDICIONES_DE_IIBB)[number];

/** Solo los nombres exactos (mayúsculas, guion bajo). */
export function esCondicionDeIibb(texto: string): texto is CondicionIibb {
  return (CONDICIONES_DE_IIBB as readonly string[]).includes(texto);
}
