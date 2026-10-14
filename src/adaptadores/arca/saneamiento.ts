/**
 * Saneamiento de lo que sale del adaptador de ARCA (spec H7 facturación §B.5.5, criterio 3 de §B.5.7): nada
 * de lo que el adaptador devuelve (motivos, detalles, mensajes) lleva el `Token`, el `Sign`, el CMS firmado
 * ni un PEM. Valor puro.
 *
 * Es una segunda defensa: la primera es que el adaptador solo arma sus textos con códigos y con los
 * `Msg` de ARCA, nunca con el texto de una excepción ni con un pedazo del pedido o la respuesta. Lo que
 * cubre `sanearTexto` es un `Msg` de ARCA que repita una credencial, o una forma nueva de la respuesta.
 * Previene: que una credencial quede en `intento_arca`, en un registro o en la auditoría. Chequeo: las
 * pruebas de saneamiento y la guarda de `adaptador-arca.test.ts`, que falla si en CUALQUIER resultado del
 * adaptador aparece una credencial conocida.
 */

const OCULTO = "[OCULTO]";
const PEM_OCULTO = "[PEM OCULTO]";

/** Los elementos cuyo contenido es una credencial (`in0` es el CMS firmado del pedido a WSAA). */
const ELEMENTOS_SECRETOS = ["token", "sign", "in0"] as const;

const PREFIJO = String.raw`(?:[A-Za-z0-9_.-]+:)?`;

/**
 * Para cada elemento: su contenido, sin importar mayúsculas ni prefijo de espacio de nombres, en dos formas
 * (la escrita `<token>…</token>` y la escapada `&lt;token&gt;…&lt;/token&gt;` del `loginTicketResponse`,
 * que viaja como texto dentro de `loginCmsReturn`). Si el cierre no está (respuesta cortada), se oculta hasta
 * el final del texto.
 */
const PATRONES = ELEMENTOS_SECRETOS.flatMap((elemento) => [
  new RegExp(
    String.raw`(<${PREFIJO}${elemento}\b[^>]*>)([\s\S]*?)(</${PREFIJO}${elemento}\s*>|$)`,
    "gi",
  ),
  new RegExp(
    String.raw`(&lt;${PREFIJO}${elemento}\b(?:(?!&gt;)[\s\S])*&gt;)([\s\S]*?)(&lt;/${PREFIJO}${elemento}\s*&gt;|$)`,
    "gi",
  ),
]);

const BLOQUE_PEM = /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/g;

/** Una tira larga de caracteres de base64: un token, una firma o un CMS suelto, no una palabra. */
const TIRA_DE_BASE64 = /[A-Za-z0-9+/]{80,}={0,2}/g;

export function sanearTexto(texto: string): string {
  let limpio = texto;
  for (const patron of PATRONES) {
    limpio = limpio.replace(
      patron,
      (_todo, abre: string, _contenido: string, cierra: string) => `${abre}${OCULTO}${cierra}`,
    );
  }
  return limpio.replace(BLOQUE_PEM, PEM_OCULTO).replace(TIRA_DE_BASE64, OCULTO);
}

/** Lo máximo que se deja pasar de un texto de ARCA (`Msg` es de hasta 255 caracteres, WSFE v4.8). */
export const LARGO_MAXIMO_DE_TEXTO = 500;

/** El texto de ARCA listo para guardarse o mostrarse: saneado y acotado. */
export function textoSeguro(texto: string): string {
  return sanearTexto(texto).slice(0, LARGO_MAXIMO_DE_TEXTO);
}
