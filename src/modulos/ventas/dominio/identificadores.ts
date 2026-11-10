import type { Marca } from "../../../primitivas/identificadores/marca";

/** Identificadores de ventas, con marca: un `CuentaId` no se pasa donde se espera un `LineaId`. Los manda la aplicación (uuid), salvo el del ticket. */
export type CuentaId = Marca<string, "CuentaId">;
export type LineaId = Marca<string, "LineaId">;
export type TicketId = Marca<string, "TicketId">;
export type EjemplarId = Marca<string, "EjemplarId">;
export type CobranzaId = Marca<string, "CobranzaId">;

const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un id de ventas es un uuid: lo demás nunca puede ser el id de nada y la base lo rechazaría por formato. */
export const esUuid = (texto: string): boolean => FORMA_DE_UUID.test(texto);

export const cuentaId = (valor: string): CuentaId => valor as CuentaId;
export const lineaId = (valor: string): LineaId => valor as LineaId;
export const ticketId = (valor: string): TicketId => valor as TicketId;
export const ejemplarId = (valor: string): EjemplarId => valor as EjemplarId;
export const cobranzaId = (valor: string): CobranzaId => valor as CobranzaId;
