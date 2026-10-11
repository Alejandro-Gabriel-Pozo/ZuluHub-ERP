/**
 * Estados de tenant y empresa, y el estado efectivo que combina ambos (diseno-inicial §4.1). Viven
 * en `contexto` porque los usan los módulos de tenants y de empresas, que son hermanos y no se
 * conocen entre sí.
 */
export type EstadoDeTenant = "ACTIVE" | "SUSPENDED";

export type EstadoDeEmpresa = "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "CANCELLED" | "DELETING";

export type EstadoEfectivo =
  | "OPERA"
  | "EMPRESA_EN_ALTA"
  | "EMPRESA_SUSPENDIDA"
  | "EMPRESA_CANCELADA"
  | "EMPRESA_EN_BAJA"
  | "TENANT_SUSPENDIDO";

/**
 * Una empresa opera solo si su tenant está ACTIVE y ella misma está ACTIVE. Los estados finales
 * de la empresa (cancelada, en baja) se informan primero: no cambian por reactivar el tenant.
 */
export function estadoEfectivo(tenant: EstadoDeTenant, empresa: EstadoDeEmpresa): EstadoEfectivo {
  if (empresa === "CANCELLED") return "EMPRESA_CANCELADA";
  if (empresa === "DELETING") return "EMPRESA_EN_BAJA";
  if (tenant === "SUSPENDED") return "TENANT_SUSPENDIDO";
  if (empresa === "PROVISIONING") return "EMPRESA_EN_ALTA";
  return empresa === "SUSPENDED" ? "EMPRESA_SUSPENDIDA" : "OPERA";
}

export function puedeOperar(estado: EstadoEfectivo): boolean {
  return estado === "OPERA";
}
