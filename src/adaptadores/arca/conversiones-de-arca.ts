import { importeDesdeTexto, type Importe } from "../../primitivas/dinero/importe";
import { ARS } from "../../primitivas/dinero/moneda";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../primitivas/tiempo/fecha-civil";

/**
 * Conversiones de lo que ARCA manda como texto (fechas `yyyymmdd`, importes, códigos numéricos, el CAE) a
 * valores del dominio. Puras; las usa la clasificación de las respuestas (`clasificar.ts`).
 */

/** `yyyymmdd` (como lo manda ARCA) a fecha civil, o `null` si no es una fecha real. */
export function fechaDeArca(texto: string): FechaCivil | null {
  const partes = /^([0-9]{4})([0-9]{2})([0-9]{2})$/.exec(texto);
  if (partes === null) return null;
  const fecha = fechaCivilDesdeTexto(`${partes[1]}-${partes[2]}-${partes[3]}`);
  return fecha.ok ? fecha.valor : null;
}

/**
 * Un importe de ARCA (`231.5`, `0`, `100`, `10.50`) a `Importe` en pesos, o `null` si no es un decimal no
 * negativo con a lo sumo dos decimales significativos. Nunca pasa por `number`. Los ceros de más
 * (`10.500`) se descartan: no cambian el valor.
 */
export function importeDeArca(texto: string): Importe | null {
  const partes = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(texto);
  if (partes === null) return null;
  const decimales = (partes[2] ?? "").replace(/0+$/, "");
  if (decimales.length > 2) return null;
  return importeDesdeTexto(ARS, decimales === "" ? `${partes[1]}` : `${partes[1]}.${decimales}`);
}

/** Un entero sin signo de hasta `digitos` dígitos como `bigint`, o `null`. */
export function enteroDeArca(texto: string, digitos: number): bigint | null {
  return new RegExp(`^[0-9]{1,${digitos}}$`).test(texto) ? BigInt(texto) : null;
}

/** Un código de ARCA (tipo, punto de venta, documento) como `number`: nunca es un importe. */
export function codigoDeArca(texto: string, digitos: number): number | null {
  const entero = enteroDeArca(texto, digitos);
  return entero === null ? null : Number(entero);
}

/** El CAE: 14 dígitos, como TEXTO (puede empezar con 0), como lo exige `comprobante_autorizado_ck`. */
export const FORMA_DEL_CAE = /^[0-9]{14}$/;
