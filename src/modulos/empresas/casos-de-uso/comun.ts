import type { EstadosDeEmpresa } from "../../../contexto/estados";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { LecturaDeEstados } from "./contrato";

/**
 * El estado de la empresa del contexto y el de su tenant, para decidir si opera. Las políticas de
 * lectura dejan ver siempre la empresa del contexto y su tenant: que falte es una configuración
 * rota, no un error de negocio.
 */
export async function cargarEstadosDeLaEmpresa(
  tx: LecturaDeEstados,
  id: EmpresaId,
): Promise<EstadosDeEmpresa> {
  const empresa = await tx.empresas.obtener(id);
  if (empresa === null) throw new Error(`la empresa ${id} no es visible para el contexto`);
  const tenant = await tx.tenants.obtener(empresa.tenantId);
  if (tenant === null) throw new Error(`el tenant de la empresa ${id} no es visible`);
  return new Map([[id, { empresa: empresa.estado, tenant: tenant.estado }]]);
}
