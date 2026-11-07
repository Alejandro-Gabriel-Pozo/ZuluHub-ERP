import { vigenteEn } from "../../capacidades/planes/vigencia";
import type { AsignacionBasica } from "../../modulos/planes/publico";
import type { EmpresaId, TenantId, VersionDePlanId } from "../../primitivas/identificadores/marca";
import type { TxDeConsultasDeMarcasYPlanes } from "./contrato-de-marcas-y-planes";

export const LECTURA = { aislamiento: "read committed", soloLectura: true } as const;

/** La versión que rige hoy en cada tenant, a partir de todas sus asignaciones (de los tenants que se pasan). */
export function versionVigentePorTenant(
  asignaciones: readonly AsignacionBasica[],
  ahora: Date,
): ReadonlyMap<TenantId, VersionDePlanId> {
  const porTenant = new Map<TenantId, AsignacionBasica[]>();
  for (const a of asignaciones)
    porTenant.set(a.tenantId, [...(porTenant.get(a.tenantId) ?? []), a]);
  const vigentes = new Map<TenantId, VersionDePlanId>();
  for (const [tenant, propias] of porTenant) {
    const vigente = vigenteEn(propias, ahora);
    if (vigente !== null) vigentes.set(tenant, vigente.versionDePlanId);
  }
  return vigentes;
}

export type ModulosDeUnaEmpresa = Readonly<{
  empresaId: EmpresaId;
  /** Los módulos que la empresa tiene o tuvo activados (nada se borra: los desactivados figuran con `activo: false`). */
  modulos: readonly Readonly<{ modulo: string; activo: boolean }>[];
}>;

export async function modulosPorEmpresa(
  tx: TxDeConsultasDeMarcasYPlanes,
  tenant: TenantId,
): Promise<ModulosDeUnaEmpresa[]> {
  const empresas = await tx.planes.empresasDelTenant(tenant);
  const filas = await tx.planes.modulosDeLasEmpresas(empresas);
  return empresas.map((empresaId) => ({
    empresaId,
    modulos: filas
      .filter((f) => f.empresaId === empresaId)
      .map((f) => ({ modulo: f.modulo, activo: f.activo })),
  }));
}
