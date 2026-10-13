import { RETENCION_DE_CERRADAS_EN_MS } from "./retencion";

/**
 * Qué hace un envío del formulario cuando ya hay (o hubo) una solicitud con ese correo en esa marca
 * (alta por solicitud §2.3 y §3.3 paso 3). Dominio puro: la hora entra como dato.
 *
 * Los cuatro caminos (`CREAR`, `REENVIAR`, `NADA` por cualquier motivo) dan la MISMA respuesta al
 * interesado: nadie puede saber, mirando la pantalla, si ese correo ya pidió. El motivo de `NADA` es
 * para el tablero («cuántos envíos descartó cada capa»), nunca para mostrar.
 */

/** Espera mínima entre dos correos de verificación de la misma solicitud. */
export const ESPERA_ENTRE_ENVIOS_EN_MS = 2 * 60_000;

/** Tope de correos de verificación por solicitud (`solicitud_envios_ck` lo repite en la base). */
export const MAXIMO_DE_ENVIOS = 5;

/** La solicitud abierta (a lo sumo una por correo y marca). */
export type SolicitudAbierta = Readonly<{
  estado: "NUEVA" | "VERIFICADA" | "APROBADA";
  numeroDeEnvios: number;
  ultimoEnvioEn: Date;
}>;

/** La última solicitud cerrada del mismo correo y marca, con la fecha en que se decidió. */
export type UltimaCerrada = Readonly<{
  estado: "ALTA_CREADA" | "RECHAZADA" | "SPAM";
  decididaEn: Date;
}>;

export type MotivoDeNada = "YA_ABIERTA" | "ENVIO_RECIENTE" | "TOPE_DE_ENVIOS" | "SPAM_RECIENTE";

export type DecisionDeEnvio =
  | Readonly<{ tipo: "CREAR" }>
  | Readonly<{ tipo: "REENVIAR"; numero: number }>
  | Readonly<{ tipo: "NADA"; motivo: MotivoDeNada }>;

export function decidirEnvio(
  abierta: SolicitudAbierta | null,
  ultimaCerrada: UltimaCerrada | null,
  ahora: Date,
): DecisionDeEnvio {
  if (abierta !== null) {
    // Verificada o aprobada: el correo ya está confirmado, no hay nada que reenviar.
    if (abierta.estado !== "NUEVA") return { tipo: "NADA", motivo: "YA_ABIERTA" };
    if (abierta.numeroDeEnvios >= MAXIMO_DE_ENVIOS) {
      return { tipo: "NADA", motivo: "TOPE_DE_ENVIOS" };
    }
    if (ahora.getTime() - abierta.ultimoEnvioEn.getTime() < ESPERA_ENTRE_ENVIOS_EN_MS) {
      return { tipo: "NADA", motivo: "ENVIO_RECIENTE" };
    }
    return { tipo: "REENVIAR", numero: abierta.numeroDeEnvios + 1 };
  }
  // Un spam reciente bloquea en silencio; vuelve a poder pedir cuando la fila se anonimiza (90 días).
  if (
    ultimaCerrada !== null &&
    ultimaCerrada.estado === "SPAM" &&
    ahora.getTime() - ultimaCerrada.decididaEn.getTime() < RETENCION_DE_CERRADAS_EN_MS
  ) {
    return { tipo: "NADA", motivo: "SPAM_RECIENTE" };
  }
  return { tipo: "CREAR" };
}
