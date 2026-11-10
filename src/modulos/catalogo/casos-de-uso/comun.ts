import { exigirAcciones } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  comprobarQueOpera,
  type EmpresaNoOpera,
  type EstadosDeEmpresa,
} from "../../../contexto/estados";
import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { exigirSucursal, type ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { ERRORES_DE_CATALOGO_POR_RESTRICCION } from "../persistencia/esquema";
import type { ErrorDeCatalogo } from "./errores";
import type { LecturaDeEstados, TxDeCatalogo } from "./contrato";

/**
 * El estado de la empresa del contexto y el de su tenant, para decidir si opera. Las políticas de lectura dejan ver siempre la empresa
 * del contexto y su tenant: que falte es una configuración rota, no un error de negocio.
 */
async function cargarEstados(tx: LecturaDeEstados, id: EmpresaId): Promise<EstadosDeEmpresa> {
  const empresa = await tx.empresas.obtener(id);
  if (empresa === null) throw new Error(`la empresa ${id} no es visible para el contexto`);
  const tenant = await tx.tenants.obtener(empresa.tenantId);
  if (tenant === null) throw new Error(`el tenant de la empresa ${id} no es visible`);
  return new Map([[id, { empresa: empresa.estado, tenant: tenant.estado }]]);
}

/**
 * Primer paso de todo comando: el guard del servidor con la(s) acción(es) que declara (la persona y los módulos se leen dentro de la
 * transacción, sin caché) y que la empresa opere. Nada viene del frontend.
 */
export async function autorizar(
  tx: TxDeCatalogo,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  acciones: readonly [ClaveAccion, ...ClaveAccion[]],
): Promise<Resultado<null, MotivoDeRechazo | EmpresaNoOpera>> {
  const permiso = await exigirAcciones(reglas, acciones, () => tx.autorizacion.delActor(contexto));
  if (!permiso.ok) return permiso;
  return comprobarQueOpera(contexto.empresaId, await cargarEstados(tx, contexto.empresaId));
}

/** Lo que afecta a toda la empresa (datos, opciones, forma de venta, precio de la empresa) exige alcance sobre TODAS las sucursales. */
export async function exigirAlcanceTotal(
  tx: TxDeCatalogo,
  contexto: ContextoOperativo,
): Promise<Resultado<null, ErrorDeAlcance>> {
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  return alcance === "TODAS" ? ok(null) : err("SUCURSAL_FUERA_DE_ALCANCE");
}

/** El precio o recargo propio de una sucursal: la sucursal tiene que estar en el alcance de quien pide, existir en la empresa y estar abierta. */
export async function exigirSucursalAbierta(
  tx: TxDeCatalogo,
  contexto: ContextoOperativo,
  sucursal: SucursalId,
): Promise<Resultado<null, ErrorDeAlcance | "SUCURSAL_NO_ENCONTRADA" | "SUCURSAL_INACTIVA">> {
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  const dentro = exigirSucursal(alcance, sucursal);
  if (!dentro.ok) return dentro;
  const fila = await tx.sucursales.obtener(contexto.empresaId, sucursal);
  if (fila === null) return err("SUCURSAL_NO_ENCONTRADA");
  return fila.activa ? ok(null) : err("SUCURSAL_INACTIVA");
}

const ES_ERROR_DE_PERSISTENCIA = (error: unknown): error is ErrorDePersistencia =>
  typeof error === "object" && error !== null && "tipo" in error;

/**
 * Traducción de las restricciones de la base a errores de negocio (ADR-004). Una restricción sin error de negocio (`NO_TRADUCIDA`) o que
 * no figura sale como el `ErrorDePersistencia` tipado que ya es: nunca se traga ni se disfraza.
 */
export function traducir<T>(
  resultado: Resultado<T, ErrorDeCatalogo>,
): Resultado<T, ErrorDeCatalogo> {
  if (resultado.ok || !ES_ERROR_DE_PERSISTENCIA(resultado.error)) return resultado;
  const error = resultado.error;
  if (
    (error.tipo !== "Unicidad" && error.tipo !== "Referencia" && error.tipo !== "Check") ||
    error.restriccion === null ||
    !Object.hasOwn(ERRORES_DE_CATALOGO_POR_RESTRICCION, error.restriccion)
  ) {
    return resultado;
  }
  const codigo = ERRORES_DE_CATALOGO_POR_RESTRICCION[error.restriccion];
  if (codigo === undefined || codigo === "NO_TRADUCIDA") return resultado;
  return err(codigo as ErrorDeCatalogo);
}
