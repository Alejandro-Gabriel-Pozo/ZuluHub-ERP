import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { exigirPerilla } from "../../../capacidades/planes/derechos";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { autorizarEnStock, exigirAlcanceDeSucursal, traducirDeStock } from "../../stock/publico";
import { ERRORES_DE_PRODUCCION_POR_RESTRICCION } from "../persistencia/errores-por-restriccion";
import type { TxDeProduccion } from "./contrato";
import type { ErrorDeProduccion } from "./errores";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";

type R<S> = Resultado<S, ErrorDeProduccion>;

/** Primer paso de todo comando: el guard del servidor con la acción de `produccion` y que la empresa opere (el mismo de stock: una regla, un lugar). */
export const autorizar = (
  tx: TxDeProduccion,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  acciones: readonly [ClaveAccion, ...ClaveAccion[]],
) => autorizarEnStock(tx, contexto, reglas, acciones);

/** La perilla `produccion` de la empresa (el plan): sin ella `FUNCION_NO_INCLUIDA`. Nace cerrado: sin dato, apagada. */
export async function exigirPerillaDeProduccion(
  tx: Pick<TxDeProduccion, "derechos">,
  contexto: ContextoOperativo,
): Promise<R<null>> {
  const derechos = await tx.derechos.deLaEmpresa(contexto);
  const permitida = exigirPerilla(derechos, "produccion", { empresaId: contexto.empresaId });
  return permitida.ok ? ok(null) : err({ error: "FUNCION_NO_INCLUIDA", perilla: "produccion" });
}

/** Una orden toca dos depósitos: las dos sucursales tienen que estar en el alcance de quien pide (integridad, no un control: ADR-008). */
export async function exigirAlcanceDeLasDosSucursales(
  tx: Pick<TxDeProduccion, "autorizacion">,
  contexto: ContextoOperativo,
  sucursales: readonly SucursalId[],
): Promise<R<null>> {
  for (const sucursal of new Set(sucursales)) {
    const alcance = await exigirAlcanceDeSucursal(tx, contexto, sucursal);
    if (!alcance.ok) return alcance;
  }
  return ok(null);
}

const ES_ERROR_DE_PERSISTENCIA = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "tipo" in error;

/**
 * Traducción de las restricciones de la base a errores de negocio: primero las de las tablas de producción y, si no es una de ellas, las de stock
 * (el libro se escribe en la misma transacción). Una restricción sin error de negocio sale como el `ErrorDePersistencia` tipado, nunca disfrazada.
 */
export function traducir<T>(resultado: R<T>): R<T> {
  if (resultado.ok || !ES_ERROR_DE_PERSISTENCIA(resultado.error)) return resultado;
  const error = resultado.error as unknown as { tipo: string; restriccion: string | null };
  if (
    (error.tipo === "Unicidad" || error.tipo === "Referencia" || error.tipo === "Check") &&
    error.restriccion !== null &&
    Object.hasOwn(ERRORES_DE_PRODUCCION_POR_RESTRICCION, error.restriccion)
  ) {
    const codigo = ERRORES_DE_PRODUCCION_POR_RESTRICCION[error.restriccion];
    if (codigo !== undefined && codigo !== "NO_TRADUCIDA") {
      return err(codigo as unknown as ErrorDeProduccion);
    }
    return resultado;
  }
  return traducirDeStock(resultado as never);
}
