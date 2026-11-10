import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { traducirErrores } from "../casos-de-uso/traducir";

/**
 * Los errores de restricciones de la base que forman parte del contrato del cobro (`ErrorAlCobrar`). El puerto decide todo esto ANTES de
 * escribir (por eso son la red de seguridad de la base y no el camino normal), pero un error de la base en la transacción de ventas la
 * deja abortada y sale como `ErrorDePersistencia` en el resultado de ventas: ventas lo pasa por acá y obtiene el código de negocio. Una
 * restricción que no está en la lista (o sin traducción en `ERRORES_DE_CAJA_POR_RESTRICCION`) sale tal cual: nunca se traga ni se disfraza.
 */
const ERRORES_DEL_COBRO_POR_RESTRICCION = [
  "MEDIO_NO_ENCONTRADO",
  "MEDIO_INACTIVO",
  "CUENTA_DE_COBRO_NO_ADMITIDA",
  "CUENTA_DE_COBRO_NO_ENCONTRADA",
  "CUENTA_DE_COBRO_DE_OTRA_SUCURSAL",
  "CUENTA_DE_COBRO_INACTIVA",
  "CUENTA_DE_COBRO_INCOMPATIBLE",
  "ORIGEN_INVALIDO",
  "IMPORTE_INVALIDO",
] as const;

export function traducirErroresDelCobro<T, E>(resultado: Resultado<T, E | ErrorDePersistencia>) {
  return traducirErrores(resultado, ERRORES_DEL_COBRO_POR_RESTRICCION);
}
