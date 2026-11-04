import type { ErrorDeEmision } from "../../modulos/fiscal/publico";
import type { ErrorDeCredenciales } from "../../puertos/credenciales-de-emisor";

/**
 * Por qué no hay credencial, con un texto fijo (nunca el de una excepción): las tres causas de la credencial
 * misma son `SIN_CREDENCIAL` (hay que cargar o corregir el certificado); un error de persistencia es que el
 * servicio no está disponible (se reintenta).
 */
export function errorDeCredenciales(error: ErrorDeCredenciales): ErrorDeEmision {
  switch (error) {
    case "SIN_CERTIFICADO_VIGENTE":
      return {
        codigo: "SIN_CREDENCIAL",
        detalle: "el emisor no tiene un certificado vigente en este ambiente",
      };
    case "CERTIFICADO_VENCIDO":
      return { codigo: "SIN_CREDENCIAL", detalle: "el certificado del emisor está vencido" };
    case "CLAVE_ILEGIBLE":
      return {
        codigo: "SIN_CREDENCIAL",
        detalle: "la clave del certificado del emisor no se pudo leer",
      };
    default:
      return {
        codigo: "SERVICIO_NO_DISPONIBLE",
        detalle: "no se pudieron obtener las credenciales del emisor",
      };
  }
}
