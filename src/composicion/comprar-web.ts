import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { ok } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import {
  entradaDeCotizarCompra,
  entradaDeCotizarFactura,
  entradaDeProductosParaComprar,
  entradaDeRegistrarCompra,
} from "./entradas-de-comprar";
import { accionDeCompras } from "./errores-de-compras";
import type { Web } from "./web";

/**
 * «Nueva compra», la parte del servidor que muestra qué se puede comprar (compras PR 5; brief `PR-5-nueva-compra-servidor.md`): los productos con su unidad base y sus presentaciones.
 *  - **Es una LECTURA**: no escribe ni audita, y no toca el nivel de compras. Pide `recepciones.ver` dentro de su transacción (el servidor, no la pantalla).
 *  - **La empresa sale de la sesión**, nunca del pedido. Qué se compra, el tope y el orden los fija el servidor; del pedido solo se toma el texto de búsqueda.
 *  - **Un texto que no pasa la lista de permitidos es «nada puede coincidir»**: lista vacía, nunca la búsqueda ensanchada.
 *  - Sin dinero y sin stock: ni precios ni costos ni existencias salen de acá.
 */

export type DependenciasDeComprarWeb = Readonly<{
  consultas: () => Pick<
    ReturnType<Web["consultasDeCompras"]>,
    "productosParaComprar" | "cotizarCompra" | "nivelParaComprar" | "cotizarFactura"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

export type PresentacionParaLaPantalla = Readonly<{
  id: string;
  nombre: string;
  /** Texto decimal en la unidad base del producto. */
  cantidad: string;
  dePesoVariable: boolean;
}>;

export type ProductoParaComprarEnLaPantalla = Readonly<{
  productoId: string;
  nombre: string;
  unidadBase: string;
  clase: string;
  presentaciones: readonly PresentacionParaLaPantalla[];
}>;

export type ProductosParaComprarEnLaPantalla = Readonly<{
  productos: readonly ProductoParaComprarEnLaPantalla[];
}>;

export function buscarLosProductosParaComprar(
  d: DependenciasDeComprarWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<ProductosParaComprarEnLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeProductosParaComprar,
    async (entrada) =>
      entrada.ninguno
        ? ok([])
        : d
            .consultas()
            .productosParaComprar(
              contexto,
              entrada.texto === undefined ? {} : { texto: entrada.texto },
            ),
    (lista) => ({
      productos: lista.map((p) => ({
        productoId: p.productoId,
        nombre: p.nombre,
        unidadBase: p.unidadBase,
        clase: p.clase,
        presentaciones: p.presentaciones.map((x) => ({
          id: x.id,
          nombre: x.nombre,
          cantidad: x.cantidad,
          dePesoVariable: x.dePesoVariable,
        })),
      })),
    }),
  );
}

export type RenglonCotizadoParaLaPantalla = Readonly<{
  productoId: string;
  /** Texto decimal de 4 decimales, en la unidad base del producto («Entra a tu stock»). */
  cantidadEnStock: string;
  /** Texto decimal de 2 decimales; `null` sin precio (nunca cero). */
  importe: string | null;
  /** Texto decimal de 6 decimales; `null` sin precio («Costo por unidad de stock»). */
  costoPorUnidadDeStock: string | null;
  dePesoVariable: boolean;
}>;

export type CompraCotizadaParaLaPantalla = Readonly<{
  renglones: readonly RenglonCotizadoParaLaPantalla[];
  /** Texto decimal de 2 decimales, la suma que calcula el servidor; `null` si algún renglón no tiene precio (nunca un total parcial ni cero). */
  total: string | null;
}>;

/**
 * Cuánto entra al stock y cuánto cuesta cada renglón, mientras se carga la compra y ANTES de guardarla. Es una LECTURA con la misma cuenta que el alta: no escribe, no audita, no
 * bloquea. La empresa sale de la sesión; un renglón que el alta rechazaría se rechaza igual (el genérico o el texto propio de la cantidad y el precio).
 */
export function cotizarLaCompra(
  d: DependenciasDeComprarWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<CompraCotizadaParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeCotizarCompra,
    (entrada) => d.consultas().cotizarCompra(contexto, entrada),
    (cotizada) => ({
      total: cotizada.total,
      renglones: cotizada.renglones.map((r) => ({
        productoId: r.productoId,
        cantidadEnStock: r.cantidadEnStock,
        importe: r.importe,
        costoPorUnidadDeStock: r.costoPorUnidadDeStock,
        dePesoVariable: r.dePesoVariable,
      })),
    }),
  );
}

export type NivelParaComprarEnLaPantalla = Readonly<{ conFactura: boolean }>;

/** Si la empresa compra «Con factura» (para dibujar el bloque de la factura): SOLO ese dato. Es una LECTURA: no escribe, no crea la fila de la configuración y no toca `compras.configurar`. */
export function leerElNivelParaComprar(
  d: DependenciasDeComprarWeb,
  contexto: ContextoOperativo,
): Promise<Respuesta<NivelParaComprarEnLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    {},
    () => ok({}),
    () => d.consultas().nivelParaComprar(contexto),
    (nivel) => ({ conFactura: nivel.conFactura }),
  );
}

