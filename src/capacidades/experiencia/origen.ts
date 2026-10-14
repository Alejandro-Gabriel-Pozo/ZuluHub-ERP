/**
 * ¿El pedido viene de la propia aplicación? (P-7, armazón web §7). Next ya rechaza una acción del servidor
 * cuyo `Origin` no coincide con el `Host`; acá se repite a propósito en cada acción (cinturón y tirantes):
 * si una versión de Next cambiara su comprobación, la acción seguiría cerrada. Previene: que una página de
 * otro sitio haga que el navegador de una persona con sesión dispare una acción (cerrar sesión, elegir
 * empresa, aceptar una invitación). Chequeo: `origen.test.ts` y las pruebas de acciones de `test/web`.
 *
 * Reglas, de lo conservador a lo permisivo:
 *  - un `Origin` con otro host (o puerto) es de afuera;
 *  - un `Origin` ilegible, `null` (documento aislado, redirección entre sitios) o que no es https es de afuera;
 *  - SIN `Origin` (un cliente que no es un navegador moderno) se deja pasar, como hace Next: la cookie de
 *    sesión es `SameSite=Lax`, que el navegador no manda en un `POST` entre sitios. Es un supuesto declarado.
 */
export function origenEsPropio(origen: string | null, host: string): boolean {
  if (origen === null) return true;
  let url: URL;
  try {
    url = new URL(origen);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || host === "") return false;
  return url.host === host.toLowerCase();
}
