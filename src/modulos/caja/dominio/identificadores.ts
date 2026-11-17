/**
 * La forma de un identificador `uuid` (el origen de un cobro, la marca de tarjeta). Es la misma que usan `empresas` e `identidad`
 * en su persistencia; caja no las importa (un módulo no entra a la persistencia de otro). SUPUESTO (DEC-0065): se extrae a `primitivas/` en
 * cuanto otro dominio la necesite (ADR-014).
 */
export const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUuid(valor: unknown): valor is string {
  return typeof valor === "string" && FORMA_DE_UUID.test(valor);
}
