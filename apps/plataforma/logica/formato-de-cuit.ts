/**
 * Muestra un CUIT de 11 dígitos como XX-XXXXXXXX-X. Solo es presentación: cualquier otro texto vuelve tal cual
 * (la validación y el dígito verificador son del servidor), así que nunca lanza.
 */
export function cuitConGuiones(cuit: string): string {
  if (!/^\d{11}$/.test(cuit)) return cuit;
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
}
