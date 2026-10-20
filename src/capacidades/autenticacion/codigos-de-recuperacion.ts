import { createHmac } from "node:crypto";
import { FORMA_DEL_CODIGO_DE_RECUPERACION } from "./cuerpos-de-segundo-factor";
import { esObjeto, leerJson } from "./json-seguro";

/**
 * Cómo se guardan los códigos de recuperación del segundo factor (h5-p8 §2.4 y §2.6): HASHEADOS, nunca en claro. La
 * librería guarda los códigos «en claro» o «cifrados» (con la clave de la propia base de datos de la aplicación, que
 * los puede descifrar); no ofrece guardarlos hasheados. Acá se guarda, de cada código, un HMAC-SHA256 con el secreto
 * de la audiencia: quien se lleve una copia de la base no puede recuperar ningún código (ni siquiera probándolos
 * todos: sin el secreto no hay con qué comparar), y rotar el secreto los invalida, como invalida el TOTP.
 *
 * Se engancha con las dos opciones `encrypt` y `decrypt` que la librería sí ofrece (`storeBackupCodes`):
 *  - `codificarCodigosDeRecuperacion`: lo que la librería quiere guardar (la lista de códigos en JSON) se guarda como
 *    la lista de sus huellas. Es IDEMPOTENTE: la librería vuelve a codificar la lista restante al gastar un código, y
 *    ahí ya son huellas.
 *  - al verificar, la librería busca el código que mandó la persona en esa lista: el gancho de entrada del adaptador
 *    reemplaza el código por su huella antes (`huellaDeCodigoDeRecuperacion`). Una prueba de integración comprueba que
 *    el código en claro no aparece en la base y que se gasta una sola vez.
 */

const PREFIJO_DE_HUELLA = "h1:";
const FORMA_DE_HUELLA = /^h1:[0-9a-f]{64}$/;
const SEPARADOR_DE_DOMINIO = "zuluhub/codigo-de-recuperacion/v1:";

export const esHuellaDeCodigoDeRecuperacion = (texto: string): boolean =>
  FORMA_DE_HUELLA.test(texto);

/** La huella de un código: `h1:` y el HMAC-SHA256 (hexadecimal) de `codigo`, con `secreto` como clave. */
export function huellaDeCodigoDeRecuperacion(secreto: string, codigo: string): string {
  const hmac = createHmac("sha256", secreto)
    .update(`${SEPARADOR_DE_DOMINIO}${codigo}`)
    .digest("hex");
  return `${PREFIJO_DE_HUELLA}${hmac}`;
}

/**
 * La lista (JSON de textos) con cada código reemplazado por su huella; lo que ya es una huella queda igual. Un texto
 * que no es ni una huella ni un código con la forma de los que emite la librería NO se guarda: falla cerrado, para que
 * un cambio de formato de la librería nunca deje algo en claro sin que nadie lo vea.
 */
export function codificarCodigosDeRecuperacion(secreto: string, listaEnJson: string): string {
  const lista: unknown = JSON.parse(listaEnJson);
  if (!Array.isArray(lista) || !lista.every((c): c is string => typeof c === "string")) {
    throw new RangeError("los códigos de recuperación tienen que ser una lista de textos");
  }
  return JSON.stringify(
    lista.map((c) => {
      if (esHuellaDeCodigoDeRecuperacion(c)) return c;
      if (!FORMA_DEL_CODIGO_DE_RECUPERACION.test(c)) {
        throw new RangeError("un código de recuperación no tiene la forma esperada");
      }
      return huellaDeCodigoDeRecuperacion(secreto, c);
    }),
  );
}

/** Las huellas guardadas (la lista que la librería lee), o `null` si lo guardado no es una lista de huellas. */
export function huellasGuardadas(guardado: string): readonly string[] | null {
  const datos = leerJson(guardado);
  if (!esObjeto(datos) || !Array.isArray(datos)) return null;
  const lista = datos as unknown[];
  return lista.every((c): c is string => typeof c === "string" && esHuellaDeCodigoDeRecuperacion(c))
    ? lista
    : null;
}
