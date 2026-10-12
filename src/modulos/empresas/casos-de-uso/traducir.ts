import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { ERRORES_DE_EMPRESAS_POR_RESTRICCION } from "../persistencia/repositorios";

/**
 * Traducción de las restricciones de la base a errores de negocio (ADR-004), con el mapa de
 * empresas. Cada caso de uso declara cuáles de esos errores forman parte de SU contrato; una
 * restricción que no declara (o que no tiene error de negocio, `NO_TRADUCIDA`) sale como el
 * `ErrorDePersistencia` tipado que ya es: nunca se traga ni se disfraza.
 */
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
  if (!Object.hasOwn(ERRORES_DE_EMPRESAS_POR_RESTRICCION, error.restriccion)) return null;
  const codigo = ERRORES_DE_EMPRESAS_POR_RESTRICCION[error.restriccion];
  return codigo === undefined || codigo === "NO_TRADUCIDA" ? null : codigo;
}

export function traducirErrores<T, E, C extends string>(
  resultado: Resultado<T, E | ErrorDePersistencia>,
  admitidos: readonly C[],
): Resultado<T, E | C | ErrorDePersistencia> {
  if (resultado.ok || !esErrorDePersistencia(resultado.error)) return resultado;
  const codigo = errorDeNegocioDeRestriccion(resultado.error);
  const admitido = admitidos.find((a) => a === codigo);
  return admitido === undefined ? resultado : err(admitido);
}
