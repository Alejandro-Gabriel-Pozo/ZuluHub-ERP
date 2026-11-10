import { crearAporteDeCaja, type TicketsPorCobranza } from "../modulos/caja/publico";

/**
 * El cierre del día de caja en la composición (E3, tramo 8; e3b §4.6): caja DECLARA el puerto `TicketsPorCobranza` (no importa ventas) y
 * la composición lo implementa. Ventas todavía no existe (E4), así que hoy no hay quien informe el total vigente de un ticket: este adaptador
 * devuelve «nada», y caja lo trata como un dato que no se pudo leer (`APORTE_NO_DISPONIBLE`) SOLO si la jornada tiene cobros con origen
 * `ventas.cobranza_de_ticket`; con cero cobros de ventas no se le pregunta nada y el día cierra. Falla cerrado: nunca se inventa «sin
 * diferencias» para un ticket que nadie informó.
 * SUPUESTO (E3, tramo 8): se registra así hasta que exista ventas. Cuesta cambiarlo: reemplazar `ticketsPorCobranzaDeLaComposicion` por la
 * función `ticketsPorCobranza` de ventas (e4 §3.15; con `estado = ANULADO` entrega `totalVigente = 0`) y su prueba; caja, `cierre` y la web
 * no cambian. Chequeo: `test/integracion/caja-cierre-del-dia-aporte.test.ts` (cobros de ventas sin implementación → `APORTE_NO_DISPONIBLE`).
 */
export const ticketsPorCobranzaDeLaComposicion: TicketsPorCobranza = {
  ticketsPorCobranza: () => Promise.resolve([]),
};

/** El aporte de caja que `cierre` usa para los módulos activos de la empresa (`caja` solo cuenta si la empresa lo tiene activo). */
export const aporteDeCaja = crearAporteDeCaja({ tickets: ticketsPorCobranzaDeLaComposicion });
