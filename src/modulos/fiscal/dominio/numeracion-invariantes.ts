import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Serie } from "./numeracion-modelo";

/**
 * Invariantes de una serie de comprobantes (spec H7 §B.8): coherencia interna, validez de una transición y
 * verificación de la secuencia de números. Puros, sin estado: el disparador y las restricciones `CHECK` de la
 * base imponen lo mismo y un test compara ambos. Viven aparte de `numeracion.ts` (que las re-exporta, así que
 * quien importa no cambia) para que cada archivo tenga una sola razón de cambio: las operaciones sobre la serie
 * por un lado, las reglas que dicen qué estados son válidos por otro.
 */

/**
 * Coherencia interna de una serie (las restricciones `CHECK` de la tabla): el último número no es
 * negativo, la reserva es exactamente el siguiente número y trae solicitud, y el bloqueo trae motivo.
 */
export function serieEsConsistente(serie: Serie): boolean {
  if (serie.ultimoNumero < 0n) return false;
  if (serie.estado === "EN_CURSO") {
    return (
      serie.numeroEnCurso === serie.ultimoNumero + 1n &&
      serie.solicitud.trim() !== "" &&
      !Number.isNaN(serie.enCursoHasta.getTime())
    );
  }
  return serie.estado === "BLOQUEADA" ? serie.motivoBloqueo.trim() !== "" : true;
}

/**
 * ¿Es válido pasar de `antes` a `despues`? Es la regla del disparador de la base, escrita como
 * función (coincide con `TRANSICIONES_DE_SERIE`, más quedarse en el mismo estado sin cambios): la
 * identidad (con el ambiente) no cambia; `ultimoNumero` nunca baja y solo sube de a uno, cerrando una
 * `EN_CURSO` con su número, o saltando al resincronizar una `BLOQUEADA`; `LIBRE` solo pasa a `EN_CURSO`
 * (con el siguiente número); `EN_CURSO` a `LIBRE` (liberada o autorizada) o a `BLOQUEADA` (sin
 * avanzar), o se queda igual; `BLOQUEADA` solo sale hacia `LIBRE` (sin bajar el último número) o se
 * queda igual. Un cambio de `version` no cuenta (lo fija la base).
 */
export function transicionDeSerieValida(antes: Serie, despues: Serie): boolean {
  if (
    antes.empresaId !== despues.empresaId ||
    antes.puntoDeVentaId !== despues.puntoDeVentaId ||
    antes.emisorId !== despues.emisorId ||
    antes.ambiente !== despues.ambiente ||
    antes.tipo !== despues.tipo
  ) {
    return false;
  }
  if (!serieEsConsistente(despues)) return false;
  switch (antes.estado) {
    case "LIBRE":
      // Se queda libre o pasa a en curso, sin tocar el último número.
      return despues.estado !== "BLOQUEADA" && despues.ultimoNumero === antes.ultimoNumero;
    case "EN_CURSO":
      if (despues.estado === "LIBRE") {
        // Liberada (sin avanzar) o cerrada como autorizada (avanza exactamente al número reservado).
        return (
          despues.ultimoNumero === antes.ultimoNumero ||
          despues.ultimoNumero === antes.numeroEnCurso
        );
      }
      if (despues.estado === "EN_CURSO") {
        return (
          despues.ultimoNumero === antes.ultimoNumero &&
          despues.solicitud === antes.solicitud &&
          despues.enCursoHasta.getTime() === antes.enCursoHasta.getTime()
        );
      }
      return despues.ultimoNumero === antes.ultimoNumero; // bloqueada: no avanza
    case "BLOQUEADA":
      if (despues.estado === "LIBRE") return despues.ultimoNumero >= antes.ultimoNumero;
      return (
        despues.estado === "BLOQUEADA" &&
        despues.ultimoNumero === antes.ultimoNumero &&
        despues.motivoBloqueo === antes.motivoBloqueo
      );
  }
}

export type ErrorDeSecuencia = "NUMERO_DUPLICADO" | "NUMERO_SALTEADO";

/**
 * Verifica que los números autorizados (en cualquier orden) sean exactamente
 * `ultimoInicial + 1 … ultimoInicial + n`: sin repetidos y sin huecos. Devuelve el último número.
 * Sirve de auditoría de una serie y de oráculo de las pruebas de concurrencia.
 */
export function verificarSecuencia(
  ultimoInicial: bigint,
  autorizados: readonly bigint[],
): Resultado<bigint, ErrorDeSecuencia> {
  const ordenados = [...autorizados].sort((a, b) => Number(a - b));
  let ultimo = ultimoInicial;
  for (const numero of ordenados) {
    if (numero <= ultimo) return err("NUMERO_DUPLICADO");
    if (numero > ultimo + 1n) return err("NUMERO_SALTEADO");
    ultimo = numero;
  }
  return ok(ultimo);
}
