/**
 * Saneamiento del espía: nada de lo que se escribe (respuestas grabadas, informe, pantalla) lleva la clave privada,
 * el `Token`, el `Sign`, el CMS firmado ni un PEM de clave. Dos defensas:
 *  1. `sanear` reemplaza por `[OCULTO]` los elementos `token`, `sign` y `in0` (el CMS) en cualquier mayúscula, con o
 *     sin prefijo y también escapados dentro de otro XML (`&lt;token&gt;…`), y los bloques PEM de claves privadas.
 *  2. `exigirSinSecretos` revisa el texto final contra los secretos CONOCIDOS de la corrida (el token, la firma, el
 *     CMS) y contra cualquier «PRIVATE KEY»: si aparece algo, lanza y no se escribe nada. Previene un saneamiento que
 *     se le escapa a una forma nueva de la respuesta.
 */

const OCULTO = "[OCULTO]";

/** Los elementos cuyo contenido es una credencial (sin el prefijo de espacio de nombres). */
const ELEMENTOS_SECRETOS = ["token", "sign", "in0"] as const;

export function sanear(texto: string): string {
  let r = texto;
  for (const elemento of ELEMENTOS_SECRETOS) {
    // <ns:Token ...>…</ns:Token>
    r = r.replace(
      new RegExp(
        `(<(?:[A-Za-z0-9_]+:)?${elemento}\\b[^>]*>)[\\s\\S]*?(</(?:[A-Za-z0-9_]+:)?${elemento}>)`,
        "gi",
      ),
      `$1${OCULTO}$2`,
    );
    // &lt;token&gt;…&lt;/token&gt; (el loginTicketResponse viaja escapado dentro de loginCmsReturn)
    r = r.replace(
      new RegExp(
        `(&lt;(?:[A-Za-z0-9_]+:)?${elemento}\\b(?:(?!&gt;)[\\s\\S])*&gt;)[\\s\\S]*?(&lt;/(?:[A-Za-z0-9_]+:)?${elemento}&gt;)`,
        "gi",
      ),
      `$1${OCULTO}$2`,
    );
  }
  return r.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[CLAVE OCULTA]",
  );
}

export class SecretoEnLaSalida extends Error {
  override name = "SecretoEnLaSalida";
}

/**
 * Lanza si el texto contiene alguno de los secretos conocidos (o un pedazo de 24 caracteres de alguno: un recorte
 * también sirve para atacar) o la marca de una clave privada. El mensaje no repite el secreto.
 */
export function exigirSinSecretos(texto: string, secretos: readonly string[], donde: string): void {
  if (/PRIVATE KEY/.test(texto)) {
    throw new SecretoEnLaSalida(`${donde}: tiene un bloque de clave privada; no se escribe`);
  }
  for (const secreto of secretos) {
    if (secreto.length < 8) continue;
    const pedazos =
      secreto.length <= 24
        ? [secreto]
        : [
            secreto.slice(0, 24),
            secreto.slice(-24),
            secreto.slice(Math.floor(secreto.length / 2) - 12, Math.floor(secreto.length / 2) + 12),
          ];
    if (pedazos.some((p) => texto.includes(p))) {
      throw new SecretoEnLaSalida(`${donde}: contiene una credencial de la corrida; no se escribe`);
    }
  }
}

/** Sanea y además verifica: lo único que se usa para escribir o mostrar. */
export function paraEscribir(texto: string, secretos: readonly string[], donde: string): string {
  const limpio = sanear(texto);
  exigirSinSecretos(limpio, secretos, donde);
  return limpio;
}
