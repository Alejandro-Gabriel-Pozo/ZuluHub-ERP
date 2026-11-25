import { z } from "zod";
import { ALICUOTAS_DE_COMPRA } from "../modulos/compras/publico";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import { formaDeFactura } from "./entradas-de-comprar";
import { entradaDeListarRecepciones } from "./entradas-de-recepciones";
import {
  decimal,
  entero,
  identificador,
  leer,
  type ErrorDeEntrada,
} from "./entradas-de-facturacion";

/**
 * La frontera de las pantallas de «Facturas» (Compras 4, factura de la empresa y conciliación): de lo que trae el navegador a lo que reciben los casos de uso y las consultas. Lista de permitidos en todas: solo se
 * toman los campos declarados; la empresa, la persona y la sucursal NO se leen del pedido (las pone el servidor), y la factura NO tiene sucursal (es de la empresa).
 *
 *  - **Cargar factura** lleva la clave del envío (un UUID que genera la pantalla por intento: es la idempotencia), el proveedor y la factura: la misma de «Nueva compra» (tipo, punto de venta, número, fecha, vencimiento,
 *    percepciones, total según la factura, CUIT y condición del proveedor nuevo), pero cada línea dice su PRODUCTO (con él se propone la conciliación) en lugar de un renglón. Importes y cantidades como TEXTO decimal, nunca `number`.
 *  - **Conciliar** lleva la clave, la factura y las asignaciones (qué línea de la factura cubre qué línea recibida y cuánto); que la línea exista, sea del mismo producto y haya saldo lo decide el caso de uso, y los topes la base.
 *  - **Anular conciliación** lleva solo el id (sin motivo: la decisión del dueño del 25/11/2026 no lo pide).
 * Previene: dinero o cantidades como `number`, una factura o una conciliación con campos que el navegador inventó. Chequeo: `entradas-de-facturas.test.ts`.
 */

const formaDeLinea = z.strictObject({
  productoId: identificador,
  cantidadFacturada: decimal,
  precioNeto: decimal,
  alicuota: z.enum(ALICUOTAS_DE_COMPRA).nullish(),
});

const formaDeRegistrar = z.strictObject({
  clave: identificador,
  proveedorId: identificador,
  factura: formaDeFactura.omit({ lineas: true }).extend({ lineas: z.array(formaDeLinea).min(1) }),
});

const enBlancoEsNada = (valor: string | null | undefined): string | null =>
  valor === undefined || valor === null || valor.trim() === "" ? null : valor;

export type EntradaWebDeRegistrarFactura = Readonly<{
  clave: string;
  proveedorId: string;
  factura: Readonly<{
    tipo: z.infer<typeof formaDeRegistrar>["factura"]["tipo"];
    puntoDeVenta: number;
    numero: number;
    fecha: string;
    vencimientoDePago: string | null;
    lineas: readonly Readonly<{
      productoId: string;
      cantidadFacturada: string;
      precioNeto: string;
      alicuota: string | null;
    }>[];
    percepciones: string | null;
    totalSegunFactura: string;
    cuitDelProveedor: string | null;
    condicionIva: string | null;
  }>;
}>;

export function entradaDeRegistrarFactura(
  crudo: unknown,
): Resultado<EntradaWebDeRegistrarFactura, ErrorDeEntrada> {
  const forma = leer(formaDeRegistrar, crudo);
  if (!forma.ok) return forma;
  const f = forma.valor.factura;
  return ok({
    clave: forma.valor.clave,
    proveedorId: forma.valor.proveedorId,
    factura: {
      tipo: f.tipo,
      puntoDeVenta: f.puntoDeVenta,
      numero: f.numero,
      fecha: f.fecha,
      vencimientoDePago: enBlancoEsNada(f.vencimientoDePago),
      lineas: f.lineas.map((l) => ({
        productoId: l.productoId,
        cantidadFacturada: l.cantidadFacturada,
        precioNeto: l.precioNeto,
        alicuota: l.alicuota ?? null,
      })),
      percepciones: enBlancoEsNada(f.percepciones),
      totalSegunFactura: f.totalSegunFactura,
      cuitDelProveedor: enBlancoEsNada(f.cuitDelProveedor),
      condicionIva: enBlancoEsNada(f.condicionIva),
    },
  });
}

const formaDeAsignacion = z.strictObject({
  lineaDeFactura: entero,
  recepcionId: identificador,
  lineaDeRecepcion: entero,
  cantidad: decimal,
});

const formaDeConciliar = z.strictObject({
  clave: identificador,
  comprobanteId: identificador,
  asignaciones: z.array(formaDeAsignacion).min(1),
});

export type EntradaWebDeConciliarFactura = Readonly<{
  clave: string;
  comprobanteId: string;
  asignaciones: readonly Readonly<{
    lineaDeFactura: number;
    recepcionId: string;
    lineaDeRecepcion: number;
    cantidad: string;
  }>[];
}>;

export function entradaDeConciliarFactura(
  crudo: unknown,
): Resultado<EntradaWebDeConciliarFactura, ErrorDeEntrada> {
  return leer(formaDeConciliar, crudo);
}

const formaDeAnular = z.strictObject({ conciliacionId: identificador });

export function entradaDeAnularConciliacion(
  crudo: unknown,
): Resultado<Readonly<{ conciliacionId: string }>, ErrorDeEntrada> {
  return leer(formaDeAnular, crudo);
}

const formaDeTomarElCosto = z.strictObject({
  clave: identificador,
  recepcionId: identificador,
  linea: z.number().int(),
});

export type EntradaWebDeTomarElCosto = Readonly<{
  clave: string;
  recepcionId: string;
  linea: number;
}>;

/**
 * «Tomar el costo de la factura»: la clave del envío (un UUID por intento: es la idempotencia), la recepción y la línea recibida. NADA MÁS: el precio no viaja (lo lee el servidor de la factura
 * conciliada) ni el motivo (es un código del servidor); la empresa, la persona y la sucursal tampoco se leen del pedido.
 */
export function entradaDeTomarElCosto(
  crudo: unknown,
): Resultado<EntradaWebDeTomarElCosto, ErrorDeEntrada> {
  return leer(formaDeTomarElCosto, crudo);
}

const formaDeLaFicha = z.strictObject({ comprobanteId: identificador });

/** El detalle de una factura y los datos para conciliarla: solo el id (un UUID). */
export function entradaDeFichaDeFactura(
  crudo: unknown,
): Resultado<Readonly<{ comprobanteId: string }>, ErrorDeEntrada> {
  return leer(formaDeLaFicha, crudo);
}

/** La lista de facturas: de la dirección solo se lee `despues` (el mismo cursor `AAAA-MM-DD|id` que la de recepciones: una regla); un cursor mal formado rechaza el pedido. Sin filtros en la primera versión. */
export const entradaDeListarFacturas = entradaDeListarRecepciones;
