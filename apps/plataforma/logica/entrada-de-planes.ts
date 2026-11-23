/**
 * Forma de lo que manda el navegador al crear un plan, guardar un borrador o publicar una versión. Puro y sin librerías: solo la FORMA (tipos, tamaños y claves permitidas);
 * las reglas de negocio las valida el caso de uso. Las claves que sobran se descartan sin copiarse. Lo que la lista de permitidos no nombra, no pasa.
 */
import { LARGO_MAXIMO_DEL_NOMBRE_DE_PLAN } from "../../../src/capacidades/planes/version-de-plan";
import { LARGO_MAXIMO_DEL_MOTIVO } from "./entrada-del-plan";

export type EntradaDeCrearPlan = Readonly<{ claveDeIdempotencia: string; codigo: string }>;
export type EntradaDeGuardarBorrador = Readonly<{
  claveDeIdempotencia: string;
  planId: string;
  versionEsperada: number | null;
  nombreComercial: string;
  modulos: readonly string[];
  perillas: Readonly<Record<string, unknown>>;
}>;
export type EntradaDePublicar = Readonly<{
  claveDeIdempotencia: string;
  planId: string;
  motivo: string;
}>;

type Forma<T> = { ok: true; valor: T } | { ok: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Hasta cuántos módulos y perillas acepta la forma: el catálogo real es mucho menor; el tope corta un pedido absurdo. */
const MAXIMO_DE_CLAVES = 200;
const LARGO_MAXIMO_DE_CLAVE = 64;

const esRegistro = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const esUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const esTextoDeHasta = (v: unknown, largo: number): v is string =>
  typeof v === "string" && [...v].length <= largo;

export function entradaDeCrearPlan(entrada: unknown): Forma<EntradaDeCrearPlan> {
  if (!esRegistro(entrada)) return { ok: false };
  const { claveDeIdempotencia, codigo } = entrada;
  if (!esUuid(claveDeIdempotencia) || !esTextoDeHasta(codigo, LARGO_MAXIMO_DE_CLAVE))
    return { ok: false };
  return { ok: true, valor: { claveDeIdempotencia, codigo: codigo.trim() } };
}

export function entradaDePublicar(entrada: unknown): Forma<EntradaDePublicar> {
  if (!esRegistro(entrada)) return { ok: false };
  const { claveDeIdempotencia, planId, motivo } = entrada;
  if (!esUuid(claveDeIdempotencia) || !esUuid(planId) || typeof motivo !== "string")
    return { ok: false };
  const recortado = motivo.trim();
  if (recortado.length < 1 || recortado.length > LARGO_MAXIMO_DEL_MOTIVO) return { ok: false };
  return { ok: true, valor: { claveDeIdempotencia, planId, motivo: recortado } };
}

const esValorDePerilla = (v: unknown): boolean => {
  if (!esRegistro(v)) return false;
  if (v["tipo"] === "INTERRUPTOR") return typeof v["encendida"] === "boolean";
  if (v["tipo"] !== "LIMITE") return false;
  const l = v["limite"];
  return l === "ILIMITADO" || (typeof l === "number" && Number.isInteger(l) && l >= 0);
};

export function entradaDeGuardarBorrador(entrada: unknown): Forma<EntradaDeGuardarBorrador> {
  if (!esRegistro(entrada)) return { ok: false };
  const { claveDeIdempotencia, planId, versionEsperada, nombreComercial, modulos, perillas } =
    entrada;
  if (!esUuid(claveDeIdempotencia) || !esUuid(planId)) return { ok: false };
  if (
    versionEsperada !== null &&
    !(
      typeof versionEsperada === "number" &&
      Number.isInteger(versionEsperada) &&
      versionEsperada >= 1
    )
  ) {
    return { ok: false };
  }
  // El tope del nombre es el del dominio (el servidor vuelve a validarlo); acá solo se corta lo absurdo.
  if (!esTextoDeHasta(nombreComercial, LARGO_MAXIMO_DEL_NOMBRE_DE_PLAN * 4)) return { ok: false };
  if (!Array.isArray(modulos) || modulos.length > MAXIMO_DE_CLAVES) return { ok: false };
  const claves: string[] = [];
  for (const m of modulos as unknown[]) {
    if (!esTextoDeHasta(m, LARGO_MAXIMO_DE_CLAVE)) return { ok: false };
    claves.push(m);
  }
  if (!esRegistro(perillas)) return { ok: false };
  const entradas = Object.entries(perillas);
  if (entradas.length > MAXIMO_DE_CLAVES) return { ok: false };
  const limpias: Record<string, unknown> = {};
  for (const [clave, valor] of entradas) {
    if (!esTextoDeHasta(clave, LARGO_MAXIMO_DE_CLAVE) || !esValorDePerilla(valor))
      return { ok: false };
    limpias[clave] = valor;
  }
  return {
    ok: true,
    valor: {
      claveDeIdempotencia,
      planId,
      versionEsperada,
      nombreComercial,
      modulos: claves,
      perillas: limpias,
    },
  };
}
