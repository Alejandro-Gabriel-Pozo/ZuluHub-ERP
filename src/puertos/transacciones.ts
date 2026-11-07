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
  /**
   * Reintentos máximos ante un conflicto de serialización o un deadlock. Entero mayor o igual a 0
   * (si no, `ejecutar` lanza `RangeError`). Por defecto 6.
   */
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

/**
 * Las lecturas de UN pedido comparten una sola transacción de solo lectura. Dentro de `trabajo`, cada `ejecutar` que sea de lectura
 * (`read committed`, `soloLectura`) y use ESTE mismo `contexto` (el mismo objeto, el que armó el servidor para este pedido) se une a la
 * transacción abierta en vez de abrir la suya: una sola vez `BEGIN`, el contexto firmado y el `COMMIT` por pantalla, y los permisos
 * que lee el guard se resuelven una vez. Cada consulta sigue pidiendo SU acción al guard: nada se autoriza por estar unida.
 * Cualquier otra llamada (otro contexto, una escritura, otro aislamiento) abre la suya, como siempre. Nada se guarda al terminar el
 * pedido: la unidad vive lo que dura `trabajo`, y un pedido concurrente no la ve (cada pedido tiene su propio contexto).
 */
export interface LecturasCompartidas {
  conLecturasCompartidas<T>(contexto: Contexto, trabajo: () => Promise<T>): Promise<T>;
}

export interface Transacciones<Tx> {
  /**
   * Ejecuta `trabajo` en una transacción con el contexto fijado.
   *
   * - Si el trabajo devuelve `ok`, se confirma. Si devuelve un error de negocio, se revierte y el
   *   error vuelve tal cual.
   * - Ante un conflicto de serialización o un deadlock, el trabajo COMPLETO se repite; por eso no
   *   puede tener efectos externos ni leer el reloj.
   * - Si el trabajo atrapa un error de la base y devuelve `ok`, la transacción queda abortada y no se
   *   confirma: vuelve `Inesperado` (SQLSTATE 25P02), nunca un éxito falso.
   * - Los errores de la base se traducen a `ErrorDePersistencia`. Una excepción que no viene de la
   *   base se vuelve a lanzar: nunca se traga.
   */
  ejecutar<T, E>(
    opciones: OpcionesDeTransaccion,
    trabajo: (tx: Tx) => Promise<Resultado<T, E>>,
  ): Promise<Resultado<T, E | ErrorDePersistencia>>;
}
