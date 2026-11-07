import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { empiezaCon, cuatroCaracteres, FIRMA_PNG, vistaDe } from "./bytes-de-imagen";
import type { CabeceraPng, ErrorDeCabecera } from "./tipos-de-cabecera";

// --- PNG --------------------------------------------------------------------------------------------

/** Profundidades de bit que el estándar permite para cada tipo de color. */
const PROFUNDIDADES_DE_PNG: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

/** Mayor medida que el estándar de PNG permite (2^31 - 1). */
const MEDIDA_MAXIMA_DE_PNG = 0x7fffffff;

/**
 * Lee el IHDR y recorre los fragmentos hasta IEND (cada uno entero dentro de los bytes): así un PNG
 * cortado se rechaza como `TRUNCADO` y se ve si hay `tRNS` (transparencia por color) o `acTL`
 * (animación). No verifica los CRC ni descomprime nada.
 */
export function leerPng(bytes: Uint8Array): Resultado<CabeceraPng, ErrorDeCabecera> {
  if (!empiezaCon(bytes, 0, FIRMA_PNG)) return err("FORMATO_NO_RECONOCIDO");
  // 8 de firma + largo (4) + tipo (4) + los 13 bytes de datos del IHDR, hasta el entrelazado.
  if (bytes.length < 29) return err("TRUNCADO");
  const v = vistaDe(bytes);
  if (v.getUint32(8) !== 13 || cuatroCaracteres(bytes, 12) !== "IHDR") {
    return err("CABECERA_INVALIDA");
  }
  const ancho = v.getUint32(16);
  const alto = v.getUint32(20);
  const profundidad = v.getUint8(24);
  const tipoDeColor = v.getUint8(25);
  const entrelazado = v.getUint8(28);
  if (ancho === 0 || alto === 0 || ancho > MEDIDA_MAXIMA_DE_PNG || alto > MEDIDA_MAXIMA_DE_PNG) {
    return err("CABECERA_INVALIDA");
  }
  const profundidades = PROFUNDIDADES_DE_PNG[tipoDeColor];
  if (
    profundidades === undefined ||
    !profundidades.includes(profundidad) ||
    v.getUint8(26) !== 0 || // compresión
    v.getUint8(27) !== 0 || // filtro
    entrelazado > 1
  ) {
    return err("CABECERA_INVALIDA");
  }

  let conTrns = false;
  let animado = false;
  let hayDatos = false;
  let pos = 33;
  for (;;) {
    if (pos + 12 > bytes.length) return err("TRUNCADO");
    const tipo = cuatroCaracteres(bytes, pos + 4);
    const siguiente = pos + 12 + v.getUint32(pos);
    if (siguiente > bytes.length) return err("TRUNCADO");
    if (tipo === "IEND") break;
    if (tipo === "IDAT") hayDatos = true;
    if (tipo === "tRNS") conTrns = true;
    if (tipo === "acTL") animado = true;
    pos = siguiente;
  }
  if (!hayDatos) return err("CABECERA_INVALIDA");
  return ok({ formato: "png", ancho, alto, tipoDeColor, conTrns, animado });
}

/**
 * ¿Un PNG es opaco para el apple-touch? Solo los tipos de color 0 (grises) y 2 (RGB) sin `tRNS`
 * (decisión de [02] §2.4: «tipo de color 0 o 2»; la paleta se rechaza aunque no declare alfa).
 */
export const pngEsOpaco = (cabecera: CabeceraPng): boolean =>
  (cabecera.tipoDeColor === 0 || cabecera.tipoDeColor === 2) && !cabecera.conTrns;
