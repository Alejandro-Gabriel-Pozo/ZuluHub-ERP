import { dibujoDeQr, type DibujoDeQr } from "./qr-seguro";

/**
 * La respuesta de `two-factor/enable` (h5-p8 §6): `{ qrSvg, secreto, codigosDeRecuperacion[10] }`. Se valida su forma
 * antes de mostrar nada: lo que no cumple da `null` y la pantalla dice el texto neutro, sin dibujar ni mostrar un
 * secreto que no tiene la forma de uno. El dibujo del QR puede faltar (`dibujo: null`): queda la clave en texto.
 */

export type DatosDelAlta = Readonly<{
  dibujo: DibujoDeQr | null;
  secreto: string;
  codigosDeRecuperacion: readonly string[];
}>;

const SECRETO = /^[A-Z2-7]{16,128}$/;
const CODIGO_DE_RECUPERACION = /^[a-z0-9]{5}-[a-z0-9]{5}$/;
const CANTIDAD_DE_CODIGOS = 10;

export function datosDelAlta(cuerpo: unknown): DatosDelAlta | null {
  if (typeof cuerpo !== "object" || cuerpo === null) return null;
  const { qrSvg, secreto, codigosDeRecuperacion } = cuerpo as Record<string, unknown>;
  if (typeof secreto !== "string" || !SECRETO.test(secreto)) return null;
  if (
    !Array.isArray(codigosDeRecuperacion) ||
    codigosDeRecuperacion.length !== CANTIDAD_DE_CODIGOS ||
    !codigosDeRecuperacion.every((c) => typeof c === "string" && CODIGO_DE_RECUPERACION.test(c))
  ) {
    return null;
  }
  return {
    dibujo: typeof qrSvg === "string" ? dibujoDeQr(qrSvg) : null,
    secreto,
    codigosDeRecuperacion: codigosDeRecuperacion as readonly string[],
  };
}

/** La clave en grupos de cuatro, para copiarla a mano sin perderse. */
export const secretoEnGrupos = (secreto: string): string =>
  (secreto.match(/.{1,4}/g) ?? []).join(" ");
