import type { Marca } from "../identificadores/marca";
import { err, ok, type Resultado } from "../resultado/resultado";

/**
 * Email normalizado (sin espacios en los extremos y en minúsculas). Solo nace de `emailDesdeTexto`. Es
 * una primitiva y no del dominio de identidad porque lo usan también clientes y proveedores (conciliación
 * §3.7): dos reglas de email serían dos CHECK distintos en la base para el mismo dato.
 */
export type Email = Marca<string, "Email">;

const ESPACIO_BLANCO = /\s/;

/**
 * Normaliza (`trim` y minúsculas) y valida con la MISMA regla que el CHECK `persona_email_ck` de
 * la base: al menos un carácter antes de una `@` y al menos uno después (`LIKE '%_@_%'`). No se
 * inventa una validación de RFC más estricta: la verificación real del email es el enlace.
 *
 * Decisión propia, más prudente que la base: se rechaza cualquier espacio en blanco interno
 * (espacios, tabulaciones, saltos de línea). La base los aceptaría, pero un email con blancos
 * adentro nunca es una dirección real y casi siempre es un error de carga.
 */
export function emailDesdeTexto(texto: string): Resultado<Email, "EMAIL_INVALIDO"> {
  const normalizado = texto.trim().toLowerCase();
  if (ESPACIO_BLANCO.test(normalizado)) return err("EMAIL_INVALIDO");
  // Una `@` que no sea el primer carácter y que no sea el último: equivale a `LIKE '%_@_%'`.
  const arroba = normalizado.indexOf("@", 1);
  if (arroba === -1 || arroba === normalizado.length - 1) return err("EMAIL_INVALIDO");
  return ok(normalizado as Email);
}
