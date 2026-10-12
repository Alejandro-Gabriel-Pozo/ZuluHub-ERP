import type { Marca } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/** Un nombre de host ya normalizado: solo `normalizarHost` lo fabrica. */
export type Host = Marca<string, "Host">;

export type ErrorDeHost = "HOST_INVALIDO";

const LARGO_MAXIMO_DEL_HOST = 253;
const LARGO_MAXIMO_DE_ETIQUETA = 63;
const PUERTO_MAXIMO = 65_535;

/** Solo ASCII de un host: letras, dígitos, guion y punto. Se mira ANTES de pasar a minúsculas. */
const SOLO_CARACTERES_DE_HOST = /^[A-Za-z0-9.-]+$/;
/** Un puerto al final: `:` y de uno a cinco dígitos. */
const PUERTO = /:([0-9]{1,5})$/;
/** Una etiqueta: letras minúsculas y dígitos, con guiones solo en el medio. */
const ETIQUETA = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
/** Lo que un navegador toma por un número: decimal, o hexadecimal con `0x`. */
const PARECE_NUMERO = /^([0-9]+|0x[0-9a-f]*)$/;

/**
 * Normaliza el host que llega en la solicitud (marcas y planes, §B.2.2). Es la ÚNICA puerta de entrada de
 * un nombre de host al sistema; un host inválido se trata igual que uno desconocido (página neutra).
 * La misma regla vive como `CHECK` en `dominio_de_marca.host` (`host_valido`): lo que acepta esta
 * función, ya normalizado, tiene que aceptarlo la base, y a la inversa.
 *
 * Reglas, en orden:
 *  1. Solo ASCII `[A-Za-z0-9.-]` (más, opcionalmente, un puerto): un dominio internacional se registra
 *     y llega en su forma `xn--`. Se mira antes de pasar a minúsculas: el signo Kelvin (U+212A) pasa a
 *     `k` al bajar de caja y no puede colarse como si fuera ASCII.
 *  2. Se quita un puerto (`:` y de 1 a 5 dígitos, hasta 65535) y UN punto final.
 *  3. Pasa a minúsculas. Sin espacios, sin cortes: un host con blancos no se recorta, se rechaza.
 *  4. Total de 1 a 253 caracteres; cada etiqueta de 1 a 63 con `[a-z0-9-]`, sin guion al principio ni
 *     al final. No se quita `www.` ni se admiten comodines o sufijos: la coincidencia es exacta.
 *  5. Se rechazan los literales IP: IPv6 (lleva `:` y `[`, que no son de host) e IPv4, incluidas sus
 *     formas cortas, decimales y hexadecimales (`127.1`, `2130706433`, `0x7f.1`): si la ÚLTIMA etiqueta
 *     es un número, un navegador lo toma por una dirección. Ningún dominio real termina en número.
 */
export function normalizarHost(texto: string): Resultado<Host, ErrorDeHost> {
  const puerto = PUERTO.exec(texto);
  if (puerto !== null && Number(puerto[1]) > PUERTO_MAXIMO) return err("HOST_INVALIDO");
  const sinPuerto = puerto === null ? texto : texto.slice(0, puerto.index);
  const sinPunto = sinPuerto.endsWith(".") ? sinPuerto.slice(0, -1) : sinPuerto;
  if (!SOLO_CARACTERES_DE_HOST.test(sinPunto)) return err("HOST_INVALIDO");
  const host = sinPunto.toLowerCase();
  if (host.length > LARGO_MAXIMO_DEL_HOST) return err("HOST_INVALIDO");
  const etiquetas = host.split(".");
  if (
    !etiquetas.every(
      (etiqueta) => etiqueta.length <= LARGO_MAXIMO_DE_ETIQUETA && ETIQUETA.test(etiqueta),
    )
  ) {
    return err("HOST_INVALIDO");
  }
  if (PARECE_NUMERO.test(etiquetas[etiquetas.length - 1] as string)) return err("HOST_INVALIDO");
  return ok(host as Host);
}
