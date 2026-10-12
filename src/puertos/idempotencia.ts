import type { Dato } from "./sin-secretos";

/**
 * Qué dice la tabla de idempotencia de plataforma sobre una clave (H5 plataforma, §B.4).
 *  - `NUEVA`: nadie la usó; hay que ejecutar la operación y `registrar` el resultado.
 *  - `REPETIDA`: la misma operación con la misma entrada ya se hizo; se devuelve lo que dio, SIN
 *    escribir nada más.
 *  - `CLAVE_REUTILIZADA`: la clave ya se usó con OTRA operación o con OTRA entrada.
 */
export type ConsultaDeIdempotencia =
  | Readonly<{ tipo: "NUEVA" }>
  | Readonly<{ tipo: "REPETIDA"; resultado: Dato }>
  | Readonly<{ tipo: "CLAVE_REUTILIZADA" }>;

/**
 * Puerto de idempotencia de las escrituras de plataforma. Las claves son POR ADMINISTRADOR (el del
 * contexto): dos administradores pueden usar la misma sin chocar, y uno no ve las del otro. La huella
 * (sha256 de la entrada canónica) la calcula el adaptador: dos entradas iguales con los campos en otro
 * orden dan la misma huella.
 *
 * Uso dentro de la transacción del caso de uso (SERIALIZABLE, la de por defecto): `consultar` primero y
 * `registrar` al final, en la misma transacción que las escrituras. Dos pedidos simultáneos con la misma
 * clave no duplican nada: el segundo choca al registrar, la transacción se repite y entonces ve la fila
 * del primero (`REPETIDA`). Con un nivel menor, el choque sale como error de unicidad
 * (`idempotencia_plataforma_pkey`) y la transacción se revierte entera: tampoco duplica.
 *
 * Solo un administrador puede usarla: con el actor `sistema` (el barrido, que es repetible por sí
 * mismo) o con un contexto que no es de plataforma, lanza `RangeError`. Una clave o una operación con
 * forma inválida también (la validación de forma con error tipado es del caso de uso).
 */
export interface IdempotenciaDePlataforma {
  consultar(operacion: string, clave: string, entrada: Dato): Promise<ConsultaDeIdempotencia>;
  /** `resultado` es lo que se devolverá ante cada repetición; no lleva secretos. */
  registrar(operacion: string, clave: string, entrada: Dato, resultado: Dato): Promise<void>;
}
