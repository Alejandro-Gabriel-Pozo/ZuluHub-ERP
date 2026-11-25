import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { ERRORES_DEL_LIBRO_POR_RESTRICCION } from "../persistencia/errores-por-restriccion";

function esErrorDePersistencia(error: unknown): error is ErrorDePersistencia {
  return typeof error === "object" && error !== null && "tipo" in error;
}

function errorDeNegocioDeRestriccion(error: ErrorDePersistencia): string | null {
  if (
    error.tipo !== "Unicidad" &&
    error.tipo !== "Superposicion" &&
    error.tipo !== "Referencia" &&
    error.tipo !== "Check"
  ) {
    return null;
  }
  if (error.restriccion === null) return null;
  // `hasOwn`: un nombre como "constructor" no puede salir del prototipo del objeto.
  if (!Object.hasOwn(ERRORES_DEL_LIBRO_POR_RESTRICCION, error.restriccion)) return null;
  const codigo = ERRORES_DEL_LIBRO_POR_RESTRICCION[error.restriccion];
  return codigo === undefined || codigo === "NO_TRADUCIDA" ? null : codigo;
}

/**
 * Traduce los errores de la base a los de negocio del libro (ADR-004). Quien abre la transacción lo aplica al resultado de `ejecutar`, con los
 * errores que SU contrato admite; una restricción que no admite (o `NO_TRADUCIDA`) sale como el `ErrorDePersistencia` tipado que ya es: nunca se
 * traga ni se disfraza. Un error diferido (la distribución, que la base verifica al confirmar) llega acá igual, en el resultado del `COMMIT`.
 */
export function traducirErroresDelLibro<T, E, C extends string>(
  resultado: Resultado<T, E | ErrorDePersistencia>,
  admitidos: readonly C[],
): Resultado<T, E | C | ErrorDePersistencia> {
  if (resultado.ok || !esErrorDePersistencia(resultado.error)) return resultado;
  const codigo = errorDeNegocioDeRestriccion(resultado.error);
  const admitido = admitidos.find((a) => a === codigo);
  return admitido === undefined ? resultado : err(admitido);
}
