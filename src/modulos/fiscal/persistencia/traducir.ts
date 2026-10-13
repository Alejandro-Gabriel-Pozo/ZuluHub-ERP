import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { ERRORES_DE_FISCAL_POR_RESTRICCION, type ErrorDeFiscalPorRestriccion } from "./esquema";

/**
 * Traducción de las restricciones de la base a errores de negocio (ADR-004), con el mapa fiscal.
 * Cada caso de uso declara cuáles de esos errores forman parte de SU contrato; una restricción que
 * no declara (o que no tiene error de negocio, `NO_TRADUCIDA`) sale como el `ErrorDePersistencia`
 * tipado que ya es: nunca se traga ni se disfraza.
 *
 * Vive en `persistencia/` (y no en `casos-de-uso/` como en identidad) porque T4 entrega la
 * traducción completa y probada contra la base, y los casos de uso de T5, T6 y T7 la importan.
 */

function esErrorDePersistencia(error: unknown): error is ErrorDePersistencia {
  return typeof error === "object" && error !== null && "tipo" in error;
}

/**
 * El error de negocio de la restricción que saltó, o `null` si no tiene (o no es una restricción).
 * Sirve para toda restricción de las tablas fiscales y para los dos disparadores fiscales de
 * `empresa` (`empresa_cuit_es_emisor`, `empresa_cuit_inmutable`).
 */
export function errorFiscalDeRestriccion(
  error: ErrorDePersistencia,
): ErrorDeFiscalPorRestriccion | null {
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
  if (!Object.hasOwn(ERRORES_DE_FISCAL_POR_RESTRICCION, error.restriccion)) return null;
  const codigo = (ERRORES_DE_FISCAL_POR_RESTRICCION as Readonly<Record<string, string>>)[
    error.restriccion
  ];
  return codigo === undefined || codigo === "NO_TRADUCIDA"
    ? null
    : (codigo as ErrorDeFiscalPorRestriccion);
}

/**
 * Si el resultado es una restricción fiscal que el caso de uso admite, la vuelve su error de
 * negocio; todo lo demás (éxitos, errores de negocio, errores de la base que no son restricciones,
 * restricciones no admitidas) pasa sin cambios.
 */
export function traducirErroresDeFiscal<T, E, C extends ErrorDeFiscalPorRestriccion>(
  resultado: Resultado<T, E | ErrorDePersistencia>,
  admitidos: readonly C[],
): Resultado<T, E | C | ErrorDePersistencia> {
  if (resultado.ok || !esErrorDePersistencia(resultado.error)) return resultado;
  const codigo = errorFiscalDeRestriccion(resultado.error);
  const admitido = admitidos.find((a) => a === codigo);
  return admitido === undefined ? resultado : err(admitido);
}
