/**
 * La forma de lo que el navegador manda al agregar, corregir, desactivar o reactivar un valor de una lista del sistema. El navegador NO es de confianza: acá se
 * comprueba solo la FORMA (tipos y claves permitidas); el nombre (largo, caracteres, único) y la versión los decide el caso de uso. Lo que no está en la lista
 * se descarta: una clave de más nunca llega al caso. La clave de idempotencia la fija el navegador por intento: esta capa no genera claves.
 */
import { listaDeLaConsola, type ListaDeLaConsola } from "./listas-del-sistema";

export type EntradaDeAgregarValor = Readonly<{
  claveDeIdempotencia: string;
  lista: ListaDeLaConsola;
  nombre: string;
}>;
export type EntradaDeCorregirNombre = Readonly<{
  claveDeIdempotencia: string;
  valorId: string;
  nombre: string;
  versionEsperada: number;
}>;
export type EntradaDeCambiarEstado = Readonly<{
  claveDeIdempotencia: string;
  valorId: string;
  versionEsperada: number;
}>;

type Forma<T> = { ok: true; valor: T } | { ok: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const esRegistro = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);
const esUuid = (valor: unknown): valor is string => typeof valor === "string" && UUID.test(valor);
const esVersion = (valor: unknown): valor is number =>
  Number.isSafeInteger(valor) && (valor as number) >= 1;

export function entradaDeAgregarValor(entrada: unknown): Forma<EntradaDeAgregarValor> {
  if (!esRegistro(entrada)) return { ok: false };
  const lista = listaDeLaConsola(entrada["lista"]);
  const { claveDeIdempotencia, nombre } = entrada;
  if (lista === null || !esUuid(claveDeIdempotencia) || typeof nombre !== "string") {
    return { ok: false };
  }
  return { ok: true, valor: { claveDeIdempotencia, lista, nombre } };
}

export function entradaDeCorregirNombre(entrada: unknown): Forma<EntradaDeCorregirNombre> {
  if (!esRegistro(entrada)) return { ok: false };
  const { claveDeIdempotencia, valorId, nombre, versionEsperada } = entrada;
  if (
    !esUuid(claveDeIdempotencia) ||
    !esUuid(valorId) ||
    typeof nombre !== "string" ||
    !esVersion(versionEsperada)
  ) {
    return { ok: false };
  }
  return { ok: true, valor: { claveDeIdempotencia, valorId, nombre, versionEsperada } };
}

export function entradaDeCambiarEstado(entrada: unknown): Forma<EntradaDeCambiarEstado> {
  if (!esRegistro(entrada)) return { ok: false };
  const { claveDeIdempotencia, valorId, versionEsperada } = entrada;
  if (!esUuid(claveDeIdempotencia) || !esUuid(valorId) || !esVersion(versionEsperada)) {
    return { ok: false };
  }
  return { ok: true, valor: { claveDeIdempotencia, valorId, versionEsperada } };
}
