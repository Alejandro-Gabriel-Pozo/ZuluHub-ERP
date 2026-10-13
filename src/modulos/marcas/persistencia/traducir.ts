import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { ERRORES_DE_DOMINIO_POR_RESTRICCION, type ErrorDeDominioPorRestriccion } from "./esquema";

/**
 * Traducción de las restricciones de `dominio` a motivos tipados (ADR-004), con el mapa del módulo. Cada
 * caso de uso declara cuáles de esos motivos forman parte de SU contrato; una restricción que no declara
 * (o que no tiene motivo, `NO_TRADUCIDA`) sale como el `ErrorDePersistencia` tipado que ya es: nunca se
 * traga ni se disfraza. El 40001 de SERIALIZABLE no pasa por acá: lo reintenta el adaptador de
 * transacciones y, agotados los reintentos, sale `ConcurrenciaAgotada`.
 */

function esErrorDePersistencia(error: unknown): error is ErrorDePersistencia {
  return typeof error === "object" && error !== null && "tipo" in error;
}

/** El motivo de la restricción que saltó, o `null` si no tiene (o el error no es de una restricción). */
export function errorDeDominioDeRestriccion(
  error: ErrorDePersistencia,
): ErrorDeDominioPorRestriccion | null {
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
  if (!Object.hasOwn(ERRORES_DE_DOMINIO_POR_RESTRICCION, error.restriccion)) return null;
  const codigo = (ERRORES_DE_DOMINIO_POR_RESTRICCION as Readonly<Record<string, string>>)[
    error.restriccion
  ];
  return codigo === undefined || codigo === "NO_TRADUCIDA"
    ? null
    : (codigo as ErrorDeDominioPorRestriccion);
}

/**
 * Si el resultado es una restricción de `dominio` que el caso de uso admite, la vuelve su motivo; todo lo
 * demás (éxitos, errores de negocio, errores de la base que no son restricciones, restricciones no
 * admitidas) pasa sin cambios.
 */
export function traducirErroresDeDominio<T, E, C extends ErrorDeDominioPorRestriccion>(
  resultado: Resultado<T, E | ErrorDePersistencia>,
  admitidos: readonly C[],
): Resultado<T, E | C | ErrorDePersistencia> {
  if (resultado.ok || !esErrorDePersistencia(resultado.error)) return resultado;
  const codigo = errorDeDominioDeRestriccion(resultado.error);
  const admitido = admitidos.find((a) => a === codigo);
  return admitido === undefined ? resultado : err(admitido);
}
