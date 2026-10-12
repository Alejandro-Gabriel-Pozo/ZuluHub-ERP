import type { EmpresaId } from "../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";

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

/** Los estados (de la empresa y de su tenant) de cada empresa que se quiere comprobar. */
export type EstadosDeEmpresa = ReadonlyMap<
  EmpresaId,
  Readonly<{ empresa: EstadoDeEmpresa; tenant: EstadoDeTenant }>
>;

/** Falla de `EMPRESA_NO_OPERA`: cuál empresa no opera y por qué (unión discriminada por `codigo`). */
export type EmpresaNoOpera = Readonly<{
  codigo: "EMPRESA_NO_OPERA";
  empresaId: EmpresaId;
  motivo: Exclude<EstadoEfectivo, "OPERA">;
}>;

/**
 * `EMPRESA_NO_OPERA` con el motivo, si la empresa no está en condiciones de operar. Que falte el
 * estado de la empresa es un error del llamador, no de negocio: se lanza para no autorizar a ciegas.
 */
export function comprobarQueOpera(
  id: EmpresaId,
  estados: EstadosDeEmpresa,
): Resultado<null, EmpresaNoOpera> {
  const estado = estados.get(id);
  if (estado === undefined) throw new RangeError(`falta el estado de la empresa ${id}`);
  const motivo = estadoEfectivo(estado.tenant, estado.empresa);
  return motivo === "OPERA" ? ok(null) : err({ codigo: "EMPRESA_NO_OPERA", empresaId: id, motivo });
}
