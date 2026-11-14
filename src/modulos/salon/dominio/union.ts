import { createHash } from "node:crypto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * UNIR DOS CUENTAS (E7 §3.8, D116): decisión pura de si se puede. Cada caso dice su motivo (`unir.html:253`). No se une una mesa libre, ni con un
 * cobro hecho, ni dividida, ni ya unida (ni como origen una que ya recibió otra unión), ni de otra sucursal. Los códigos salen en este orden fijo, así el mismo pedido da siempre el mismo motivo.
 * Previene: una cuenta duplicada o un cobro que quede en el aire por unir lo que no se debía. Puro: sin reloj ni azar.
 */
export type CuentaParaUnir = Readonly<{
  cuentaId: string;
  sucursalId: string;
  /** Alguna cuenta de la mesa ya cobrada (una división con una hija cobrada). */
  conCobro: boolean;
  /** La mesa está dividida en cuentas hijas. */
  dividida: boolean;
  /** Es la cuenta de reserva de una unión vigente. */
  unida: boolean;
  /** Ya recibió una unión (es el destino de otra): sus ítems incluyen los de una mesa que sigue reservada. */
  recibioUnion: boolean;
}>;

export type ErrorDeUnion =
  | "MISMA_CUENTA"
  | "SUCURSAL_DISTINTA"
  | "MESA_LIBRE"
  | "MESA_UNIDA"
  | "MESA_DIVIDIDA"
  | "MESA_CON_COBRO";

/** `null` = esa mesa no tiene cuenta abierta (está libre). */
export function decidirUnion(
  destino: CuentaParaUnir | null,
  origen: CuentaParaUnir | null,
): Resultado<null, ErrorDeUnion> {
  if (destino === null || origen === null) return err("MESA_LIBRE");
  if (destino.cuentaId === origen.cuentaId) return err("MISMA_CUENTA");
  if (destino.sucursalId !== origen.sucursalId) return err("SUCURSAL_DISTINTA");
  // Un destino que ya recibió una unión no pasa a otra cuenta: la reserva de la primera mesa quedaría abierta al cobrar (D1).
  if (destino.unida || origen.unida || origen.recibioUnion) return err("MESA_UNIDA");
  if (destino.dividida || origen.dividida) return err("MESA_DIVIDIDA");
  if (destino.conCobro || origen.conCobro) return err("MESA_CON_COBRO");
  return ok(null);
}

/** La huella de una unión: sha256 (hex) de destino y origen en ese orden (unir A con B y B con A son pedidos distintos). */
export function huellaDeUnion(
  entrada: Readonly<{ cuentaDestinoId: string; cuentaOrigenId: string }>,
): string {
  return createHash("sha256")
    .update(JSON.stringify([entrada.cuentaDestinoId, entrada.cuentaOrigenId]))
    .digest("hex");
}
