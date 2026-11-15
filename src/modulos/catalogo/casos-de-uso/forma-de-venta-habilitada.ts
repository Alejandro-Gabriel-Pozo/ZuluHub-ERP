import type { ContextoOperativo } from "../../../contexto/contexto";
import { exigirPerilla } from "../../../capacidades/planes/derechos";
import { formaDeVentaDelPiloto, type FormaDeVenta } from "../dominio/forma-de-venta";
import type { TxDeCatalogo } from "./contrato";

/**
 * ¿Se puede cargar esta forma de venta? (A7; decisión del dueño del 14/11/2026: la venta por fracciones y por peso se construye ya, con perilla apagada por
 * defecto.) La del PILOTO (unidad de venta = unidad base, paso 1, sin fracciones) siempre; cualquier otra (otra unidad, un paso menor, fracciones) solo si el plan
 * de la empresa enciende `venta_por_fracciones_y_peso`, leída en esta transacción y sin caché. Es la ÚNICA regla: `crearProducto` y `cambiarFormaDeVenta` la usan.
 * Cargarla exige la perilla; VENDER lo ya cargado no (una baja de plan no corta la venta de lo que ya existe). Previene: un cliente sin el extra con un producto
 * por fracciones o por peso que nadie le habilitó.
 */
export async function formaDeVentaHabilitada(
  tx: TxDeCatalogo,
  contexto: ContextoOperativo,
  unidadBaseId: string,
  forma: FormaDeVenta,
  conPorciones: boolean,
): Promise<boolean> {
  if (!conPorciones && formaDeVentaDelPiloto(unidadBaseId, forma)) return true;
  const derechos = await tx.derechos.deLaEmpresa(contexto);
  return exigirPerilla(derechos, "venta_por_fracciones_y_peso", { empresaId: contexto.empresaId })
    .ok;
}
