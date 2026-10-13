import type { Resultado } from "../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "./transacciones";

/**
 * Lectura SIN sesión (marcas y planes, §B.2.5): la puerta pública `zuluhub_publico`. No tiene
 * contexto firmado, ni empresa, ni persona, y nunca escribe: la transacción es de solo lectura y el
 * rol de base solo ve las columnas públicas declaradas en la migración 0007.
 *
 * Es un puerto aparte de `Transacciones` a propósito: aquel exige un `Contexto` firmado en cada
 * transacción (el aislamiento por empresa), y este no puede llevarlo. Mezclarlos permitiría pedir una
 * lectura pública con un contexto de empresa, o una escritura con la puerta pública.
 *
 * Como en `Transacciones`, los errores de la base vuelven tipados (`ErrorDePersistencia`) y una
 * excepción que no viene de la base se vuelve a lanzar. Los trabajos son solo lecturas, así que no
 * hay reintentos por serialización.
 */
export interface TransaccionesPublicas<Tx> {
  leer<T>(trabajo: (tx: Tx) => Promise<T>): Promise<Resultado<T, ErrorDePersistencia>>;
}
