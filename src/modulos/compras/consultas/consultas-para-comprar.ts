import type { ErrorDeCompras } from "../casos-de-uso/errores";
import {
  cotizarCompraDentro,
  cotizarFacturaDentro,
  nivelParaComprarDentro,
  productosParaComprarDentro,
  type CompraCotizada,
  type EntradaDeCotizarFactura,
  type EntradaDeProductosParaComprar,
  type FacturaCotizada,
  type NivelParaComprar,
  type ProductoParaComprar,
} from "../casos-de-uso/lectura-para-comprar";
import { type Lector, type RDeConsulta } from "./comun";
import type { Resultado } from "../../../primitivas/resultado/resultado";

type RError = Extract<Awaited<ReturnType<Lector>>, { ok: false }>["error"];

export type {
  CompraCotizada,
  EntradaDeCotizarFactura,
  EntradaDeProductosParaComprar,
  FacturaCotizada,
  NivelParaComprar,
  ProductoParaComprar,
};

export function armarConsultasParaComprar(leer: Lector) {
  return {
    /**
     * Los productos que se pueden comprar (materia prima, insumo y reventa activos) con su unidad base y sus presentaciones activas, por nombre, hasta un tope fijo. Acción
     * `recepciones.ver`: mirar es de los tres roles; el que además registra compras lo decide `recepciones.registrar` al guardar, no esta lectura.
     */
    productosParaComprar(
      contexto: Parameters<Lector>[0],
      entrada: EntradaDeProductosParaComprar = {},
    ): Promise<RDeConsulta<readonly ProductoParaComprar[]>> {
      return leer(contexto, ["recepciones.ver"], (tx) =>
        productosParaComprarDentro(tx, contexto, entrada),
      );
    },
    /**
     * Cuánto entra al stock, el importe y el costo por unidad de cada renglón de una compra, ANTES de guardarla: la misma cuenta que hace el alta, sin escribir nada. Acción
     * `recepciones.registrar` (es parte del gesto de cargar la compra; ver `lectura-para-comprar.ts`). El rechazo del guard sale como el del resto de las consultas.
     */
    async cotizarCompra(
      contexto: Parameters<Lector>[0],
      entrada: Readonly<{ renglones: unknown }>,
    ): Promise<Resultado<CompraCotizada, ErrorDeCompras | RError>> {
      const r = await leer(contexto, ["recepciones.registrar"], (tx) =>
        cotizarCompraDentro(tx, contexto, entrada),
      );
      return r.ok ? r.valor : r;
    },
    /**
     * Si la empresa compra «Con factura»: SOLO `{ conFactura }`, para dibujar el bloque de la factura en «Nueva compra». Acción `recepciones.registrar` (la de «Comprar y recibir»); no escribe y no toca
     * `compras.configurar` (quien opera sigue sin poder cambiar el nivel). Ver `nivelParaComprarDentro`.
     */
    nivelParaComprar(contexto: Parameters<Lector>[0]): Promise<RDeConsulta<NivelParaComprar>> {
      return leer(contexto, ["recepciones.registrar"], (tx) =>
        nivelParaComprarDentro(tx, contexto),
      );
    },
    /**
     * Las cuentas de la factura ANTES de guardarla: la misma función del dominio que el alta (`calcularComprobante`), sin escribir. Acción `comprobantes_de_proveedor.registrar`, la de cargar la
     * factura. Ver `cotizarFacturaDentro`.
     */
    async cotizarFactura(
      contexto: Parameters<Lector>[0],
      entrada: EntradaDeCotizarFactura,
    ): Promise<Resultado<FacturaCotizada, ErrorDeCompras | RError>> {
      const r = await leer(contexto, ["comprobantes_de_proveedor.registrar"], () =>
        Promise.resolve(cotizarFacturaDentro(entrada)),
      );
      return r.ok ? r.valor : r;
    },
  };
}
