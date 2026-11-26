import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { esNivelDeRecepcionSeparada } from "../dominio/recepcion-separada";
import type { ComprobanteGuardado } from "../persistencia/repositorio-de-comprobantes";
import type { ErrorDeCompras } from "./errores";
import type { TxDeConsultasDeCompras } from "./contrato";

/**
 * Lo que hay que deshacer ANTES de reemplazar una factura (NOTAS-2, RP-2): en este orden, un pago vigente (se anula, y si fue en efectivo devuelve la plata a la caja), las conciliaciones vivas (se anulan, y lo recibido
 * recupera su saldo) y las notas vigentes (de crédito o de débito vinculadas; se anulan). El reemplazo NO hace ninguno de esos pasos por su cuenta: cada uno es de quien tiene el permiso de ese paso. La misma lista la
 * lee la pantalla («qué hay que deshacer antes») y la que frena el caso de uso con el código del primero: una regla, un lugar.
 */
export type FrenoDelReemplazo = Readonly<{
  freno: "PAGO_VIGENTE" | "CONCILIACIONES_VIVAS" | "NOTAS_VIGENTES";
  /** El error con que el reemplazo falla cerrado por este freno (los que ya existen: `COMPROBANTE_YA_PAGADO` con el id del pago, `COMPROBANTE_CONCILIADO`, `COMPROBANTE_CON_NOTA_DE_CREDITO`). */
  error: ErrorDeCompras;
}>;

/** Solo se reemplaza una factura que llega sola (N3 y N4), no la del atajo de N1 y N2 (esa se cambia con «cambiar el comprobante de la compra», NOTAS-2b). */
export const esFacturaReemplazable = (c: ComprobanteGuardado | null): c is ComprobanteGuardado =>
  c !== null && c.clase === "FACTURA" && esNivelDeRecepcionSeparada(c.nivel) && !c.esAtajo;

export async function frenosDeLaFactura(
  tx: Pick<
    TxDeConsultasDeCompras,
    "pagosDeProveedor" | "conciliacionesDeCompra" | "notasDeCredito"
  >,
  empresaId: EmpresaId,
  facturaId: string,
): Promise<readonly FrenoDelReemplazo[]> {
  const frenos: FrenoDelReemplazo[] = [];
  const pago = await tx.pagosDeProveedor.vigenteDe(empresaId, facturaId);
  if (pago !== null) {
    frenos.push({
      freno: "PAGO_VIGENTE",
      error: { error: "COMPROBANTE_YA_PAGADO", pagoId: pago.id },
    });
  }
  const saldos = await tx.conciliacionesDeCompra.saldosDeFactura(empresaId, facturaId);
  if (saldos.some((s) => s.asignada !== "0.0000")) {
    frenos.push({ freno: "CONCILIACIONES_VIVAS", error: "COMPROBANTE_CONCILIADO" });
  }
  const [acreditado, debitado] = await Promise.all([
    tx.notasDeCredito.acreditadoDe(empresaId, facturaId),
    tx.notasDeCredito.debitadoDe(empresaId, facturaId),
  ]);
  if (acreditado !== "0.00" || debitado !== "0.00") {
    frenos.push({ freno: "NOTAS_VIGENTES", error: "COMPROBANTE_CON_NOTA_DE_CREDITO" });
  }
  return frenos;
}
