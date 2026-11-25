import { z } from "zod";
import { ALICUOTAS_DE_COMPRA, TIPOS_DE_COMPROBANTE_DE_PROVEEDOR } from "../modulos/compras/publico";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import { textoDeBusquedaDeProductoDesdeTexto } from "../primitivas/texto/termino-de-busqueda-de-producto";
import { UNIDADES } from "../primitivas/unidades/unidades";
import {
  decimal,
  entero,
  identificador,
  leer,
  texto,
  type ErrorDeEntrada,
} from "./entradas-de-facturacion";

/**
 * La frontera de «productos para comprar» (compras, PR 5): de lo que pide la pantalla a lo que acepta la consulta. Pura: sin base ni servidor. Solo se toma `texto`; la empresa, la persona, el
 * tope y el orden los pone el servidor. El texto pasa por la lista de permitidos de la búsqueda de productos (la misma del catálogo: ningún nombre tiene lo que ella rechaza); vacío es
 * «sin filtro». Un texto que ella rechaza NO ensancha la búsqueda: es «nada puede coincidir» (`ninguno: true`), la misma regla que la lista de productos.
 * Previene: un filtro libre que llega sin validar a la consulta, y un filtro inválido que se ignora y muestra todo. Chequeo: `entradas-de-comprar.test.ts`.
 */

const forma = z.object({ texto: texto.optional() });

export type EntradaWebDeProductosParaComprar =
  Readonly<{ ninguno: true }> | Readonly<{ ninguno: false; texto: string | undefined }>;

export function entradaDeProductosParaComprar(
  crudo: unknown,
): Resultado<EntradaWebDeProductosParaComprar, ErrorDeEntrada> {
  const leida = leer(forma, crudo ?? {});
  if (!leida.ok) return leida;
  const busqueda = textoDeBusquedaDeProductoDesdeTexto(leida.valor.texto ?? "");
  if (!busqueda.ok) return ok({ ninguno: true });
  return ok({ ninguno: false, texto: busqueda.valor ?? undefined });
}

/**
 * La frontera de «cotizar la compra» (cuánto entra al stock y cuánto cuesta, antes de guardar): de lo que escribe la pantalla a los renglones que acepta la consulta. Solo se toman los campos
 * declarados de cada renglón (el producto, la unidad de compra de la lista de unidades, la cantidad, el peso real, cómo se paga el precio y el precio, todo como TEXTO decimal: nunca `number`);
 * la presentación no se toma (la primera versión compra en la unidad base). Que la cantidad, el precio y las unidades tengan sentido lo decide el servidor con la misma cuenta del alta.
 * Previene: dinero o cantidades como `number`, y un renglón con campos que el navegador inventó. Chequeo: `entradas-de-comprar.test.ts`.
 */
export const unidad = z.string().refine((u) => Object.hasOwn(UNIDADES, u));

const formaDeRenglon = z.object({
  productoId: identificador,
  unidadDeCompraId: unidad,
  cantidad: decimal,
  pesoReal: decimal.nullish(),
  precioPor: z.enum(["PRESENTACION", "UNIDAD"]),
  unidadDePrecioId: unidad.nullish(),
  precio: decimal.nullish(),
});

const formaDeCotizar = z.object({ renglones: z.array(formaDeRenglon).min(1) });

export type EntradaWebDeCotizarCompra = Readonly<{
  renglones: readonly Readonly<{
    productoId: string;
    presentacionId: null;
    unidadDeCompraId: string;
    cantidad: string;
    pesoReal: string | null;
    precioPor: "PRESENTACION" | "UNIDAD";
    unidadDePrecioId: string | null;
    precio: string | null;
  }>[];
}>;

export function entradaDeCotizarCompra(
  crudo: unknown,
): Resultado<EntradaWebDeCotizarCompra, ErrorDeEntrada> {
  const forma = leer(formaDeCotizar, crudo);
  if (!forma.ok) return forma;
  return ok({
    renglones: forma.valor.renglones.map((r) => ({
      productoId: r.productoId,
      presentacionId: null,
      unidadDeCompraId: r.unidadDeCompraId,
      cantidad: r.cantidad,
      pesoReal: r.pesoReal ?? null,
      precioPor: r.precioPor,
      unidadDePrecioId: r.unidadDePrecioId ?? null,
      precio: r.precio ?? null,
    })),
  });
}

