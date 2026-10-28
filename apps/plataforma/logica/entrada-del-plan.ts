/**
 * Forma de lo que manda el navegador al cambiar el plan de una empresa. Puro y sin librerías: solo la
 * FORMA; las reglas de negocio las valida el backend. Las claves que sobran se descartan sin copiarse.
 */
import { instanteDeVigencia } from "./vigencia";

export type EntradaDelCambioDePlan = Readonly<{
  claveDeIdempotencia: string;
  tenantId: string;
  versionDePlanId: string;
  vigenteDesde: string;
  motivo: string;
  numeroEsperado: number | null;
  reemplazaProgramada: boolean;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Espejo de `LARGO_MAXIMO_DEL_MOTIVO` del backend (`formas-de-entrada.ts`); una prueba los compara. */
export const LARGO_MAXIMO_DEL_MOTIVO = 500;

const esRegistro = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

const esUuid = (valor: unknown): valor is string => typeof valor === "string" && UUID.test(valor);

export function entradaDelCambioDePlan(
  entrada: unknown,
): { ok: true; valor: EntradaDelCambioDePlan } | { ok: false } {
  if (!esRegistro(entrada)) return { ok: false };
  const { claveDeIdempotencia, tenantId, versionDePlanId, vigenteDesde, motivo } = entrada;
  const { numeroEsperado, reemplazaProgramada } = entrada;
  if (!esUuid(claveDeIdempotencia) || !esUuid(tenantId) || !esUuid(versionDePlanId)) {
    return { ok: false };
  }
  if (typeof vigenteDesde !== "string" || instanteDeVigencia(vigenteDesde) === null) {
    return { ok: false };
  }
  if (typeof motivo !== "string") return { ok: false };
  const motivoRecortado = motivo.trim();
  if (motivoRecortado.length < 1 || motivoRecortado.length > LARGO_MAXIMO_DEL_MOTIVO) {
    return { ok: false };
  }
  if (
    numeroEsperado !== null &&
    !(typeof numeroEsperado === "number" && Number.isInteger(numeroEsperado) && numeroEsperado >= 1)
  ) {
    return { ok: false };
  }
  if (typeof reemplazaProgramada !== "boolean") return { ok: false };
  return {
    ok: true,
    valor: {
      claveDeIdempotencia,
      tenantId,
      versionDePlanId,
      vigenteDesde,
      motivo: motivoRecortado,
      numeroEsperado,
      reemplazaProgramada,
    },
  };
}
