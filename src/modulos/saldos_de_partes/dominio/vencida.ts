import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";

/**
 * ¿Está vencido un cargo? `venceEl < hoy`: el mismo día del vencimiento NO está vencido; sin vencimiento (`null`) nunca vence. «Vencida» se
 * marca y se advierte, no bloquea nada (decisión del dueño, 20/11: P-10). Las dos fechas son civiles (`AAAA-MM-DD`, zona de la empresa): comparar
 * el texto es comparar el calendario. Puro: `hoy` entra como dato (nunca se lee el reloj acá).
 */
export function estaVencida(venceEl: FechaCivil | null, hoy: FechaCivil): boolean {
  return venceEl !== null && venceEl < hoy;
}
