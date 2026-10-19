/**
 * Cómo se cuenta una falla en el registro del servidor sin arriesgar secretos ni datos personales: solo el
 * tipo (`error.name`) y, si lo tiene, el código de Postgres de cinco caracteres (`42501` sin permiso, `42P01`
 * sin tabla, `28P01` clave rechazada); nunca el mensaje, que puede repetir una cadena de conexión, un host o
 * un valor. Lo comparten la guarda de migración y la salud.
 */
export function tipoDeFalla(error: unknown): string {
  if (!(error instanceof Error)) return "falla que no es un Error";
  const codigo = (error as { code?: unknown }).code;
  return typeof codigo === "string" && /^[0-9A-Z]{5}$/.test(codigo)
    ? `${error.name} ${codigo}`
    : error.name;
}
