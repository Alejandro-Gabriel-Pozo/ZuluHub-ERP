/**
 * Candado de host de la base de un cliente: la cadena del dueño (`PEDERNAL_DB_DUENO_DIRECTA` del Environment) solo se usa si su host es EXACTAMENTE el que el dueño declaró como variable NO secreta
 * del mismo Environment (`PEDERNAL_HOST_DE_LA_BASE`, a mano, una vez). Previene: que una cadena pegada por error en el Environment de un cliente (la de otro cliente o la de producción) reciba el alta
 * o el despliegue de este. `PEDERNAL_HOSTS_PROTEGIDOS` NO cubre este caso: son los hosts de los proyectos de la plataforma, no el de la base. Sin variable, o con una que no tiene forma de host, no coincide
 * (falla cerrado). Nunca devuelve ni imprime ninguno de los dos valores.
 */
export const VARIABLE_DEL_HOST_DE_LA_BASE = "PEDERNAL_HOST_DE_LA_BASE";

const FORMA_DE_HOST = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

export function hostDeLaBaseCoincide(
  cadena: string | undefined,
  esperado: string | undefined,
): boolean {
  const declarado = (esperado ?? "").trim().toLowerCase();
  if (!FORMA_DE_HOST.test(declarado)) return false;
  try {
    return new URL((cadena ?? "").trim()).hostname.toLowerCase() === declarado;
  } catch {
    return false;
  }
}
