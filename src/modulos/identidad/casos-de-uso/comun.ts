import type { EstadoDeEmpresa, EstadoDeTenant, EstadosDeEmpresa } from "../../../contexto/estados";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { Empresa } from "../../empresas/publico";
import type { TxDeIdentidad } from "./contrato";

/** Las empresas y los estados (de la empresa y de su tenant) para decidir si operan. */
export async function cargarEmpresas(
  tx: TxDeIdentidad,
  ids: readonly EmpresaId[],
): Promise<{ empresas: ReadonlyMap<EmpresaId, Empresa>; estados: EstadosDeEmpresa }> {
  const empresas = new Map<EmpresaId, Empresa>();
  const estados = new Map<EmpresaId, { empresa: EstadoDeEmpresa; tenant: EstadoDeTenant }>();
  const tenants = new Map<string, EstadoDeTenant>();
  for (const id of ids) {
    const empresa = await tx.empresas.obtener(id);
    // Las políticas de lectura dejan ver siempre la empresa del contexto y las de la invitación:
    // que falte es una configuración rota, no un error de negocio.
    if (empresa === null) throw new Error(`la empresa ${id} no es visible para el contexto`);
    let tenantEstado = tenants.get(empresa.tenantId);
    if (tenantEstado === undefined) {
      const tenant = await tx.tenants.obtener(empresa.tenantId);
      if (tenant === null) throw new Error(`el tenant de la empresa ${id} no es visible`);
      tenantEstado = tenant.estado;
      tenants.set(empresa.tenantId, tenantEstado);
    }
    empresas.set(id, empresa);
    estados.set(id, { empresa: empresa.estado, tenant: tenantEstado });
  }
  return { empresas, estados };
}
