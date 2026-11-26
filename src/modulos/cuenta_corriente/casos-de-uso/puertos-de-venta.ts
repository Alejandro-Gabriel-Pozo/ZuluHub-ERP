import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";

/**
 * Lo que `verClienteParaVender` necesita saber de la venta en curso, con tipos propios (CC-5, C3): la cuenta de consumo que se está cerrando a nombre de un cliente. La implementa la composición
 * (el único lugar donde se tocan los módulos, como `ApoyoDeLaExportacion`) y corre en la MISMA transacción: solo lectura, sin autorizar (autoriza el caso de uso).
 */
export interface CuentasDeConsumoParaVender<Tx> {
  /**
   * La sucursal de la cuenta de consumo de la empresa SOLO si está ABIERTA (una cerrada o anulada ya no se vende); `null` si no existe, es de otra empresa o no está abierta: los tres casos
   * son indistinguibles para quien pregunta.
   */
  sucursalDeLaCuentaAbierta(
    tx: Tx,
    empresa: EmpresaId,
    cuentaId: string,
  ): Promise<SucursalId | null>;
}
