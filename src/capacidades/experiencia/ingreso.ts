/**
 * El «Ingresar» de la landing (armazón web §1.1): lleva al host de la aplicación de la misma marca.
 */
const HOST_DE_APP = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const LARGO_MAXIMO_DEL_HOST = 253;

/**
 * La dirección del «Ingresar» de la landing: `https://<host de la app>/`. El host ya viene normalizado
 * de la base; igual solo se arma con un host de letras minúsculas, dígitos, guiones y puntos (sin
 * puerto, usuario ni ruta) y, si no calza, no hay enlace: nunca se manda a alguien a un destino raro.
 */
export function urlDeIngreso(hostDeApp: string | null): string | null {
  if (hostDeApp === null || hostDeApp.length > LARGO_MAXIMO_DEL_HOST) return null;
  return HOST_DE_APP.test(hostDeApp) ? `https://${hostDeApp}/` : null;
}
