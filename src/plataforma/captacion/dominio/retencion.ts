import { esTerminal, type EstadoDeSolicitud } from "./estados";

/**
 * Cuánto vive cada dato de la solicitud (alta por solicitud §2.3 y §2.4). Dominio puro: la hora entra
 * como dato. Los plazos están en un solo lugar y las consultas de los barridos usan el MISMO criterio
 * (`>=`, inclusivo, como `altaVencida`).
 *
 * NO VERIFICADO contra la Ley 25.326: los plazos los revisa el asesor (B3). Cambiarlos es cambiar una
 * constante; la unicidad parcial y las transiciones no dependen de ellos.
 */

const DIA_EN_MS = 86_400_000;

/**
 * Una solicitud sin verificar vence a los 7 días: un correo sin verificar puede ser de otra persona que
 * nunca consintió (alguien tipeó su dirección), así que no se retiene.
 */
export const PLAZO_PARA_VERIFICAR_EN_MS = 7 * DIA_EN_MS;

/**
 * Las cerradas (`ALTA_CREADA`, `RECHAZADA`, `SPAM`) se anonimizan 90 días después de decididas. Es
 * también cuánto dura el bloqueo silencioso de un correo marcado spam: cuando la fila se anonimiza, el
 * correo deja de estar y el bloqueo termina con ella (una sola cifra, no dos que puedan separarse).
 */
export const RETENCION_DE_CERRADAS_EN_MS = 90 * DIA_EN_MS;

/**
 * ¿Venció sin verificar? Solo una `NUEVA`, contando desde que se recibió (reenviar el correo no
 * extiende el plazo) y EN el instante exacto de los 7 días.
 */
export function vencidaSinVerificar(
  solicitud: Readonly<{ estado: EstadoDeSolicitud; creadaEn: Date }>,
  ahora: Date,
): boolean {
  return (
    solicitud.estado === "NUEVA" &&
    ahora.getTime() - solicitud.creadaEn.getTime() >= PLAZO_PARA_VERIFICAR_EN_MS
  );
}

/**
 * ¿Toca anonimizarla? Una cerrada que todavía conserva sus datos personales y cuya decisión tiene 90
 * días o más. Una abierta nunca se anonimiza (su plazo es el de la decisión de la persona que la revisa).
 */
export function debeAnonimizarse(
  solicitud: Readonly<{
    estado: EstadoDeSolicitud;
    decididaEn: Date | null;
    anonimizadaEn: Date | null;
  }>,
  ahora: Date,
): boolean {
  return (
    esTerminal(solicitud.estado) &&
    solicitud.anonimizadaEn === null &&
    solicitud.decididaEn !== null &&
    ahora.getTime() - solicitud.decididaEn.getTime() >= RETENCION_DE_CERRADAS_EN_MS
  );
}
