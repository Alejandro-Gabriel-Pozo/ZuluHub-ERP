import { esObjeto, leerJson } from "./json-seguro";

/**
 * Lo que `GET /api/auth/get-session` le cuenta al navegador (el «Seguir» del aviso de inactividad y
 * poco más). La librería devuelve la sesión entera, con su `token` y los datos del usuario: aunque la
 * cookie sea `HttpOnly`, un token en el cuerpo lo lee cualquier script de la página. Acá se reduce a lo
 * que la pantalla necesita para decidir si avisa o vuelve a pedir el ingreso: si hay sesión vigente, hasta
 * cuándo y desde cuándo no se usa. Quién es la persona lo dice el servidor, no esta respuesta.
 */
export type CuerpoPublicoDeSesion =
  Readonly<{ vigente: false }> | Readonly<{ vigente: true; venceEn: string; ultimoUso: string }>;

const SIN_SESION: CuerpoPublicoDeSesion = Object.freeze({ vigente: false });

function fechaIso(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

export function cuerpoPublicoDeSesion(cuerpo: string): CuerpoPublicoDeSesion {
  const datos = leerJson(cuerpo);
  const session = esObjeto(datos) && "session" in datos ? datos.session : null;
  if (!esObjeto(session)) return SIN_SESION;
  const venceEn = "expiresAt" in session ? fechaIso(session.expiresAt) : null;
  const ultimoUso = "updatedAt" in session ? fechaIso(session.updatedAt) : null;
  if (venceEn === null || ultimoUso === null) return SIN_SESION;
  return { vigente: true, venceEn, ultimoUso };
}
