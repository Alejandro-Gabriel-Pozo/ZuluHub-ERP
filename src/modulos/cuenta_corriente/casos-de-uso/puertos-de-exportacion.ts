import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { MedioDeCobranza } from "../dominio/exportacion";

/**
 * Lo que la exportación de la cuenta corriente necesita de OTROS módulos, con tipos propios (CC-4): el medio de pago con que se pagó cada cobranza (lo sabe caja) y el nombre de
 * las sucursales (lo sabe empresas). Lo implementa la composición, el único lugar donde se tocan los módulos (como `CuentaCorrienteDeVentas`), y corre en la MISMA transacción de
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
  /** El nombre de las sucursales pedidas; una que no existe en la empresa no figura. */
  nombresDeSucursales(
    tx: Tx,
    empresa: EmpresaId,
    sucursalIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
}
