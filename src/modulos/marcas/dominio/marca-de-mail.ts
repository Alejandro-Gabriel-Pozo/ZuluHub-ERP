import type { Host } from "./host";

/**
 * Desde qué marca sale un mail (marcas y planes, §B.10). Dominio puro: decide con lo que el adaptador
 * leyó de la marca DEL TENANT, sin tocar datos ni entorno.
 *
 * Regla: un mail sale con la identidad de la marca del tenant, y nunca con la de otra. Eso ata el nombre
 * a la versión vigente de ESA marca (no hereda: un producto define su nombre, como pide la confirmación
 * de una versión) y el origen de los enlaces al host canónico de su aplicación. Solo la marca principal
 * puede caer en el respaldo (las variables del entorno de antes de que existieran las marcas), y solo
 * porque es la marca de las empresas que ya existían: un producto al que le falta algo no hereda el
 * nombre ni el dominio de la principal, porque el enlace de una invitación apuntaría a la puerta de otra
 * marca y quien lo abre no podría operar (§B.2.4).
 */

/** Lo que se leyó de la marca del tenant. */
export type DatosDeMarcaParaMail = Readonly<{
  esPrincipal: boolean;
  /** El nombre visible de la versión vigente de la propia marca, o `null` si no tiene ninguna. */
  nombreVisible: string | null;
  /** El host canónico ACTIVO de su aplicación, o `null` si no tiene. */
  hostCanonico: Host | null;
}>;

/** El respaldo: el nombre y el origen de las variables de entorno (ya validados por quien los carga). */
export type RespaldoDeMail = Readonly<{ nombre: string; urlBase: string }>;

export type MarcaDeMailDecidida = Readonly<{ nombre: string; urlBase: string }>;

/**
 * Con versión vigente Y host canónico, la identidad de la marca (los enlaces son `https`: el host
 * canónico no lleva puerto ni esquema). Si falta cualquiera de las dos cosas: el respaldo completo para
 * la principal (nombre y origen juntos, nunca mezclados con la mitad de una marca) y `null` para
 * cualquier otra marca.
 */
export function decidirMarcaDeMail(
  datos: DatosDeMarcaParaMail,
  respaldo: RespaldoDeMail,
): MarcaDeMailDecidida | null {
  if (datos.nombreVisible !== null && datos.hostCanonico !== null) {
    return { nombre: datos.nombreVisible, urlBase: `https://${datos.hostCanonico}` };
  }
  return datos.esPrincipal ? { nombre: respaldo.nombre, urlBase: respaldo.urlBase } : null;
}
