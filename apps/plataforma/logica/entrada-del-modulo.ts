/**
 * Forma de lo que manda el navegador al activar o desactivar un módulo de una empresa. Puro y sin librerías: solo
 * la FORMA, con lista de permitidos (el módulo tiene que ser una clave del catálogo); las reglas de negocio las
 * decide el caso de uso. Las claves que sobran se descartan sin copiarse.
 */
import { CATALOGO_DE_MODULOS } from "../../../src/capacidades/modulos/catalogo";

export type EntradaDelCambioDeModulo = Readonly<{
  claveDeIdempotencia: string;
  empresaId: string;
  modulo: string;
  /** `true` activa, `false` desactiva. */
  activar: boolean;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const esRegistro = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

const esUuid = (valor: unknown): valor is string => typeof valor === "string" && UUID.test(valor);

const esModuloDelCatalogo = (valor: unknown): valor is string =>
  typeof valor === "string" && Object.hasOwn(CATALOGO_DE_MODULOS, valor);

export function entradaDelCambioDeModulo(
  entrada: unknown,
): { ok: true; valor: EntradaDelCambioDeModulo } | { ok: false } {
  if (!esRegistro(entrada)) return { ok: false };
  const { claveDeIdempotencia, empresaId, modulo, activar } = entrada;
  if (!esUuid(claveDeIdempotencia) || !esUuid(empresaId)) return { ok: false };
  if (!esModuloDelCatalogo(modulo)) return { ok: false };
  if (typeof activar !== "boolean") return { ok: false };
  return { ok: true, valor: { claveDeIdempotencia, empresaId, modulo, activar } };
}
