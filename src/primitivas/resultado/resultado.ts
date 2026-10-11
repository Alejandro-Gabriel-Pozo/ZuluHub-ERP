/**
 * Resultado de una operación que puede fallar por una razón de negocio prevista. Los errores
 * previstos se devuelven con nombre; lo inesperado se lanza y no se traga (ADR-004).
 */
export type Resultado<T, E> =
  { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly error: E };

export function ok<T>(valor: T): Resultado<T, never> {
  return { ok: true, valor };
}

export function err<E>(error: E): Resultado<never, E> {
  return { ok: false, error };
}
