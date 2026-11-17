/**
 * Los estados de la jornada (E3b §3.2). Viven fuera de `dominio/` porque los nombran también las consultas, que no importan el dominio
 * (regla `consultas-sin-dominio`, ADR-005); el dominio los importa de acá.
 */
export const ESTADOS_DE_JORNADA = ["ABIERTA", "EN_AUDITORIA", "CERRADA"] as const;
export type EstadoDeJornada = (typeof ESTADOS_DE_JORNADA)[number];

/** `SIN_ACTIVIDAD`: nadie registró nada ese día, así que la jornada todavía no existe (la crea quien tiene la primera actividad). */
export type EstadoConsultado = EstadoDeJornada | "SIN_ACTIVIDAD";