/**
 * La frontera de «Comprar y recibir» (compras PR 6b): de lo que manda la pantalla a lo que acepta `registrarCompra`. Solo se toman los campos declarados: la clave del envío (un UUID que genera la
 * pantalla por intento: es la idempotencia), el proveedor, el depósito si la sucursal tiene más de uno, el remito (opcional: punto de venta, número y fecha) y los renglones (los mismos de la
 * cotización). La empresa, la persona y la sucursal NO se leen del pedido: las pone el servidor. Los importes y las cantidades viajan como TEXTO decimal, nunca `number`. Qué punto de venta, número, fecha,
 * cantidad o precio valen lo decide el dominio dentro de la transacción (`leerRemito`, `calcularLinea`): acá solo la forma. Un remito a medio llenar NO se descarta: se rechaza (nunca se guarda una compra sin el remito que la
 * persona empezó a escribir). Todo en blanco es «sin remito».
 * Previene: dinero o cantidades como `number`, una compra con campos que el navegador inventó y una compra con la empresa o la sucursal que diga el navegador. Chequeo: `entradas-de-comprar.test.ts`.
 */
const formaDeRemito = z.object({ puntoDeVenta: entero, numero: entero, fecha: texto });
export const formaDelRemitoEscrito = z.object({ puntoDeVenta: texto, numero: texto, fecha: texto });

/**
 * La factura que llega con la compra (nivel «Con factura»; Compras PR 7): el tipo de la lista de comprobantes, el punto de venta y el número (enteros), la fecha, el vencimiento de pago (opcional), cada línea
 * con el renglón de la compra al que corresponde, su cantidad, su precio neto y su alícuota (de la lista de alícuotas), las percepciones (opcional), el total según la factura y, solo en la primera factura de un
 * proveedor sin CUIT, el CUIT y la condición frente al IVA. Los importes y las cantidades viajan como TEXTO decimal, nunca `number`. Un campo en blanco de los opcionales es «no hay». Qué tipo, número, alícuota o total valen
 * lo decide el dominio dentro de la transacción (`leerFactura`, `calcularComprobante`): acá solo la forma. NO existe un campo para el pago (se declara aparte, PR 8) ni para el importe de los totales calculados.
 */
const enBlancoEsNada = (valor: string | null | undefined): string | null =>
  valor === undefined || valor === null || valor.trim() === "" ? null : valor;

const formaDeLineaDeFactura = z.strictObject({
  renglon: entero,
  cantidadFacturada: decimal,
  precioNeto: decimal,
  alicuota: z.enum(ALICUOTAS_DE_COMPRA).nullish(),
});

const formaDeFactura = z.strictObject({
  tipo: z.enum(TIPOS_DE_COMPROBANTE_DE_PROVEEDOR),
  puntoDeVenta: entero,
  numero: entero,
  fecha: texto,
  vencimientoDePago: texto.nullish(),
  lineas: z.array(formaDeLineaDeFactura).min(1),
  percepciones: decimal.nullish(),
  totalSegunFactura: decimal,
  cuitDelProveedor: texto.nullish(),
  condicionIva: texto.nullish(),
});

export type FacturaWebDeRegistrarCompra = Readonly<{
  tipo: (typeof TIPOS_DE_COMPROBANTE_DE_PROVEEDOR)[number];
  puntoDeVenta: number;
  numero: number;
  fecha: string;
  vencimientoDePago: string | null;
  lineas: readonly Readonly<{
    renglon: number;
    cantidadFacturada: string;
    precioNeto: string;
    alicuota: string | null;
  }>[];
  percepciones: string | null;
  totalSegunFactura: string;
  cuitDelProveedor: string | null;
  condicionIva: string | null;
}>;

/**
 * La frontera de «cotizar la factura» (las cuentas antes de guardar; Compras PR 7): solo lo que entra en la cuenta (el tipo, cada línea con su cantidad, su precio neto y su alícuota, las percepciones y el total según la factura),
 * con las mismas formas y listas que la factura de «Comprar y recibir». Todo como TEXTO decimal. Lo que la cuenta rechaza lo dice el servidor con el mismo error del alta.
 */
const formaDeCotizarFactura = z.strictObject({
  tipo: z.enum(TIPOS_DE_COMPROBANTE_DE_PROVEEDOR),
  lineas: z.array(formaDeLineaDeFactura.omit({ renglon: true })).min(1),
  percepciones: decimal.nullish(),
  totalSegunFactura: decimal,
});

