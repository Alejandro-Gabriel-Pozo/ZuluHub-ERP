import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { normalizarHost, type Host } from "./host";

/**
 * Los hosts protegidos: los de los proyectos de la propia plataforma (la consola, la aplicación del producto, la landing). Ningún cliente puede registrarlos, verificarlos ni
 * activarlos como dominio propio: sería servir a un cliente en el nombre de la plataforma (o robarle el suyo). Los valores los carga el dueño en el entorno de la consola
 * (`PEDERNAL_HOSTS_PROTEGIDOS`); el código solo valida la forma. Falla cerrado: sin la lista no se arma el caso de uso (ver `composicion/plataforma.ts`), y una lista con un
 * elemento que no es un host válido se rechaza entera. Chequeo: `hosts-protegidos.test.ts` y `test/integracion/dominios-hosts-protegidos.test.ts`.
 */

export const MAXIMO_DE_HOSTS_PROTEGIDOS = 50;

export type ErrorDeListaDeHostsProtegidos = "LISTA_DE_HOSTS_PROTEGIDOS_INVALIDA";

/** Una lista separada por comas: cada elemento, un host ya normalizable; de 1 a `MAXIMO_DE_HOSTS_PROTEGIDOS` distintos. Sin elementos vacíos ni repetidos. */
export function leerHostsProtegidos(
  texto: string,
): Resultado<ReadonlySet<Host>, ErrorDeListaDeHostsProtegidos> {
  const partes = texto.split(",").map((parte) => parte.trim());
  if (partes.length === 0 || partes.length > MAXIMO_DE_HOSTS_PROTEGIDOS) {
    return err("LISTA_DE_HOSTS_PROTEGIDOS_INVALIDA");
  }
  const hosts = new Set<Host>();
  for (const parte of partes) {
    const host = normalizarHost(parte);
    if (!host.ok || hosts.has(host.valor)) return err("LISTA_DE_HOSTS_PROTEGIDOS_INVALIDA");
    hosts.add(host.valor);
  }
  return ok(hosts);
}
