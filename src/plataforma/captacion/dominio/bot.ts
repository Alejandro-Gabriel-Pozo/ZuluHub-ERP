/**
 * Pistas baratas de que quien envía el formulario no es una persona (alta por solicitud §4.1). Dominio
 * puro: la hora entra como dato. No son seguridad: son la primera capa y la más barata. Las siguientes
 * son el correo verificado, los límites y la revisión humana.
 *
 * `emitido` es el instante en que el servidor mostró el formulario, FIRMADO (la firma la comprueba la
 * capa de afuera: acá es un dato). Un bot que no lo puede forjar queda sin tiempo de llenado creíble.
 */

/** Menos que esto entre mostrar y enviar no lo escribe una persona. */
export const TIEMPO_MINIMO_DE_LLENADO_EN_MS = 2_000;

/** Una página abierta hace más de un día es una página vieja (la firma de `emitido` no se renueva sola). */
export const VIGENCIA_DEL_FORMULARIO_EN_MS = 24 * 3_600_000;

export type PistaDeBot = "HUMANO" | "BOT_HONEYPOT" | "BOT_TIEMPO_MINIMO" | "PAGINA_VENCIDA";

/**
 * - `honeypot`: el valor del campo invisible; una persona no lo ve y lo deja vacío. Cualquier cosa
 *   escrita, ya es un bot (se compara sin recortar: un autocompletado real escribe texto, no blancos).
 * - Tiempo: menos de 2 s es bot (incluye un `emitido` del futuro: no se puede haber llenado antes de
 *   mostrarse); más de 24 h es una página vencida; justo 2 s y justo 24 h todavía valen.
 * - Un bot que llenó el campo invisible no se entera de nada: gana sobre el vencimiento.
 */
export function pistaDeBot(honeypot: string, emitido: Date, ahora: Date): PistaDeBot {
  if (honeypot !== "") return "BOT_HONEYPOT";
  const transcurrido = ahora.getTime() - emitido.getTime();
  if (transcurrido < TIEMPO_MINIMO_DE_LLENADO_EN_MS) return "BOT_TIEMPO_MINIMO";
  if (transcurrido > VIGENCIA_DEL_FORMULARIO_EN_MS) return "PAGINA_VENCIDA";
  return "HUMANO";
}
