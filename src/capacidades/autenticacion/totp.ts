import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * El código TOTP del segundo factor (RFC 6238 sobre RFC 4226: HMAC-SHA1, 6 cifras, pasos de 30 segundos), solo la parte
 * que la librería de ingreso no entrega: QUÉ paso del reloj coincidió con el código. Sin ese número no se puede
 * impedir que un mismo código se use dos veces (G2 del ADR-013): la librería solo contesta sí o no. La librería sigue
 * siendo quien decide en última instancia (vuelve a verificar el código); esto es lo que se compara ANTES para
 * registrar el paso usado. Una prueba de integración comprueba que los dos dan el mismo código para el mismo secreto.
 *
 * La clave del HMAC son los bytes UTF-8 del texto del secreto, igual que hace la librería (y la aplicación
 * autenticadora decodifica el base32 de la dirección `otpauth` a esos mismos bytes).
 */

export const PERIODO_DE_TOTP_EN_SEGUNDOS = 30;
export const CIFRAS_DEL_CODIGO_DE_TOTP = 6;
export const FORMA_DEL_CODIGO_DE_TOTP = /^\d{6}$/;

/** El número de paso del instante dado (los segundos desde 1970 divididos por el período, hacia abajo). */
export function pasoDeTotp(instante: Date): number {
  return Math.floor(instante.getTime() / 1000 / PERIODO_DE_TOTP_EN_SEGUNDOS);
}

/** El código de 6 cifras de ese secreto en ese paso (RFC 4226, truncamiento dinámico). */
export function codigoDeTotp(secreto: string, paso: number): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));
  const huella = createHmac("sha1", secreto).update(contador).digest();
  const desplazamiento = (huella[huella.length - 1] as number) & 0x0f;
  const truncado =
    (((huella[desplazamiento] as number) & 0x7f) << 24) |
    (((huella[desplazamiento + 1] as number) & 0xff) << 16) |
    (((huella[desplazamiento + 2] as number) & 0xff) << 8) |
    ((huella[desplazamiento + 3] as number) & 0xff);
  return String(truncado % 10 ** CIFRAS_DEL_CODIGO_DE_TOTP).padStart(
    CIFRAS_DEL_CODIGO_DE_TOTP,
    "0",
  );
}

/** Comparación en tiempo constante de dos textos del MISMO largo (acá, siempre de 6 cifras): con otro largo lanza. */
function iguales(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * El paso en que ese código vale para ese secreto, o `null`. Mira el paso actual y uno a cada lado (la deriva del reloj del teléfono: la misma ventana que la librería) y devuelve
 * el primero que coincide en el orden actual, anterior, siguiente. Un código que no tiene la forma (6 cifras) no
 * coincide con nada. Se recorren siempre los tres pasos y la comparación no corta en la primera cifra distinta.
 */
export function pasoDelCodigo(secreto: string, codigo: string, ahora: Date): number | null {
  if (!FORMA_DEL_CODIGO_DE_TOTP.test(codigo)) return null;
  const actual = pasoDeTotp(ahora);
  let coincidencia: number | null = null;
  for (const desvio of [0, -1, 1]) {
    const paso = actual + desvio;
    if (iguales(codigoDeTotp(secreto, paso), codigo) && coincidencia === null) coincidencia = paso;
  }
  return coincidencia;
}
