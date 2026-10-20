import { esObjeto, leerJson } from "./json-seguro";
import {
  SIN_SESION_DE_PLATAFORMA,
  estadoDeSesionDePlataforma,
  type EstadoDeSesionDePlataforma,
} from "./estado-de-sesion-de-plataforma";
import { LIMITES_DE_SESION_DE_PLATAFORMA, type LimitesDeSesion } from "./vigencia-de-sesion";

/**
 * Lo que `GET /api/auth/get-session` de la consola le cuenta al navegador (el «Seguir» del aviso): el MISMO estado
 * que `estado-de-sesion`, calculado con la sesión ya renovada. La librería devuelve la sesión entera, con su `token` y
 * los datos del usuario (un script de la página los leería aunque la cookie sea `HttpOnly`): acá se reduce a
 * `{ vigente, venceEnMs, motivo, segundoFactorRecienteHastaMs }`. Una respuesta que no se entiende es «sin sesión».
 */

function fecha(valor: unknown): Date | null {
  if (typeof valor !== "string") return null;
  const f = new Date(valor);
  return Number.isNaN(f.getTime()) ? null : f;
}

export function cuerpoPublicoDeSesionDePlataforma(
  cuerpo: string,
  ahora: Date,
  limites: LimitesDeSesion = LIMITES_DE_SESION_DE_PLATAFORMA,
): EstadoDeSesionDePlataforma {
  const datos = leerJson(cuerpo);
  const session = esObjeto(datos) && "session" in datos ? datos.session : null;
  if (!esObjeto(session)) return SIN_SESION_DE_PLATAFORMA;
  const creadaEn = "createdAt" in session ? fecha(session.createdAt) : null;
  const ultimoUso = "updatedAt" in session ? fecha(session.updatedAt) : null;
  const venceEn = "expiresAt" in session ? fecha(session.expiresAt) : null;
  if (creadaEn === null || ultimoUso === null || venceEn === null) return SIN_SESION_DE_PLATAFORMA;
  const segundoFactorEn = "segundoFactorEn" in session ? fecha(session.segundoFactorEn) : null;
  return estadoDeSesionDePlataforma(
    { creadaEn, ultimoUso, venceEn, segundoFactorEn },
    ahora,
    limites,
  );
}
