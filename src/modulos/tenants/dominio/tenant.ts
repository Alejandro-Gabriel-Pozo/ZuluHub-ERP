import type { EstadoDeTenant } from "../../../contexto/estados";
import type { TenantId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * Tenant: el cliente que contrata. No tiene datos operativos ni fiscales; su ciclo de vida
 * (activo ↔ suspendido) es propio y detiene a todas sus empresas sin tocar el estado de cada una.
 */
export type Tenant = Readonly<{
  id: TenantId;
  nombre: string;
  estado: EstadoDeTenant;
  motivoEstado: string | null;
  version: number;
}>;

export type ErrorDeTenant =
  "NOMBRE_INVALIDO" | "MOTIVO_OBLIGATORIO" | "TENANT_YA_SUSPENDIDO" | "TENANT_NO_SUSPENDIDO";

/** Cambio de estado listo para persistir; el motivo es obligatorio al suspender. */
export type CambioDeEstadoDeTenant = Readonly<{
  estado: EstadoDeTenant;
  motivoEstado: string | null;
}>;

export function nombreDeTenantValido(nombre: string): Resultado<string, ErrorDeTenant> {
  const limpio = nombre.trim();
  return limpio === "" ? err("NOMBRE_INVALIDO") : ok(limpio);
}

export function suspender(
  tenant: Tenant,
  motivo: string,
): Resultado<CambioDeEstadoDeTenant, ErrorDeTenant> {
  if (tenant.estado === "SUSPENDED") return err("TENANT_YA_SUSPENDIDO");
  const limpio = motivo.trim();
  if (limpio === "") return err("MOTIVO_OBLIGATORIO");
  return ok({ estado: "SUSPENDED", motivoEstado: limpio });
}

export function reactivar(tenant: Tenant): Resultado<CambioDeEstadoDeTenant, ErrorDeTenant> {
  if (tenant.estado === "ACTIVE") return err("TENANT_NO_SUSPENDIDO");
  return ok({ estado: "ACTIVE", motivoEstado: null });
}
