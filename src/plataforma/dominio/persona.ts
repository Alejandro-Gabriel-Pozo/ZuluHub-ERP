import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";

/**
 * Suspender y reactivar una persona de todo el sistema (H5 §B.5.6). Dominio puro. La persona vive una sola
 * vez (`persona.activo_global`) aunque sea miembro de empresas de varios tenants: suspenderla corta su acceso
 * a todas, en la operación siguiente, porque cada caso de uso de empresa lee ese dato dentro de su
 * transacción.
 */

export type ErrorDeSuspensionDePersona = "YA_SUSPENDIDA" | "MOTIVO_OBLIGATORIO";
export type ErrorDeReactivacionDePersona = "NO_SUSPENDIDA";

/**
 * ¿Se puede suspender? Orden: que no esté ya suspendida (`YA_SUSPENDIDA`) y que haya un motivo
 * (`MOTIVO_OBLIGATORIO`), como la suspensión de un tenant. El motivo no se guarda en la persona (no tiene
 * dónde): queda en la constancia. Sale recortado.
 */
export function decidirSuspensionDePersona(
  persona: Readonly<{ activoGlobal: boolean }>,
  motivo: string,
): Resultado<Readonly<{ motivo: string }>, ErrorDeSuspensionDePersona> {
  if (!persona.activoGlobal) return err("YA_SUSPENDIDA");
  const limpio = motivo.trim();
  return limpio === "" ? err("MOTIVO_OBLIGATORIO") : ok({ motivo: limpio });
}

/** ¿Se puede reactivar? Solo una persona suspendida; reactivar una activa es `NO_SUSPENDIDA`. */
export function decidirReactivacionDePersona(
  persona: Readonly<{ activoGlobal: boolean }>,
): Resultado<null, ErrorDeReactivacionDePersona> {
  return persona.activoGlobal ? err("NO_SUSPENDIDA") : ok(null);
}
