import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { AlcanceDeSucursales, ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import { exigirSucursal } from "../../../capacidades/permisos/alcance";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import { exigirAcciones } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { cargarEstadosDeLaEmpresa } from "../../empresas/publico";
import { ERRORES_DE_STOCK_POR_RESTRICCION } from "../persistencia/errores-por-restriccion";
import type { TxDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";

/**
 * Primer paso de todo comando: el guard del servidor con la(s) acción(es) que declara (la persona y los módulos se leen dentro de la
 * transacción, sin caché) y que la empresa opere. Nada viene del frontend.
 */
export async function autorizar(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  acciones: readonly [ClaveAccion, ...ClaveAccion[]],
): Promise<Resultado<null, MotivoDeRechazo | EmpresaNoOpera>> {
  const permiso = await exigirAcciones(reglas, acciones, () => tx.autorizacion.delActor(contexto));
  if (!permiso.ok) return permiso;
  return comprobarQueOpera(
    contexto.empresaId,
    await cargarEstadosDeLaEmpresa(tx, contexto.empresaId),
  );
}

/** El alcance de sucursales del actor (el operador, solo las suyas), leído dentro de la transacción. */
export const alcanceDelActor = (
  tx: Pick<TxDeStock, "autorizacion">,
  contexto: ContextoOperativo,
): Promise<AlcanceDeSucursales> => tx.autorizacion.sucursalesDelActor(contexto);

/** La sucursal tiene que estar en el alcance de quien pide (integridad, no un control: ADR-008). */
export async function exigirAlcanceDeSucursal(
  tx: Pick<TxDeStock, "autorizacion">,
  contexto: ContextoOperativo,
  sucursal: SucursalId,
): Promise<Resultado<null, ErrorDeAlcance>> {
  return exigirSucursal(await alcanceDelActor(tx, contexto), sucursal);
}

/** Lo que afecta a toda la empresa (controlar un artículo, una composición) exige alcance sobre TODAS las sucursales. */
export async function exigirAlcanceTotal(
  tx: Pick<TxDeStock, "autorizacion">,
  contexto: ContextoOperativo,
): Promise<Resultado<null, ErrorDeAlcance>> {
  return (await alcanceDelActor(tx, contexto)) === "TODAS"
    ? ok(null)
    : err("SUCURSAL_FUERA_DE_ALCANCE");
}

const ES_ERROR_DE_PERSISTENCIA = (error: unknown): error is ErrorDePersistencia =>
  typeof error === "object" && error !== null && "tipo" in error;

/**
 * Traducción de las restricciones de la base a errores de negocio (ADR-004). Una restricción sin error de negocio (`NO_TRADUCIDA`) o que
 * no figura sale como el `ErrorDePersistencia` tipado que ya es: nunca se traga ni se disfraza.
 */
export function traducir<T>(resultado: Resultado<T, ErrorDeStock>): Resultado<T, ErrorDeStock> {
  if (resultado.ok || !ES_ERROR_DE_PERSISTENCIA(resultado.error)) return resultado;
  const error = resultado.error;
  if (
    (error.tipo !== "Unicidad" && error.tipo !== "Referencia" && error.tipo !== "Check") ||
    error.restriccion === null ||
    !Object.hasOwn(ERRORES_DE_STOCK_POR_RESTRICCION, error.restriccion)
  ) {
    return resultado;
  }
  const codigo = ERRORES_DE_STOCK_POR_RESTRICCION[error.restriccion];
  if (codigo === undefined || codigo === "NO_TRADUCIDA") return resultado;
  return err(codigo as ErrorDeStock);
}
