import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  ERRORES_DE_DOMINIO_POR_RESTRICCION,
  ERRORES_DE_MARCAS_POR_RESTRICCION,
  type ErrorDeDominioPorRestriccion,
  type ErrorDeMarcaPorRestriccion,
} from "./esquema";

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

/**
 * El motivo de la restricción que saltó según `mapa`, o `null` si no tiene (o el error no es de una
 * restricción). Las dos traducciones del módulo (dominios y marcas) comparten esta lectura.
 */
function motivoDeRestriccion(
  mapa: Readonly<Record<string, string>>,
  error: ErrorDePersistencia,
): string | null {
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
  if (!Object.hasOwn(mapa, error.restriccion)) return null;
  const codigo = mapa[error.restriccion];
  return codigo === undefined || codigo === "NO_TRADUCIDA" ? null : codigo;
}

/** El motivo de la restricción de `dominio` que saltó, o `null` si no tiene. */
export function errorDeDominioDeRestriccion(
  error: ErrorDePersistencia,
): ErrorDeDominioPorRestriccion | null {
  return motivoDeRestriccion(
    ERRORES_DE_DOMINIO_POR_RESTRICCION,
    error,
  ) as ErrorDeDominioPorRestriccion | null;
}

/** El motivo de la restricción de `marca` o `version_de_marca` que saltó, o `null` si no tiene. */
export function errorDeMarcaDeRestriccion(
  error: ErrorDePersistencia,
): ErrorDeMarcaPorRestriccion | null {
  return motivoDeRestriccion(
    ERRORES_DE_MARCAS_POR_RESTRICCION,
    error,
  ) as ErrorDeMarcaPorRestriccion | null;
}

function traducir<T, E, C extends string>(
  resultado: Resultado<T, E | ErrorDePersistencia>,
  admitidos: readonly C[],
  motivo: (error: ErrorDePersistencia) => string | null,
): Resultado<T, E | C | ErrorDePersistencia> {
  if (resultado.ok || !esErrorDePersistencia(resultado.error)) return resultado;
  const codigo = motivo(resultado.error);
  const admitido = admitidos.find((a) => a === codigo);
  return admitido === undefined ? resultado : err(admitido);
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
  return traducir(resultado, admitidos, errorDeDominioDeRestriccion);
}

/** Lo mismo para una restricción de `marca` o `version_de_marca`. */
export function traducirErroresDeMarca<T, E, C extends ErrorDeMarcaPorRestriccion>(
  resultado: Resultado<T, E | ErrorDePersistencia>,
  admitidos: readonly C[],
): Resultado<T, E | C | ErrorDePersistencia> {
  return traducir(resultado, admitidos, errorDeMarcaDeRestriccion);
}
