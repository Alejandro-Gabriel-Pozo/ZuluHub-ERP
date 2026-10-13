import { BlockList, isIPv4, isIPv6 } from "node:net";

/**
 * Oráculo INDEPENDIENTE de la guarda de red (`direccionDeRedPermitida`): su propia lista de rangos
 * prohibidos (S2), aritmética propia de límites y la pertenencia a rangos de `net.BlockList` de Node (otra
 * implementación, solo aritmética: no abre sockets ni resuelve nombres). Lo usan las pruebas de ejemplos y
 * de propiedades; si la implementación y esto discrepan, uno de los dos está mal.
 */

/** Rangos IPv4 prohibidos, como los lista el registro de direcciones de uso especial. */
export const RANGOS_V4_PROHIBIDOS: readonly string[] = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

/** Lo especial DENTRO de 2000::/3 (fuera de 2000::/3 no se permite nada). */
export const RANGOS_V6_ESPECIALES_EN_UNICAST: readonly string[] = [
  "2001::/23",
  "2001:db8::/32",
  "2002::/16",
  "3fff::/20",
];

/** Rangos IPv6 que el spec nombra y que caen FUERA de 2000::/3 (siempre prohibidos). */
export const RANGOS_V6_FUERA_DE_UNICAST: readonly string[] = [
  "::/128",
  "::1/128",
  "::/96",
  "::ffff:0:0/96",
  "64:ff9b::/96",
  "64:ff9b:1::/48",
  "100::/64",
  "fc00::/7",
  "fe80::/10",
  "fec0::/10",
  "ff00::/8",
];

export function ipv4ANumero(ip: string): number {
  return ip.split(".").reduce((acc, o) => acc * 256 + Number(o), 0);
}

export function numeroAIpv4(n: number): string {
  return [n / 2 ** 24, (n / 2 ** 16) % 256, (n / 256) % 256, n % 256]
    .map((o) => String(Math.floor(o)))
    .join(".");
}

/** Primera y última dirección de un CIDR IPv4. */
export function limitesV4(cidr: string): { primera: number; ultima: number } {
  const [base = "", bits = ""] = cidr.split("/");
  const primera = ipv4ANumero(base);
  return { primera, ultima: primera + 2 ** (32 - Number(bits)) - 1 };
}

/** Las 8 palabras de 16 bits de una IPv6 CANÓNICA o ya expandida (solo para armar casos). */
export function ipv6ABigint(ip: string): bigint {
  const [izq = "", der] = ip.split("::");
  const lado = (t: string): bigint[] => (t === "" ? [] : t.split(":").map((p) => BigInt(`0x${p}`)));
  const antes = lado(izq);
  const despues = der === undefined ? [] : lado(der);
  const ceros = Array.from({ length: 8 - antes.length - despues.length }, () => 0n);
  return [...antes, ...ceros, ...despues].reduce((acc, p) => (acc << 16n) | p, 0n);
}

export function bigintAIpv6(n: bigint): string {
  return Array.from({ length: 8 }, (_, i) =>
    ((n >> BigInt(112 - 16 * i)) & 0xffffn).toString(16),
  ).join(":");
}

export function limitesV6(cidr: string): { primera: bigint; ultima: bigint } {
  const [base = "", bits = ""] = cidr.split("/");
  const tamano = 1n << BigInt(128 - Number(bits));
  const primera = ipv6ABigint(base);
  return { primera, ultima: primera + tamano - 1n };
}

const prohibidasV4 = new BlockList();
for (const c of RANGOS_V4_PROHIBIDOS) {
  const [base = "", bits = ""] = c.split("/");
  prohibidasV4.addSubnet(base, Number(bits), "ipv4");
}
const especialesV6 = new BlockList();
for (const c of RANGOS_V6_ESPECIALES_EN_UNICAST) {
  const [base = "", bits = ""] = c.split("/");
  especialesV6.addSubnet(base, Number(bits), "ipv6");
}
const unicastGlobal = new BlockList();
unicastGlobal.addSubnet("2000::", 3, "ipv6");

/**
 * ¿Debería permitirse? Verdad para IPv4 canónica pública y para IPv6 de 2000::/3 sin lo especial; falso
 * para todo lo demás (incluido todo texto que no sea una IP canónica sin zona).
 */
export function oraculoPermitida(ip: string): boolean {
  if (isIPv4(ip)) return !prohibidasV4.check(ip, "ipv4");
  if (isIPv6(ip) && !ip.includes("%")) {
    return unicastGlobal.check(ip, "ipv6") && !especialesV6.check(ip, "ipv6");
  }
  return false;
}

/** Todas las formas de escribir una IPv4 que NO son la canónica y que un motor de red podría leer. */
export function escrituraEquivalenteV4(n: number): string[] {
  const o = numeroAIpv4(n).split(".").map(Number) as [number, number, number, number];
  const [a, b, c, d] = o;
  const hex = (x: number): string => x.toString(16);
  return [
    o.map((x) => String(x).padStart(3, "0")).join("."),
    o.map((x) => `0${x.toString(8)}`).join("."),
    o.map((x) => `0x${hex(x)}`).join("."),
    o.map((x) => `0X${hex(x).toUpperCase()}`).join("."),
    String(n),
    `0x${hex(n)}`,
    `0${n.toString(8)}`,
    `${a}.${(b * 256 + c) * 256 + d}`,
    `${a}.${b}.${c * 256 + d}`,
    `0x${hex(a)}.${(b * 256 + c) * 256 + d}`,
    ` ${numeroAIpv4(n)}`,
    `${numeroAIpv4(n)} `,
    `${numeroAIpv4(n)}.`,
    `${numeroAIpv4(n)}\n`,
    `${numeroAIpv4(n)}%eth0`,
    `[${numeroAIpv4(n)}]`,
  ].filter((forma) => forma !== numeroAIpv4(n));
}

/** IPv6 que llevan adentro una IPv4: mapeada, compatible, NAT64, 6to4 y Teredo, en varias grafías. */
export function ipv6ConIpv4Adentro(n: number): string[] {
  const alta = Math.floor(n / 65536).toString(16);
  const baja = (n % 65536).toString(16);
  const punteada = numeroAIpv4(n);
  const invertida = (n ^ 0xffffffff) >>> 0;
  const teredo = `2001:0:4136:e378:8000:63bf:${Math.floor(invertida / 65536).toString(16)}:${(invertida % 65536).toString(16)}`;
  const formas = [
    `::ffff:${punteada}`,
    `::FFFF:${punteada}`,
    `::ffff:${alta}:${baja}`,
    `0:0:0:0:0:ffff:${punteada}`,
    `0000:0000:0000:0000:0000:ffff:${alta}:${baja}`,
    `::${punteada}`,
    `::${alta}:${baja}`,
    `64:ff9b::${punteada}`,
    `64:ff9b::${alta}:${baja}`,
    `64:ff9b:1::${alta}:${baja}`,
    `2002:${alta}:${baja}::`,
    `2002:${alta}:${baja}:1::1`,
    teredo,
  ];
  return [
    ...formas,
    ...formas.map((f) => `[${f}]`),
    ...formas.map((f) => `${f}%eth0`),
    ...formas.map((f) => f.toUpperCase()),
  ];
}
