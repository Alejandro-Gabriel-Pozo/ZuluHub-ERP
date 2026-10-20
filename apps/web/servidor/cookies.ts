import "server-only";
import type { cookies } from "next/headers";
import { PREFIJO_DE_NAVEGADOR } from "../../../src/capacidades/autenticacion/host-de-autenticacion";
import { cookieParaNext } from "../../../src/capacidades/experiencia/set-cookie";

/**
 * Las cookies propias de la aplicación y cómo se aplican las de la librería de ingreso. Todas son del HOST
 * (sin `Domain`): una cookie de la marca A nunca viaja a la B (armazón web §4.4). Las dos propias llevan el
 * prefijo `__Host-` (M1), igual que las de la librería: el navegador exige `Secure`, `Path=/` y sin `Domain`, y
 * no deja que un subdominio del cliente las fije para todo el dominio.
 */

/** La empresa elegida en este host. No es de confianza: se valida contra las empresas de la persona en CADA pedido. */
export const COOKIE_DE_EMPRESA = `${PREFIJO_DE_NAVEGADOR}pd_empresa`;
/** El enlace de la invitación mientras la persona pasa por Google (el token no viaja en la dirección de retorno). */
export const COOKIE_DE_INVITACION = `${PREFIJO_DE_NAVEGADOR}pd_invitacion`;

const TREINTA_DIAS_EN_SEGUNDOS = 30 * 24 * 60 * 60;
const QUINCE_MINUTOS_EN_SEGUNDOS = 15 * 60;

/** HttpOnly (el JavaScript de la página no la lee), Secure, SameSite=Lax (P-7) y sin Domain. */
const BASE = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;
export const OPCIONES_DE_COOKIE_DE_EMPRESA = { ...BASE, maxAge: TREINTA_DIAS_EN_SEGUNDOS } as const;
export const OPCIONES_DE_COOKIE_DE_INVITACION = {
  ...BASE,
  maxAge: QUINCE_MINUTOS_EN_SEGUNDOS,
} as const;

/** Lo único que se necesita de `cookies()` de Next dentro de una acción o una ruta: escribir y borrar. */
export type AlmacenDeCookies = Pick<Awaited<ReturnType<typeof cookies>>, "set" | "delete">;

/**
 * Aplica los `Set-Cookie` que dejó la librería (sesión, estado del ingreso, borrado al cerrar sesión). Un
 * componente de servidor no puede: solo una acción o una ruta. Un `Set-Cookie` que no se entiende se
 * descarta (no se aplica a medias).
 */
export function aplicarCookies(almacen: AlmacenDeCookies, crudas: readonly string[]): void {
  for (const cruda of crudas) {
    const cookie = cookieParaNext(cruda);
    if (cookie === null) continue;
    const { nombre, valor, ...opciones } = cookie;
    almacen.set(nombre, valor, opciones);
  }
}
