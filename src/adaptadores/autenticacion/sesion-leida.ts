/**
 * Lo que este adaptador lee de una sesión de la librería de ingreso, que declara sus campos propios como
 * `Record<string, unknown>` (los campos adicionales no tienen tipo): cada lectura es defensiva y falla cerrado.
 */

/** El host guardado en una sesión (la columna propia `host`); vacío si no se puede leer: no coincide con ninguno. */
export function hostGuardado(sesion: object): string {
  const host = (sesion as Record<string, unknown>)["host"];
  return typeof host === "string" ? host : "";
}

/** Cuándo se verificó el segundo factor en esa sesión (`segundo_factor_en`), o `null` si nunca o no se puede leer. */
export function segundoFactorEnDe(sesion: object): Date | null {
  const valor = (sesion as Record<string, unknown>)["segundoFactorEn"];
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === "string") {
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }
  return null;
}

/**
 * Si el usuario ya tiene el segundo factor enrolado Y verificado (`twoFactorEnabled`, que la librería pone en `true`
 * recién al verificar el primer código). Solo cambia qué código público se informa a quien entra sin segundo factor en
 * la sesión (verificar o enrolar); nunca deja entrar. Lo que no se lee como `true` es `false`.
 */
export function segundoFactorEnroladoDe(usuario: object): boolean {
  return (usuario as Record<string, unknown>)["twoFactorEnabled"] === true;
}
