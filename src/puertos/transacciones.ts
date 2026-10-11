import type { Contexto } from "../contexto/contexto";
import type { Resultado } from "../primitivas/resultado/resultado";

/**
 * Contrato de persistencia (ADR-004). Toda escritura y toda lectura con contexto pasan por acá.
 *
 * `Tx` es lo que el trabajo recibe para operar: los repositorios y consultas que arma la
 * composición. Cada caso de uso declara solo los que necesita, y el tipo de la herramienta de
 * acceso a datos nunca sale del adaptador.
 */

export type Aislamiento = "serializable" | "read committed";

export type OpcionesDeTransaccion = Readonly<{
  contexto: Contexto;
  /** Por defecto `serializable`, que es el nivel de las escrituras con invariantes. */
  aislamiento?: Aislamiento;
  soloLectura?: boolean;
  /** Reintentos máximos ante un conflicto de serialización o un deadlock. Por defecto 6. */
  reintentos?: number;
}>;

export type ErrorDePersistencia =
  | { readonly tipo: "Unicidad"; readonly restriccion: string | null }
  | { readonly tipo: "Superposicion"; readonly restriccion: string | null }
  | { readonly tipo: "Referencia"; readonly restriccion: string | null }
  | { readonly tipo: "Check"; readonly restriccion: string | null }
  | { readonly tipo: "AccesoDenegado" }
  | { readonly tipo: "ConcurrenciaAgotada" }
  | { readonly tipo: "Inesperado"; readonly sqlstate: string | null; readonly mensaje: string };

export interface Transacciones<Tx> {
  /**
   * Ejecuta `trabajo` en una transacción con el contexto fijado.
   *
   * - Si el trabajo devuelve `ok`, se confirma. Si devuelve un error de negocio, se revierte y el
   *   error vuelve tal cual.
   * - Ante un conflicto de serialización o un deadlock, el trabajo COMPLETO se repite; por eso no
   *   puede tener efectos externos ni leer el reloj.
   * - Los errores de la base se traducen a `ErrorDePersistencia`. Una excepción que no viene de la
   *   base se vuelve a lanzar: nunca se traga.
   */
  ejecutar<T, E>(
    opciones: OpcionesDeTransaccion,
    trabajo: (tx: Tx) => Promise<Resultado<T, E>>,
  ): Promise<Resultado<T, E | ErrorDePersistencia>>;
}
