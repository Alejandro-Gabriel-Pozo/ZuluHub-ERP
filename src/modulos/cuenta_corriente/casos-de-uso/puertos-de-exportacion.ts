import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { MedioDeCobranza } from "../dominio/exportacion";

/** El ticket detrás de un movimiento, tal como se muestra: «Ticket {numero} · {canal} · {sucursal}». */
export type TicketDeUnMovimiento = Readonly<{
  numero: number;
  sucursalId: string;
  esDelSalon: boolean;
}>;

/**
 * Lo que la exportación y la ficha de la cuenta corriente necesitan de OTROS módulos, con tipos propios (CC-4 y CC-5): el medio de pago con que se pagó cada cobranza (lo sabe caja), el nombre de
 * las sucursales (lo sabe empresas) y el ticket de cada movimiento: su número y su canal (lo sabe ventas). Lo implementa la composición, el único lugar donde se tocan los módulos (como `CuentaCorrienteDeVentas`), y corre en la MISMA transacción de
 * la exportación: solo lectura, sin autorizar (autoriza el caso de uso).
 */
export interface ApoyoDeLaExportacion<Tx> {
  /**
   * Los medios de pago de las cobranzas pedidas (por id de cobranza), cada uno con su medio VIGENTE (correcciones aplicadas) y su importe. Una cobranza sin cobros de caja no figura
   * en el resultado. Una sola lectura para todas: no una consulta por cobranza.
   */
  mediosDeCobranza(
    tx: Tx,
    empresa: EmpresaId,
    cobranzaIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly MedioDeCobranza[]>>;
  /**
   * El ticket que originó cada movimiento (CC-5): por id de ticket (un cargo) y por id de cobranza (un cobro), con su número, su sucursal y si nació en el salón. Una sola lectura para todos;
   * lo que no existe en la empresa no figura.
   */
  ticketsDeLosMovimientos(
    tx: Tx,
    empresa: EmpresaId,
    ticketIds: readonly string[],
    cobranzaIds: readonly string[],
  ): Promise<
    Readonly<{
      porTicket: ReadonlyMap<string, TicketDeUnMovimiento>;
      porCobranza: ReadonlyMap<string, TicketDeUnMovimiento>;
    }>
  >;
  /** El nombre de las sucursales pedidas; una que no existe en la empresa no figura. */
  nombresDeSucursales(
    tx: Tx,
    empresa: EmpresaId,
    sucursalIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
}
