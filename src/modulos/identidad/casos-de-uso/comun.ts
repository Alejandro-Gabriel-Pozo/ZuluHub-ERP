import {
  estadoEfectivo,
  type EstadoDeEmpresa,
  type EstadoDeTenant,
} from "../../../contexto/estados";
import { modulosActivosDe } from "../../../capacidades/modulos/activos";
import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import { evaluarGuard, type MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Empresa } from "../../empresas/publico";
import type { EmpresaNoOpera } from "../dominio/errores";
import type { EstadosDeEmpresa } from "../dominio/invitacion";
import type { DependenciasDeIdentidad, TxDeIdentidad } from "./contrato";

/**
 * El guard de permisos (ADR-003): el actor tiene que poder hacer la `accion` declarada del caso de
 * uso. Es lo PRIMERO que hace cada caso de uso dentro de la transacción, antes de leer o escribir
 * nada más. La base NO conoce el rol del actor: lo verifica el servidor, y lo lee acá, dentro de la
 * misma transacción serializable (así una membresía apagada un instante antes ya no pasa y un
 * reintento lo vuelve a leer). Nada de esto se guarda en sesión ni en caché.
 */
export async function exigirAccion(
  tx: TxDeIdentidad,
  contexto: ContextoOperativo,
  reglas: DependenciasDeIdentidad["reglas"],
  accion: ClaveAccion,
): Promise<Resultado<null, MotivoDeRechazo>> {
  const actor = await tx.autorizacion.delActor(contexto);
  return evaluarGuard(reglas, accion, {
    rol: actor.rol,
    modulosActivos: modulosActivosDe(reglas.catalogo, actor.modulosActivados),
    capacidadesDeSucursal: null,
  });
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
