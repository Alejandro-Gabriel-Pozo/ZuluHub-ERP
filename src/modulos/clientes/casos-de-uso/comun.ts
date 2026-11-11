import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import { exigirAcciones } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { cargarEstadosDeLaEmpresa } from "../../empresas/publico";
import { ERRORES_DE_CLIENTES_POR_RESTRICCION } from "../persistencia/errores-por-restriccion";
import type { TxDeClientes } from "./contrato";
import type { ErrorDeClientes } from "./errores";

/**
 * Primer paso de todo comando: el guard del servidor con la(s) acción(es) que declara (la persona y los módulos se leen dentro de la transacción, sin
 * caché) y que la empresa opere. Nada viene del frontend.
 */
export async function autorizar(
  tx: Pick<TxDeClientes, "autorizacion" | "empresas" | "tenants">,
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

const ES_ERROR_DE_PERSISTENCIA = (error: unknown): error is ErrorDePersistencia =>
  typeof error === "object" && error !== null && "tipo" in error;

/**
 * Traducción de las restricciones de la base a errores de negocio (ADR-004). Una restricción sin error de negocio (`NO_TRADUCIDA`) o que no figura sale como
 * el `ErrorDePersistencia` tipado que ya es: nunca se traga ni se disfraza. `DOCUMENTO_YA_REGISTRADO` lleva el id de la parte que choca, que la base no
 * dice: los casos de uso lo resuelven antes de llegar acá (`insertar` no lanza); esta traducción es la red de seguridad, por ejemplo una edición que llega a
 * la única.
 */
export function traducir<T>(
  resultado: Resultado<T, ErrorDeClientes>,
): Resultado<T, ErrorDeClientes> {
  if (resultado.ok || !ES_ERROR_DE_PERSISTENCIA(resultado.error)) return resultado;
  const error = resultado.error;
  if (
    (error.tipo !== "Unicidad" && error.tipo !== "Referencia" && error.tipo !== "Check") ||
    error.restriccion === null ||
    !Object.hasOwn(ERRORES_DE_CLIENTES_POR_RESTRICCION, error.restriccion)
  ) {
    return resultado;
  }
  const codigo = ERRORES_DE_CLIENTES_POR_RESTRICCION[error.restriccion];
  if (codigo === undefined || codigo === "NO_TRADUCIDA") return resultado;
  if (codigo === "DOCUMENTO_YA_REGISTRADO") return err({ error: codigo, parteId: null });
  return err(codigo as ErrorDeClientes);
}
