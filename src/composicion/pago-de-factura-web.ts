import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { ok } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { entradaDeAnularPago, entradaDeDeclararPago } from "./entradas-de-pago-de-factura";
import { accionDeCaja } from "./errores-de-caja";
import { accionDeCompras } from "./errores-de-compras";
import type { Web } from "./web";

/**
 * «Declarar pago» y anular un pago de una factura del proveedor (Compras PR 8; maqueta `compra-pago.html`). Son ESCRITURAS: el permiso (`comprobantes_de_proveedor.pagar` y `.anular_pago`), el alcance de sucursal,
 * la transacción, la auditoría, el egreso de la caja y la repetición los resuelve el caso de uso (el servidor, no la pantalla); esta capa solo lee el pedido con lista de permitidos y traduce el resultado.
 *  - **Declarar** lleva la clave de la pantalla abierta: la misma clave y el mismo contenido devuelven el mismo pago (`yaExistia`) sin escribir, sin auditar y sin sacar la plata dos veces. Dos personas que pagan la misma
 *    factura a la vez dejan UN pago (la otra recibe `COMPROBANTE_YA_PAGADO`, que sale como el genérico). El importe NO viaja: lo copia el servidor del total de la factura. El efectivo siempre sale de una caja
 *    abierta (dueño, 16/11/2026, 3A): sin caja, o con la caja cerrada, el pago no queda y no se mueve nada (todo o nada en una transacción).
 *  - **Anular** repetida es `PAGO_YA_ANULADO` (el genérico, sin escribir): el estado del pago bajo bloqueo decide, así que dos anulaciones a la vez dejan una sola y devuelven el efectivo una sola vez.
 *  - **Las cajas para elegir** son una LECTURA: las cajas ABIERTAS de la sucursal que fija el servidor (nunca la que diga el navegador), de `estadoDeLaCaja` (`cajas.ver`). Una en cierre o sin sesión no se ofrece.
 * La empresa y quién actúa salen de la sesión, nunca del pedido. Nada de dinero sale como `number`. Chequeo: `test/integracion/compras-pago-web.test.ts`.
 */

export type DependenciasDePagoDeFacturaWeb = Readonly<{
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeCompras"]>, "declararPago" | "anularPago">;
  consultasDeCaja: () => Pick<ReturnType<Web["consultasDeCaja"]>, "estadoDeLaCaja">;
  respuesta: DependenciasDeRespuesta;
}>;

export type PagoDeclaradoParaLaPantalla = Readonly<{
  pagoId: string;
  /** `true`: era el mismo pago de un envío anterior (doble toque, reintento): no se escribió ni se auditó nada de nuevo. */
  yaExistia: boolean;
}>;

export function declararElPago(
  d: DependenciasDePagoDeFacturaWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<PagoDeclaradoParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeDeclararPago,
    (entrada) => d.casosDeUso().declararPago(contexto, entrada),
    (salida) => ({ pagoId: salida.pagoId, yaExistia: salida.yaExistia }),
  );
}

export function anularElPago(
  d: DependenciasDePagoDeFacturaWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ anulado: true }>>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeAnularPago,
    (entrada) => d.casosDeUso().anularPago(contexto, entrada),
    () => ({ anulado: true as const }),
  );
}

export type CajaParaPagar = Readonly<{ cajaId: string; nombre: string }>;
export type CajasParaPagarEnLaPantalla = Readonly<{ cajas: readonly CajaParaPagar[] }>;

/** Las cajas abiertas de la sucursal, para elegir de cuál sale el efectivo. Una lectura: no escribe. Quién puede ver las cajas lo decide `estadoDeLaCaja` (`cajas.ver`); al pagar, el servidor vuelve a verificar la caja. */
export function cajasAbiertasParaPagar(
  d: DependenciasDePagoDeFacturaWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
): Promise<Respuesta<CajasParaPagarEnLaPantalla>> {
  return accionDeCaja(
    d.respuesta,
    {},
    () => ok({}),
    () => d.consultasDeCaja().estadoDeLaCaja(contexto, { sucursalId }),
    (estado) => ({
      cajas: estado.cajas
        .filter((c) => c.estado === "ABIERTA")
        .map((c) => ({ cajaId: c.cajaId, nombre: c.nombre })),
    }),
  );
}
