import type { ContextoOperativo } from "../../../contexto/contexto";
import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  exigirSucursalAbierta,
  sucursalesDeLaEmision,
  type ErrorDeSucursalCerrada,
} from "../dominio/sucursales-de-la-emision";
import type { ComprobanteId, PuntoDeVentaId } from "../dominio/identificadores";
import type { ComprobanteGuardado } from "../persistencia/repositorio-de-comprobantes";
import type { PuntoDeVentaGuardado } from "../persistencia/repositorios";
import type { TxDeFacturacion } from "./contrato-de-facturacion";

/**
 * Las dos lecturas de sucursal de una emisión, dentro de su transacción, con las reglas puras de
 * `dominio/sucursales-de-la-emision.ts` (acá solo se leen los datos que esas reglas piden).
 */

/** Lo que un pedido de emisión nombra: el comprobante que una nota corrige (o `null`) y el punto de venta (o `null` en una nota). */
type PedidoConSucursales = Readonly<{
  comprobanteAsociadoId?: ComprobanteId;
  puntoDeVentaId: PuntoDeVentaId | null;
}>;

/**
 * El comprobante que una nota corrige y el punto de venta del pedido (una nota sin punto de venta toma el del comprobante que
 * corrige), y D-41 y D-51: las sucursales del pedido contra el alcance de la persona, con las cerradas que tiene asignadas (si la
 * del punto de venta está cerrada, el motivo es D-50 y lo da `sucursalDelPuntoDeVentaAbierta`). Si la sucursal de la FACTURA que corrige
 * una nota no es de la persona, responde como si la factura no existiera (D-39). Va ANTES de mirar si el pedido ya se
 * había emitido: una clave ya usada no le devuelve a nadie el comprobante de una sucursal que no es suya.
 */
export async function puntoDeVentaYSucursalesDelPedido(
  tx: Pick<TxDeFacturacion, "autorizacion" | "lecturas" | "comprobantes" | "puntosDeVenta">,
  contexto: ContextoOperativo,
  pedido: PedidoConSucursales,
): Promise<
  Resultado<
    Readonly<{ pv: PuntoDeVentaGuardado; asociado: ComprobanteGuardado | null }>,
    "COMPROBANTE_ASOCIADO_NO_ENCONTRADO" | "PUNTO_DE_VENTA_NO_ENCONTRADO" | ErrorDeAlcance
  >
> {
  const { empresaId } = contexto;
  const asociado =
    pedido.comprobanteAsociadoId === undefined
      ? null
      : await tx.comprobantes.obtener(empresaId, pedido.comprobanteAsociadoId);
  if (pedido.comprobanteAsociadoId !== undefined && asociado === null) {
    return err("COMPROBANTE_ASOCIADO_NO_ENCONTRADO");
  }
  const pvId = pedido.puntoDeVentaId ?? asociado?.puntoDeVentaId;
  if (pvId === undefined) return err("PUNTO_DE_VENTA_NO_ENCONTRADO");
  const pv = await tx.puntosDeVenta.obtener(empresaId, pvId);
  if (pv === null) return err("PUNTO_DE_VENTA_NO_ENCONTRADO");
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto, { incluirDesactivadas: true });
  const corrige =
    asociado === null
      ? null
      : { sucursalId: await tx.lecturas.sucursalDelComprobante(empresaId, asociado.id) };
  const enAlcance = sucursalesDeLaEmision(alcance, pv.sucursalId, corrige);
  return enAlcance.ok ? ok({ pv, asociado }) : enAlcance;
}

/**
 * D-50: la sucursal del punto de venta con el que se emite tiene que estar abierta. La base lo vuelve a imponer, con bloqueo, al
 * dar de alta el comprobante (`comprobante_validar_alta`, 0017): esto es el error de negocio antes de llegar a ella.
 */
export async function sucursalDelPuntoDeVentaAbierta(
  tx: Pick<TxDeFacturacion, "sucursales">,
  empresaId: EmpresaId,
  puntoDeVenta: PuntoDeVentaGuardado,
): Promise<Resultado<null, ErrorDeSucursalCerrada>> {
  const sucursal = await tx.sucursales.obtener(empresaId, puntoDeVenta.sucursalId);
  // La clave foránea compuesta garantiza que la sucursal del punto de venta existe y es de la empresa.
  if (sucursal === null) {
    throw new Error(`la sucursal ${puntoDeVenta.sucursalId} del punto de venta no existe`);
  }
  return exigirSucursalAbierta(sucursal);
}
