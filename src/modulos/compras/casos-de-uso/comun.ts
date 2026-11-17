import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import { exigirSucursal } from "../../../capacidades/permisos/alcance";
import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import { exigirAcciones } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { cargarEstadosDeLaEmpresa } from "../../empresas/publico";
import { ERRORES_DE_COMPRAS_POR_RESTRICCION } from "../persistencia/errores-por-restriccion";
import type { TxDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";

/**
 * Primer paso de todo comando: el guard del servidor con la(s) acción(es) que declara (la persona y los módulos se leen dentro de la transacción, sin
 * caché) y que la empresa opere. Nada viene del frontend.
 */
export async function autorizar(
  tx: Pick<TxDeCompras, "autorizacion" | "empresas" | "tenants">,
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

/** La sucursal tiene que estar en el alcance de quien pide (el operador, solo las suyas), leído dentro de la transacción. */
export async function exigirAlcanceDeSucursal(
  tx: Pick<TxDeCompras, "autorizacion">,
  contexto: ContextoOperativo,
  sucursal: SucursalId,
): Promise<Resultado<null, ErrorDeAlcance>> {
  return exigirSucursal(await tx.autorizacion.sucursalesDelActor(contexto), sucursal);
}

const ES_ERROR_DE_PERSISTENCIA = (error: unknown): error is ErrorDePersistencia =>
  typeof error === "object" && error !== null && "tipo" in error;

/**
 * Traducción de las restricciones de la base a errores de negocio (ADR-004). Una restricción sin error de negocio (`NO_TRADUCIDA`) o que no figura sale como
 * el `ErrorDePersistencia` tipado que ya es: nunca se traga ni se disfraza. Los tres choques que en el caso de uso llevan el id de la ganadora
 * (`REMITO_YA_REGISTRADO`, `COMPROBANTE_YA_REGISTRADO`, `COMPROBANTE_YA_PAGADO`) los resuelve el caso de uso ANTES de escribir; acá, la red de seguridad (la carrera
 * que la transacción no ve), la base no sabe con quién choca y el id sale `null`.
 */
export function traducir<T>(resultado: Resultado<T, ErrorDeCompras>): Resultado<T, ErrorDeCompras> {
  if (resultado.ok || !ES_ERROR_DE_PERSISTENCIA(resultado.error)) return resultado;
  const error = resultado.error;
  if (
    (error.tipo !== "Unicidad" && error.tipo !== "Referencia" && error.tipo !== "Check") ||
    error.restriccion === null ||
    !Object.hasOwn(ERRORES_DE_COMPRAS_POR_RESTRICCION, error.restriccion)
  ) {
    return resultado;
  }
  const codigo = ERRORES_DE_COMPRAS_POR_RESTRICCION[error.restriccion];
  if (codigo === undefined || codigo === "NO_TRADUCIDA") return resultado;
  if (codigo === "REMITO_YA_REGISTRADO") return err({ error: codigo, recepcionId: null });
  if (codigo === "COMPROBANTE_YA_REGISTRADO") return err({ error: codigo, comprobanteId: null });
  if (codigo === "COMPROBANTE_YA_PAGADO") return err({ error: codigo, pagoId: null });
  return err(codigo as ErrorDeCompras);
}
