import { err, ok, type Resultado } from "../resultado/resultado";
import { textoDeUnaLineaDesdeTexto, type MotivoDeTextoInvalido } from "./texto-de-una-linea";

/**
 * FICHAS DEL DATO: NOMBRE, RUBRO, LUGAR Y CÓDIGO DE LA CARTA PÚBLICA (carta real, §3.2 de `11-especificaciones/carta-real-especificacion.md`).
 * El nombre (1 a 80) es el título que ve el comensal; el rubro (1 a 40) y el lugar (1 a 120) son opcionales (Q3, respondida por el dueño el
 * 12/11/2026): quien llama guarda `null` cuando no los carga. Los tres usan la lista de permitidos común de `texto-de-una-linea.ts` y no exigen letra.
 * Los topes son los de la especificación (§3.2): la base los copia en los CHECK de `carta_publica` (0043) y una prueba falla si difieren.
 *
 * El CÓDIGO es la llave pública del QR: de 22 a 64 caracteres de `A-Za-z0-9_-` (base64url). 22 es lo que da el azar de 128 bits, el mínimo de la
 * especificación (§3.2, T-3); acá solo se valida la FORMA: que no sea adivinable lo garantiza quien lo genera (un puerto de azar, T2), no esta función.
 * Costo de revertir cualquier tope: cambiar la constante y el CHECK de la base.
 */
export const LARGO_MAXIMO_DEL_NOMBRE_DE_CARTA = 80;
export const LARGO_MAXIMO_DEL_RUBRO_DE_CARTA = 40;
export const LARGO_MAXIMO_DEL_LUGAR_DE_CARTA = 120;

/** De 22 (el azar de 128 bits en base64url) a 64 caracteres: escrito una sola vez, acá; la base lo copia en `carta_publica_codigo_ck`. */
const CODIGO_DE_CARTA = /^[A-Za-z0-9_-]{22,64}$/;

export function nombreDeCartaDesdeTexto(texto: string): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_NOMBRE_DE_CARTA,
    exigirUnaLetra: false,
    conSignosDeCatalogo: true,
  });
}

export function rubroDeCartaDesdeTexto(texto: string): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_RUBRO_DE_CARTA,
    exigirUnaLetra: false,
    conSignosDeCatalogo: true,
  });
}

export function lugarDeCartaDesdeTexto(texto: string): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: LARGO_MAXIMO_DEL_LUGAR_DE_CARTA,
    exigirUnaLetra: false,
    conSignosDeCatalogo: true,
  });
}

/**
 * El mensaje de la portada (tercera línea, abajo de todo): hasta 60 caracteres, el largo del «lema» del prototipo `carta.html`. Opcional: quien llama guarda `null` si no
 * lo carga. El 60 va escrito acá, una sola vez y sin constante nombrada: es un número común y una constante `LARGO_…` lo haría chocar con cualquier otro 60 del código.
 */
export function mensajeDePortadaDesdeTexto(
  texto: string,
): Resultado<string, MotivoDeTextoInvalido> {
  return textoDeUnaLineaDesdeTexto(texto, {
    maximo: 60,
    exigirUnaLetra: false,
    conSignosDeCatalogo: true,
  });
}

/** ¿Tiene la forma de un código de carta? No dice si existe ni si es adivinable. */
export function codigoDeCartaDesdeTexto(
  texto: string,
): Resultado<string, "CODIGO_DE_CARTA_INVALIDO"> {
  return CODIGO_DE_CARTA.test(texto) ? ok(texto) : err("CODIGO_DE_CARTA_INVALIDO");
}
