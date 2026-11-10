import { importeDesdeTexto } from "../primitivas/dinero/importe";
import { ARS } from "../primitivas/dinero/moneda";
import { crearAporteDeCaja, type TicketsPorCobranza } from "../modulos/caja/publico";
import type { LecturasDeVentas } from "../modulos/ventas/publico";

/** Lo que el adaptador lee de la transacción del cierre: la composición la arma con las lecturas de ventas (`TxDeApp`). */
type TxConLecturasDeVentas = Readonly<{
  lecturasDeVentas: Pick<LecturasDeVentas, "ticketsPorCobranzaDelContexto">;
}>;

/**
 * El cierre del día de caja en la composición (E3, tramo 8; e3b §4.6): caja DECLARA el puerto `TicketsPorCobranza` (no importa ventas) y la
 * composición lo implementa con `ticketsPorCobranza` de ventas (E4 §3.15): por cada cobranza, el ticket y su total VIGENTE (cero si está anulado),
 * que caja compara con SU total cobrado. Ventas devuelve el dato leído en la MISMA transacción del cierre. Falla cerrado: una `tx` sin las
 * lecturas de ventas es un defecto de armado y se lanza (caja lo trata como `APORTE_NO_DISPONIBLE` y el día no cierra); una cobranza que ventas no
 * devuelve la trata caja como dato que no se pudo leer, nunca como «sin diferencia».
 * Previene: el control `caja.cobrado_contra_ticket` ciego (un cobro anulado o cobrado de más que el cierre del día no vería).
 * Chequeo: `test/integracion/ventas-cobro-cierre.test.ts`.
 */
export const ticketsPorCobranzaDeLaComposicion: TicketsPorCobranza = {
  async ticketsPorCobranza(tx, cobranzaIds) {
    const lecturas = (tx as Partial<TxConLecturasDeVentas>).lecturasDeVentas;
    if (lecturas === undefined) {
      throw new Error("el cierre del día de caja se armó sin las lecturas de ventas");
    }
    const filas = await lecturas.ticketsPorCobranzaDelContexto(cobranzaIds);
    return filas.map((f) => ({
      cobranzaId: f.cobranzaId,
      ticketId: f.ticketId,
      totalVigente: importeDesdeTexto(ARS, f.totalVigente),
    }));
  },
};

/** El aporte de caja que `cierre` usa para los módulos activos de la empresa (`caja` solo cuenta si la empresa lo tiene activo). */
export const aporteDeCaja = crearAporteDeCaja({ tickets: ticketsPorCobranzaDeLaComposicion });
