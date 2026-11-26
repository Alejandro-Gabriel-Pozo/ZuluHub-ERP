import { z } from "zod";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import {
  aFacturaWeb,
  formaDeFactura,
  type FacturaWebDeRegistrarCompra,
} from "./entradas-de-comprar";
import { identificador, leer, texto, type ErrorDeEntrada } from "./entradas-de-facturacion";
import {
  aFacturaSeparadaWeb,
  formaDeLaFacturaSeparada,
  type FacturaWebSeparada,
} from "./entradas-de-facturas";

/**
 * La frontera de «Reemplazar el comprobante» (NOTAS-2c-2): de lo que trae el navegador a lo que reciben los casos de uso y las consultas. Lista de permitidos: solo se toman los campos declarados; la empresa, la
 * persona y la sucursal NO se leen del pedido (las pone el servidor).
 *  - **Reemplazar una factura (N3/N4)** lleva la clave del envío (un UUID por intento: es la idempotencia), la factura que se reemplaza, el motivo que escribe la persona y la factura nueva (la de «Cargar factura», SIN
 *    proveedor: el de la nueva es el de la original, lo decide el servidor).
 *  - **Cambiar el comprobante de la compra (N1/N2)** lleva además la factura que la persona estaba mirando (`facturaVigenteVistaId`: control de versión) y la factura nueva con sus líneas apuntando a los renglones de la
 *    compra.
 *  - Importes como TEXTO decimal, nunca `number`. El precargado del motivo es de la pantalla; acá solo se exige que llegue.
 * Previene: una factura nueva con un proveedor, una empresa o una versión que dijo el navegador, importes como `number`. Chequeo: `entradas-de-reemplazo.test.ts`.
 */

const formaDeReemplazar = z.strictObject({
  clave: identificador,
  comprobanteId: identificador,
  motivo: texto,
  factura: formaDeLaFacturaSeparada,
});

export type EntradaWebDeReemplazarFactura = Readonly<{
  clave: string;
  comprobanteId: string;
  motivo: string;
  factura: FacturaWebSeparada;
}>;

export function entradaDeReemplazarFactura(
  crudo: unknown,
): Resultado<EntradaWebDeReemplazarFactura, ErrorDeEntrada> {
  const forma = leer(formaDeReemplazar, crudo);
  if (!forma.ok) return forma;
  return ok({
    clave: forma.valor.clave,
    comprobanteId: forma.valor.comprobanteId,
    motivo: forma.valor.motivo,
    factura: aFacturaSeparadaWeb(forma.valor.factura),
  });
}

const formaDeCambiar = z.strictObject({
  clave: identificador,
  recepcionId: identificador,
  facturaVigenteVistaId: identificador,
  motivo: texto,
  factura: formaDeFactura,
});

export type EntradaWebDeCambiarElComprobante = Readonly<{
  clave: string;
  recepcionId: string;
  facturaVigenteVistaId: string;
  motivo: string;
  factura: FacturaWebDeRegistrarCompra;
}>;

export function entradaDeCambiarElComprobante(
  crudo: unknown,
): Resultado<EntradaWebDeCambiarElComprobante, ErrorDeEntrada> {
  const forma = leer(formaDeCambiar, crudo);
  if (!forma.ok) return forma;
  return ok({
    clave: forma.valor.clave,
    recepcionId: forma.valor.recepcionId,
    facturaVigenteVistaId: forma.valor.facturaVigenteVistaId,
    motivo: forma.valor.motivo,
    factura: aFacturaWeb(forma.valor.factura),
  });
}

const formaDeLaFacturaAReemplazar = z.strictObject({ comprobanteId: identificador });

/** «Qué hay que deshacer antes» de reemplazar una factura (N3/N4): solo el id de la factura. */
export function entradaDeDeshacerAntesDeReemplazar(
  crudo: unknown,
): Resultado<Readonly<{ comprobanteId: string }>, ErrorDeEntrada> {
  return leer(formaDeLaFacturaAReemplazar, crudo);
}

const formaDeLaCompraACambiar = z.strictObject({ recepcionId: identificador });

/** «Qué hay que deshacer antes» de cambiar el comprobante de una compra (N1/N2): solo el id de la compra. */
export function entradaDeDeshacerAntesDeCambiar(
  crudo: unknown,
): Resultado<Readonly<{ recepcionId: string }>, ErrorDeEntrada> {
  return leer(formaDeLaCompraACambiar, crudo);
}