export type EntradaWebDeCotizarFactura = Readonly<{
  tipo: (typeof TIPOS_DE_COMPROBANTE_DE_PROVEEDOR)[number];
  lineas: readonly Readonly<{
    cantidadFacturada: string;
    precioNeto: string;
    alicuota: string | null;
  }>[];
  percepciones: string | null;
  totalSegunFactura: string;
}>;

export function entradaDeCotizarFactura(
  crudo: unknown,
): Resultado<EntradaWebDeCotizarFactura, ErrorDeEntrada> {
  const forma = leer(formaDeCotizarFactura, crudo);
  if (!forma.ok) return forma;
  return ok({
    tipo: forma.valor.tipo,
    lineas: forma.valor.lineas.map((l) => ({
      cantidadFacturada: l.cantidadFacturada,
      precioNeto: l.precioNeto,
      alicuota: l.alicuota ?? null,
    })),
    percepciones: enBlancoEsNada(forma.valor.percepciones),
    totalSegunFactura: forma.valor.totalSegunFactura,
  });
}

const formaDeRegistrar = z.object({
  clave: identificador,
  proveedorId: identificador,
  depositoId: identificador.nullish(),
  remito: formaDelRemitoEscrito.nullish(),
  renglones: z.array(formaDeRenglon).min(1),
  factura: formaDeFactura.nullish(),
});

export type EntradaWebDeRegistrarCompra = Readonly<{
  clave: string;
  proveedorId: string;
  depositoId: string | null;
  remito: Readonly<{ puntoDeVenta: number; numero: number; fecha: string }> | null;
  renglones: EntradaWebDeCotizarCompra["renglones"];
  /** La factura de la compra («Con factura»); `null` sin factura. El nivel de la empresa lo decide el servidor: una factura en «Sin factura» (o su falta en «Con factura») se rechaza ahí. */
  factura: FacturaWebDeRegistrarCompra | null;
}>;

const enBlanco = (valor: string): boolean => valor.trim() === "";

/** El remito tal como se escribió: todo en blanco (o ausente) es «sin remito»; a medio llenar se rechaza (nunca se guarda una compra distinta de la que la persona empezó a escribir). Lo comparten «Nueva compra» y «Recibir». */
export function leerElRemitoEscrito(
  escrito: Readonly<{ puntoDeVenta: string; numero: string; fecha: string }> | null | undefined,
): Resultado<
  Readonly<{ puntoDeVenta: number; numero: number; fecha: string }> | null,
  ErrorDeEntrada
> {
  if (
    escrito === undefined ||
    escrito === null ||
    (enBlanco(escrito.puntoDeVenta) && enBlanco(escrito.numero) && enBlanco(escrito.fecha))
  ) {
    return ok(null);
  }
  return leer(formaDeRemito, escrito);
}

export function entradaDeRegistrarCompra(
  crudo: unknown,
): Resultado<EntradaWebDeRegistrarCompra, ErrorDeEntrada> {
  const forma = leer(formaDeRegistrar, crudo);
  if (!forma.ok) return forma;
  const remito = leerElRemitoEscrito(forma.valor.remito);
  if (!remito.ok) return remito;
  const renglones = entradaDeCotizarCompra({ renglones: forma.valor.renglones });
  if (!renglones.ok) return renglones;
  return ok({
    clave: forma.valor.clave,
    proveedorId: forma.valor.proveedorId,
    depositoId: forma.valor.depositoId ?? null,
    remito: remito.valor,
    renglones: renglones.valor.renglones,
    factura:
      forma.valor.factura === undefined || forma.valor.factura === null
        ? null
        : {
            tipo: forma.valor.factura.tipo,
            puntoDeVenta: forma.valor.factura.puntoDeVenta,
            numero: forma.valor.factura.numero,
            fecha: forma.valor.factura.fecha,
            vencimientoDePago: enBlancoEsNada(forma.valor.factura.vencimientoDePago),
            lineas: forma.valor.factura.lineas.map((l) => ({
              renglon: l.renglon,
              cantidadFacturada: l.cantidadFacturada,
              precioNeto: l.precioNeto,
              alicuota: l.alicuota ?? null,
            })),
            percepciones: enBlancoEsNada(forma.valor.factura.percepciones),
            totalSegunFactura: forma.valor.factura.totalSegunFactura,
            cuitDelProveedor: enBlancoEsNada(forma.valor.factura.cuitDelProveedor),
            condicionIva: enBlancoEsNada(forma.valor.factura.condicionIva),
          },
  });
}
