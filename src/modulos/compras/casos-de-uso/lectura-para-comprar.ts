import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { CLASES_COMPRABLES } from "../../catalogo/publico";
import { totalDeCompra } from "../dominio/importe-vigente";
import { leerRenglonesDeCompra } from "../dominio/registrar-compra";
import type { TxDeConsultasDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";
import { calcularRenglon } from "./registrar-compra-apoyo";

/**
 * «Productos para comprar» (E9 §3.3, INV §7): lo que la pantalla «Nueva compra» ofrece para elegir. Solo lectura: no escribe ni audita, y no lee el nivel de compras (esa lectura
 * crea la fila y es de otra pantalla). Vive acá y no en `consultas/` por la misma razón que el resto de las lecturas de compras.
 *
 * Reglas (cada una con su prueba en `test/integracion/compras-productos-para-comprar.test.ts`):
 *  - **Qué se compra**: productos ACTIVOS de la empresa del contexto y de las clases que `registrarCompra` acepta (`CLASES_COMPRABLES`: materia prima, insumo y reventa; el
 *    elaborado y el vendible no se compran). Es la lista del catálogo, no una copia: si el catálogo cambia qué se compra, esta lectura cambia con él.
 *  - **Cómo se busca**: por el prefijo del nombre, con la regla del catálogo (`tx.productos.listar`); no se repite acá. El texto llega ya validado por la composición.
 *  - **Tope y orden fijos**: hasta `TOPE_DE_PRODUCTOS_PARA_COMPRAR`, por nombre y luego por id. El tope lo pone el servidor, nunca el pedido.
 *  - **Presentaciones**: solo las ACTIVAS de cada producto, en UNA lectura para toda la página, con su cantidad en la unidad base. Un producto sin presentaciones se compra en su unidad base.
 *  - **Peso variable**: es dato de la presentación (el producto no lo tiene): cada una dice si se pesa al recibir. Se informa; el caso de uso exige el peso real al registrar.
 *  - **Nada de dinero ni de stock**: ni precios ni costos ni existencias (los costos piden `costos.ver`, que esta lectura no declara).
 */

/** Cuántos productos trae como máximo una búsqueda: para un buscador que se escribe, no para listar el catálogo. */
export const TOPE_DE_PRODUCTOS_PARA_COMPRAR = 50;

export type PresentacionParaComprar = Readonly<{
  id: string;
  nombre: string;
  /** Texto decimal de 4 decimales, en la unidad base del producto (en peso variable es solo el aproximado). */
  cantidad: string;
  dePesoVariable: boolean;
}>;

export type ProductoParaComprar = Readonly<{
  productoId: string;
  nombre: string;
  /** El código de la unidad base (`kg`, `un`…): la pantalla lo muestra con la lista de unidades que ya tiene. */
  unidadBase: string;
  clase: string;
  presentaciones: readonly PresentacionParaComprar[];
}>;

export type EntradaDeProductosParaComprar = Readonly<{
  /** Prefijo del nombre, ya validado; `undefined` = sin filtro. */
  texto?: string | undefined;
}>;

export async function productosParaComprarDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: EntradaDeProductosParaComprar,
): Promise<readonly ProductoParaComprar[]> {
  const productos = await tx.productos.listar(contexto.empresaId, {
    claseDeUso: CLASES_COMPRABLES,
    activo: true,
    limite: TOPE_DE_PRODUCTOS_PARA_COMPRAR,
    ...(entrada.texto === undefined ? {} : { texto: entrada.texto }),
  });
  if (productos.length === 0) return [];
  const presentaciones = await tx.presentacionesDeProducto.deLosProductos(
    contexto.empresaId,
    productos.map((p) => p.producto.id),
  );
  return productos.map(({ producto }) => ({
    productoId: producto.id,
    nombre: producto.nombre,
    unidadBase: producto.unidadBaseId,
    clase: producto.claseDeUso,
    presentaciones: presentaciones
      .filter((x) => x.productoId === producto.id)
      .map((x) => ({
        id: x.id,
        nombre: x.nombre,
        cantidad: x.cantidad,
        dePesoVariable: x.dePesoVariable,
      })),
  }));
}

/**
 * `cotizarCompra`: lo que va a pasar con los renglones de una compra ANTES de guardarla (cuánto entra al stock, el importe y el costo por unidad de stock). Es la MISMA cuenta
 * que hace el alta (`calcularRenglon` → `calcularLinea`), sobre el mismo renglón leído por el mismo lector (`leerRenglonesDeCompra`): una regla, un lugar. Reglas:
 *  - **No escribe**: ni filas, ni auditoría, ni bloqueos (el alta bloquea el producto; acá se lee). Sin clave de idempotencia porque no hay nada que repetir.
 *  - **Misma validación que el alta**: producto de la empresa, activo y comprable; cantidad, unidades y precio válidos; peso real si corresponde. Un renglón que el alta rechazaría
 *    se rechaza igual y con el mismo error (el primero, en orden). Otra empresa o un producto que no existe son indistinguibles.
 *  - **Sin precio** (`precio: null`) el importe y el costo son `null` juntos, nunca cero. Dinero y cantidades como texto decimal (importe 2 decimales, costo 6, stock 4).
 *  - Cotiza una compra SIN factura (N1): el IVA que entra al costo por una factura A de un monotributista lo decide la factura, que esta cotización no trae.
 */
export type RenglonCotizado = Readonly<{
  productoId: string;
  /** Texto decimal de 4 decimales, en la unidad base del producto. */
  cantidadEnStock: string;
  /** Texto decimal de 2 decimales; `null` sin precio. */
  importe: string | null;
  /** Texto decimal de 6 decimales; `null` sin precio. */
  costoPorUnidadDeStock: string | null;
  dePesoVariable: boolean;
}>;

export type CompraCotizada = Readonly<{
  renglones: readonly RenglonCotizado[];
  /**
   * El total de la compra: la suma de los importes de los renglones, con la MISMA regla que el total de la lista y de la ficha (`totalDeCompra`: centavos enteros, nunca `number`). `null` si algún
   * renglón no tiene precio: nunca un total parcial ni cero. Coincide EXACTO con el total que muestra la ficha de la compra al guardarla (sin correcciones todavía).
   */
  total: string | null;
}>;

export async function cotizarCompraDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: Readonly<{ renglones: unknown }>,
): Promise<Resultado<CompraCotizada, ErrorDeCompras>> {
  const leidos = leerRenglonesDeCompra(entrada.renglones);
  if (!leidos.ok) return err(leidos.error);
  const renglones: RenglonCotizado[] = [];
  for (const renglon of leidos.valor) {
    const calculado = await calcularRenglon(tx, contexto.empresaId, renglon, null, false);
    if (!calculado.ok) return calculado;
    renglones.push({
      productoId: calculado.valor.producto.id,
      cantidadEnStock: calculado.valor.cantidadEnStock,
      importe: calculado.valor.importe,
      costoPorUnidadDeStock: calculado.valor.costoPorUnidadDeStock,
      dePesoVariable: calculado.valor.dePesoVariable,
    });
  }
  return ok({ renglones, total: totalDeCompra(renglones.map((r) => r.importe)) });
}