export type FacturaCotizadaParaLaPantalla = Readonly<{
  /** El neto y el IVA de cada línea, en el orden en que vinieron (texto decimal de 2 decimales). */
  lineas: readonly Readonly<{ netoDeLinea: string; ivaDeLinea: string }>[];
  /** Neto e IVA por alícuota (la lista de alícuotas, solo las que tienen importe). */
  importesPorAlicuota: readonly Readonly<{ alicuota: string; neto: string; iva: string }>[];
  netoGravado: string;
  iva: string;
  tributosTotal: string;
  /** La suma que calcula el servidor. */
  totalCalculado: string;
  /** El total que dice el papel, tal como se escribió. */
  totalSegunFactura: string;
  /** `false`: no coincide (a lo sumo un centavo de diferencia es «coincide»); avisa y la factura se carga igual. */
  totalCoincide: boolean;
}>;

/**
 * Las cuentas de la factura mientras se carga y ANTES de guardarla: la misma función del dominio que el alta (`calcularComprobante`); la pantalla solo muestra (nunca suma ni redondea). Es una LECTURA: no escribe, no audita,
 * no bloquea. Pide `comprobantes_de_proveedor.registrar` dentro de su transacción.
 */
export function cotizarLaFactura(
  d: DependenciasDeComprarWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<FacturaCotizadaParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeCotizarFactura,
    (entrada) => d.consultas().cotizarFactura(contexto, entrada),
    (c) => ({
      lineas: c.lineas.map((l) => ({ netoDeLinea: l.netoDeLinea, ivaDeLinea: l.ivaDeLinea })),
      importesPorAlicuota: c.importesPorAlicuota.map((i) => ({
        alicuota: i.alicuota,
        neto: i.neto,
        iva: i.iva,
      })),
      netoGravado: c.netoGravado,
      iva: c.iva,
      tributosTotal: c.tributosTotal,
      totalCalculado: c.totalCalculado,
      totalSegunFactura: c.totalSegunFactura,
      totalCoincide: c.totalCoincide,
    }),
  );
}

export type DependenciasDeRegistrarCompraWeb = Readonly<{
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeCompras"]>,
    "registrarCompra" | "registrarCompraConFactura"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

/** Lo que la factura cargada «tal como vino» avisa sin frenar: la letra que no era la esperada del proveedor y el total del papel que no coincide con la suma. */
export type AvisoDeFacturaParaLaPantalla =
  | Readonly<{ tipo: "LETRA_NO_ESPERADA"; esperada: string }>
  | Readonly<{ tipo: "TOTAL_NO_COINCIDE" }>;

export type CompraRegistradaParaLaPantalla = Readonly<{
  recepcionId: string;
  /** `true`: era la misma compra de un envío anterior (doble toque, reintento): no se escribió ni se auditó nada de nuevo. */
  yaExistia: boolean;
  /** Los avisos de la factura (vacía sin factura): la factura se guardó igual. */
  avisos: readonly AvisoDeFacturaParaLaPantalla[];
}>;

/**
 * «Comprar y recibir» (compras PR 6b): registra la compra y su entrada de stock con el caso de uso `registrarCompra`, que es UNA transacción (la compra, sus líneas, la entrada de stock y la
 * oferta del proveedor, todo o nada) y que ya trae la idempotencia: la misma clave con el mismo contenido devuelve la compra hecha (`yaExistia`) sin escribir; la misma clave con otro contenido
 * y el mismo remito del mismo proveedor con otra clave se rechazan. Acá solo se arma el pedido: la empresa y la persona salen del contexto, la sucursal la pone el servidor (la elegida y validada
 * de la persona, nunca la que diga el navegador), y el permiso (`recepciones.registrar`), el alcance de la sucursal, el depósito y toda cuenta los decide el caso de uso adentro.
 * Previene: una compra duplicada por doble toque o reintento, y una compra en una sucursal o empresa que dijo el navegador. Chequeo: `test/integracion/compras-comprar-web.test.ts`.
 */
export function registrarLaCompra(
  d: DependenciasDeRegistrarCompraWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<CompraRegistradaParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeRegistrarCompra,
    (entrada) => {
      const pedido = {
        clave: entrada.clave,
        sucursalId,
        proveedorId: entrada.proveedorId,
        depositoId: entrada.depositoId,
        remito: entrada.remito,
        renglones: entrada.renglones,
      };
      // Con factura, el caso de uso de «Con factura» (compra + factura + conciliación de atajo en UNA transacción); sin ella, el de siempre. El nivel de la empresa lo verifica el servidor en los dos.
      return entrada.factura === null
        ? d.casosDeUso().registrarCompra(contexto, pedido)
        : d
            .casosDeUso()
            .registrarCompraConFactura(contexto, { ...pedido, factura: entrada.factura });
    },
    (salida) => ({
      recepcionId: salida.recepcionId,
      yaExistia: salida.yaExistia,
      avisos: salida.avisos.map((a) =>
        a.tipo === "LETRA_NO_ESPERADA" ? { tipo: a.tipo, esperada: a.esperada } : { tipo: a.tipo },
      ),
    }),
  );
}
