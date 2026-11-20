import { exigirAcciones } from "../../../capacidades/permisos/exigir";
import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  comprobarQueOpera,
  type EmpresaNoOpera,
  type EstadosDeEmpresa,
} from "../../../contexto/estados";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { ERRORES_DE_PORTAL_POR_RESTRICCION } from "../persistencia/esquema";
import type { TxDePortal } from "./contrato";
import type { ErrorDeGuardarPortal } from "./errores";

/** El estado de la empresa y el de su tenant: que falte es una configuración rota (las políticas dejan ver siempre los del contexto), no un error de negocio. */
async function cargarEstados(tx: TxDePortal, id: EmpresaId): Promise<EstadosDeEmpresa> {
  const empresa = await tx.empresas.obtener(id);
  if (empresa === null) throw new Error(`la empresa ${id} no es visible para el contexto`);
  const tenant = await tx.tenants.obtener(empresa.tenantId);
  if (tenant === null) throw new Error(`el tenant de la empresa ${id} no es visible`);
  return new Map([[id, { empresa: empresa.estado, tenant: tenant.estado }]]);
}

/** Primer paso de todo comando: el guard del servidor con la acción que declara y que la empresa opere. Nada viene del frontend. */
export async function autorizar(
  tx: TxDePortal,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  accion: ClaveAccion,
): Promise<Resultado<null, MotivoDeRechazo | EmpresaNoOpera>> {
  const permiso = await exigirAcciones(reglas, [accion], () => tx.autorizacion.delActor(contexto));
  if (!permiso.ok) return permiso;
  return comprobarQueOpera(contexto.empresaId, await cargarEstados(tx, contexto.empresaId));
}

/** El portal es de TODA la empresa: exige alcance sobre TODAS las sucursales (decidido por el servidor, nunca por el frontend). */
export async function exigirAlcanceTotal(
  tx: TxDePortal,
  contexto: ContextoOperativo,
): Promise<Resultado<null, ErrorDeAlcance>> {
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  return alcance === "TODAS" ? ok(null) : err("SUCURSAL_FUERA_DE_ALCANCE");
}

const ES_ERROR_DE_PERSISTENCIA = (error: unknown): error is ErrorDePersistencia =>
  typeof error === "object" && error !== null && "tipo" in error;

/** Una restricción sin error de negocio (`NO_TRADUCIDA`) o que no figura sale como el `ErrorDePersistencia` tipado que ya es: nunca se traga ni se disfraza. */
export function traducir<T>(
  resultado: Resultado<T, ErrorDeGuardarPortal>,
): Resultado<T, ErrorDeGuardarPortal> {
  if (resultado.ok || !ES_ERROR_DE_PERSISTENCIA(resultado.error)) return resultado;
  const error = resultado.error;
  if (
    (error.tipo !== "Unicidad" && error.tipo !== "Referencia" && error.tipo !== "Check") ||
    error.restriccion === null ||
    !Object.hasOwn(ERRORES_DE_PORTAL_POR_RESTRICCION, error.restriccion)
  ) {
    return resultado;
  }
  const codigo = ERRORES_DE_PORTAL_POR_RESTRICCION[error.restriccion];
  return codigo === undefined || codigo === "NO_TRADUCIDA"
    ? resultado
    : err(codigo as ErrorDeGuardarPortal);
}
