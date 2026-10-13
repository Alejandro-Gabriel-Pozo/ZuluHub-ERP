/**
 * Guarda de red del traedor de fotos (carta, §5.7.3 S2): decide si una IP LITERAL es alcanzable. El
 * traedor resuelve el nombre una sola vez y llama a esto con CADA dirección devuelta; si alguna es
 * `false`, no conecta. Dominio puro: no resuelve nada.
 *
 * Es una lista de PERMITIDAS por exclusión, y el análisis es propio, estricto y total (nunca lanza):
 *  - IPv4: cuatro números decimales canónicos separados por puntos. Octal (`0177.0.0.1`), hexadecimal
 *    (`0x7f.1`), entero (`2130706433`), abreviada (`127.1`), ceros a la izquierda, blancos: no son una
 *    IP para esta función, o sea `false`. Los motores de red las leen de formas distintas; acá no hay
 *    forma de que una dirección interna se disfrace de pública.
 *  - IPv6: solo hexadecimal (una cola `a.b.c.d` no se lee: las únicas que la usan —mapeadas,
 *    compatibles, NAT64— están prohibidas igual) y solo `2000::/3` (unicast global) menos lo
 *    especial que contiene. Todo lo demás es `false`:
 *    `::`, `::1`, mapeadas `::ffff:a.b.c.d` (con cualquier IPv4 adentro), compatibles, NAT64
 *    `64:ff9b::/96`, ULA `fc00::/7`, enlace local `fe80::/10`, multicast `ff00::/8`. Zonas (`%eth0`) y
 *    corchetes no se aceptan.
 *  - Lo que no se puede clasificar con certeza es `false`. Todo es lineal en el largo del texto (sin
 *    expresiones regulares): un texto enorme se rechaza en el primer carácter que no encaja.
 */

const DIGITOS = "0123456789";
const HEXADECIMALES = "0123456789abcdef";

/** Los tres primeros octetos de un rango (el cuarto de todos es 0) → su primera dirección como entero. */
const ip4 = (a: number, b: number, c: number): number => ((a * 256 + b) * 256 + c) * 256;

/** Rangos IPv4 prohibidos: `[primera dirección, bits del prefijo]` (registro de direcciones de uso especial). */
const PROHIBIDAS_V4: readonly (readonly [number, number])[] = [
  [ip4(0, 0, 0), 8], // «esta red», incluye 0.0.0.0
  [ip4(10, 0, 0), 8], // privada
  [ip4(100, 64, 0), 10], // CGNAT
  [ip4(127, 0, 0), 8], // loopback
  [ip4(169, 254, 0), 16], // enlace local, incluida la de metadatos 169.254.169.254
  [ip4(172, 16, 0), 12], // privada
  [ip4(192, 0, 0), 24], // asignaciones del IETF
  [ip4(192, 0, 2), 24], // documentación (TEST-NET-1)
  [ip4(192, 88, 99), 24], // relé 6to4 (en desuso)
  [ip4(192, 168, 0), 16], // privada
  [ip4(198, 18, 0), 15], // pruebas de rendimiento
  [ip4(198, 51, 100), 24], // documentación (TEST-NET-2)
  [ip4(203, 0, 113), 24], // documentación (TEST-NET-3)
  [ip4(224, 0, 0), 4], // multicast
  [ip4(240, 0, 0), 4], // reservada, incluye 255.255.255.255
];

/** Primeras palabras de 16 bits de un prefijo IPv6 → su valor de 128 bits. */
const prefijo6 = (palabras: readonly number[], bits: number): readonly [bigint, number] => [
  palabras.reduce((acc, p, i) => acc | (BigInt(p) << BigInt(112 - 16 * i)), 0n),
  bits,
];

/** Dentro del unicast global (2000::/3), lo especial que no se pide. */
const PROHIBIDAS_V6: readonly (readonly [bigint, number])[] = [
  prefijo6([0x2001], 23), // asignaciones del IETF: Teredo (2001::/32), ORCHID, pruebas, etc.
  prefijo6([0x2001, 0xdb8], 32), // documentación
  prefijo6([0x2002], 16), // 6to4
  prefijo6([0x3fff], 20), // documentación (RFC 9637)
];
const UNICAST_GLOBAL = prefijo6([0x2000], 3);

function enPrefijo6(valor: bigint, [base, bits]: readonly [bigint, number]): boolean {
  const corrimiento = BigInt(128 - bits);
  return valor >> corrimiento === base >> corrimiento;
}

function leerOcteto(texto: string): number | null {
  if (texto.length < 1) return null;
  if (texto.length > 1 && texto.startsWith("0")) return null;
  let valor = 0;
  for (const c of texto) {
    const digito = DIGITOS.indexOf(c);
    if (digito === -1) return null;
    valor = valor * 10 + digito;
  }
  return valor <= 255 ? valor : null;
}

/** Cuatro octetos decimales canónicos → el entero de 32 bits; cualquier otra cosa, `null`. */
function leerIPv4(texto: string): number | null {
  const octetos = texto.split(".");
  if (octetos.length !== 4) return null;
  let valor = 0;
  for (const o of octetos) {
    const octeto = leerOcteto(o);
    if (octeto === null) return null;
    valor = valor * 256 + octeto;
  }
  return valor;
}

function leerPalabra(texto: string): number | null {
  if (texto.length < 1 || texto.length > 4) return null;
  let valor = 0;
  for (const c of texto.toLowerCase()) {
    const digito = HEXADECIMALES.indexOf(c);
    if (digito === -1) return null;
    valor = valor * 16 + digito;
  }
  return valor;
}

/** Los grupos de un lado de `::`: cada uno de 1 a 4 hexadecimales (un `a.b.c.d` no es hexadecimal: `null`). */
function leerLado(lado: string): number[] | null {
  if (lado === "") return [];
  const palabras: number[] = [];
  for (const grupo of lado.split(":")) {
    const palabra = leerPalabra(grupo);
    if (palabra === null) return null;
    palabras.push(palabra);
  }
  return palabras;
}

/** Ocho palabras de 16 bits, con a lo sumo un `::` que reemplaza al menos un grupo; si no, `null`. */
function leerIPv6(texto: string): bigint | null {
  const corte = texto.indexOf("::");
  let palabras: number[];
  if (corte === -1) {
    const todas = leerLado(texto);
    if (todas === null || todas.length !== 8) return null;
    palabras = todas;
  } else {
    const derecha = texto.slice(corte + 2);
    const antes = leerLado(texto.slice(0, corte));
    const despues = derecha.includes("::") ? null : leerLado(derecha);
    if (antes === null || despues === null || antes.length + despues.length > 7) return null;
    palabras = [
      ...antes,
      ...new Array<number>(8 - antes.length - despues.length).fill(0),
      ...despues,
    ];
  }
  return palabras.reduce((acc, p) => (acc << 16n) | BigInt(p), 0n);
}

/**
 * `true` solo si `ip` es una IP literal, en su forma canónica, de una dirección pública alcanzable.
 * Nunca lanza, para cualquier texto.
 */
export function direccionDeRedPermitida(ip: string): boolean {
  if (typeof ip !== "string") return false;
  const v4 = leerIPv4(ip);
  if (v4 !== null) {
    return !PROHIBIDAS_V4.some(
      ([primera, bits]) => v4 >= primera && v4 < primera + 2 ** (32 - bits),
    );
  }
  const v6 = leerIPv6(ip);
  return (
    v6 !== null && enPrefijo6(v6, UNICAST_GLOBAL) && !PROHIBIDAS_V6.some((p) => enPrefijo6(v6, p))
  );
}
