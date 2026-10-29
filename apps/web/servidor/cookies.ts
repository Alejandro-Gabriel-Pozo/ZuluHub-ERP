import "server-only";
import type { cookies } from "next/headers";
import { PREFIJO_DE_NAVEGADOR } from "../../../src/capacidades/autenticacion/host-de-autenticacion";
import { cookieParaNext } from "../../../src/capacidades/experiencia/set-cookie";

/**
 * Las cookies propias de la aplicación y cómo se aplican las de la librería de ingreso. Todas son del HOST
 * (sin `Domain`): una cookie de la marca A nunca viaja a la B (armazón web §4.4). Las propias llevan el
 * prefijo `__Host-` (M1), igual que las de la librería: el navegador exige `Secure`, `Path=/` y sin `Domain`, y
 * no deja que un subdominio del cliente las fije para todo el dominio.
 */

/** La empresa elegida en este host. No es de confianza: se valida contra las empresas de la persona en CADA pedido. */
export const COOKIE_DE_EMPRESA = `${PREFIJO_DE_NAVEGADOR}pd_empresa`;
/**
 * La sucursal que la persona eligió para mirar el listado de comprobantes (D-34). Como la de empresa, no es de confianza: se valida
 * contra las sucursales que el alcance de la persona deja elegir en CADA pedido (`sucursal-elegida.ts`), y el servidor la
 * verifica otra vez en la consulta. Un `localStorage` no serviría: el servidor no lo ve.
 */
export const COOKIE_DE_SUCURSAL = `${PREFIJO_DE_NAVEGADOR}pd_sucursal`;
/** El enlace de la invitación mientras la persona pasa por Google (el token no viaja en la dirección de retorno). */
export const COOKIE_DE_INVITACION = `${PREFIJO_DE_NAVEGADOR}pd_invitacion`;

const TREINTA_DIAS_EN_SEGUNDOS = 30 * 24 * 60 * 60;
const QUINCE_MINUTOS_EN_SEGUNDOS = 15 * 60;

/** HttpOnly (el JavaScript de la página no la lee), Secure, SameSite=Lax (P-7) y sin Domain. */
const BASE = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;
export const OPCIONES_DE_COOKIE_DE_EMPRESA = { ...BASE, maxAge: TREINTA_DIAS_EN_SEGUNDOS } as const;
export const OPCIONES_DE_COOKIE_DE_SUCURSAL = {
  ...BASE,
  maxAge: TREINTA_DIAS_EN_SEGUNDOS,
} as const;
export const OPCIONES_DE_COOKIE_DE_INVITACION = {
  ...BASE,
  maxAge: QUINCE_MINUTOS_EN_SEGUNDOS,
} as const;

/** Lo único que se necesita de `cookies()` de Next dentro de una acción o una ruta: escribir y borrar. */
export type AlmacenDeCookies = Pick<Awaited<ReturnType<typeof cookies>>, "set" | "delete">;

/**
 * Vence una cookie con los MISMOS atributos con que se fijó: vacía y `maxAge: 0`. Todo vencimiento de una `__Host-` pasa
 * por acá: `delete(nombre)` no manda `Secure` y el navegador rechaza tocar una `__Host-` sin él (la cookie seguiría viva).
 */
export function vencerCookie(
  almacen: Pick<AlmacenDeCookies, "set">,
  nombre: string,
  opciones: typeof OPCIONES_DE_COOKIE_DE_EMPRESA | typeof OPCIONES_DE_COOKIE_DE_INVITACION,
): void {
  almacen.set(nombre, "", { ...opciones, maxAge: 0 });
}

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
