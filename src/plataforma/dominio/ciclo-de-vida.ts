import {
  cambiarEstado,
  type CambioDeEstadoDeEmpresa,
  type Empresa,
  type ErrorDeEmpresa,
} from "../../modulos/empresas/publico";
import { err, type Resultado } from "../../primitivas/resultado/resultado";

/**
 * Suspender y reactivar desde plataforma (H5 §B.5.2). Dominio puro. La suspensión y la reactivación del
 * tenant son las del módulo de tenants (`suspender` y `reactivar`); acá viven solo las decisiones de la
 * empresa que la tabla de transiciones por sí sola no alcanza a cuidar.
 */

/**
 * Reactivar una empresa SUSPENDIDA. Solo desde `SUSPENDED`: la tabla de transiciones también deja pasar
 * `PROVISIONING → ACTIVE`, que es el paso que da el gerente al aceptar su invitación (y solo él): reactivar
 * un alta en curso la activaría sin que nadie la haya aceptado. Cualquier otro estado es
 * `TRANSICION_NO_PERMITIDA`.
 */
export function decidirReactivacionDeEmpresa(
  empresa: Empresa,
): Resultado<CambioDeEstadoDeEmpresa, ErrorDeEmpresa> {
  if (empresa.estado !== "SUSPENDED") return err("TRANSICION_NO_PERMITIDA");
  return cambiarEstado(empresa, "ACTIVE", null);
}
