import { z } from "zod";
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
const unidad = z.string().refine((u) => Object.hasOwn(UNIDADES, u));

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
const formaDelRemitoEscrito = z.object({ puntoDeVenta: texto, numero: texto, fecha: texto });

const formaDeRegistrar = z.object({
  clave: identificador,
  proveedorId: identificador,
  depositoId: identificador.nullish(),
  remito: formaDelRemitoEscrito.nullish(),
  renglones: z.array(formaDeRenglon).min(1),
});

export type EntradaWebDeRegistrarCompra = Readonly<{
  clave: string;
  proveedorId: string;
  depositoId: string | null;
  remito: Readonly<{ puntoDeVenta: number; numero: number; fecha: string }> | null;
  renglones: EntradaWebDeCotizarCompra["renglones"];
}>;

const enBlanco = (valor: string): boolean => valor.trim() === "";

export function entradaDeRegistrarCompra(
  crudo: unknown,
): Resultado<EntradaWebDeRegistrarCompra, ErrorDeEntrada> {
  const forma = leer(formaDeRegistrar, crudo);
  if (!forma.ok) return forma;
  let remito: EntradaWebDeRegistrarCompra["remito"] = null;
  const escrito = forma.valor.remito;
  if (
    escrito !== undefined &&
    escrito !== null &&
    !(enBlanco(escrito.puntoDeVenta) && enBlanco(escrito.numero) && enBlanco(escrito.fecha))
  ) {
    const leido = leer(formaDeRemito, escrito);
    if (!leido.ok) return leido;
    remito = leido.valor;
  }
  const renglones = entradaDeCotizarCompra({ renglones: forma.valor.renglones });
  if (!renglones.ok) return renglones;
  return ok({
    clave: forma.valor.clave,
    proveedorId: forma.valor.proveedorId,
    depositoId: forma.valor.depositoId ?? null,
    remito,
    renglones: renglones.valor.renglones,
  });
}
