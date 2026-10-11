import {
  estadoEfectivo,
  type EstadoDeEmpresa,
  type EstadoDeTenant,
} from "../../../contexto/estados";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Empresa } from "../../empresas/publico";
import type { EmpresaNoOpera } from "../dominio/errores";
import type { EstadosDeEmpresa } from "../dominio/invitacion";
import { puedeAdministrarAccesos } from "../dominio/membresia";
import type { TxDeIdentidad } from "./contrato";

/**
 * Control de piso transitorio (se reemplaza por el catálogo de acciones y el guard en H4): quien
 * actúa debe ser miembro ACTIVO de la empresa con rol de gerente o de administrador. La base NO
 * conoce el rol del actor: lo verifica el caso de uso, en el servidor, dentro de la misma
 * transacción (así una membresía apagada un instante antes ya no pasa).
 */
export async function exigirAdministrador(
  tx: TxDeIdentidad,
  contexto: ContextoOperativo,
): Promise<Resultado<null, "SIN_PERMISO">> {
  if (contexto.personaId === null) return err("SIN_PERMISO");
  const actor = await tx.membresias.obtener(contexto.empresaId, contexto.personaId);
  return puedeAdministrarAccesos(actor) ? ok(null) : err("SIN_PERMISO");
}

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

/** `EMPRESA_NO_OPERA` con el motivo, si la empresa no está en condiciones de operar. */
export function comprobarQueOpera(
  id: EmpresaId,
  estados: EstadosDeEmpresa,
): Resultado<null, EmpresaNoOpera> {
  const estado = estados.get(id);
  if (estado === undefined) throw new RangeError(`falta el estado de la empresa ${id}`);
  const motivo = estadoEfectivo(estado.tenant, estado.empresa);
  return motivo === "OPERA" ? ok(null) : err({ codigo: "EMPRESA_NO_OPERA", empresaId: id, motivo });
}
