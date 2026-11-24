import { cantidadConUnidad } from "../../produccion/modelo-de-ordenes";
import { fechaYHoraParaMostrar } from "../../../../../../src/primitivas/tiempo/instante-para-mostrar";
import {
  formatearCantidad,
  formatearFecha,
  formatearImporte,
} from "../../../patrones/formato-fiscal";
import { RUTA_DE_COMPRAS } from "../rutas-de-compras";
import {
  nombreDeLaFactura,
  numeroImpreso,
  totalParaMostrar,
} from "../lista/modelo-de-lista-de-compras";
import type { TextosDeCompras } from "../textos-de-compras";

/**
 * El modelo de vista de la ficha de una compra (maqueta `compra-corregir-anular.html`, `vFicha`, sin «Corregir», «Anular», el pago ni «Corregido por…»; Compras PR 3): el proveedor y la fecha, cada línea
 * con lo que entra al stock y su costo, el total y la factura si la hay. Puro: sin React ni servidor. El modelo NO calcula ningún importe: muestra lo que devuelve el servidor, y una línea sin precio
 * dice «Sin precio» (nunca «$ 0,00») y no muestra costo. El correo ausente no dibuja la línea de «quién» (sin texto nuevo, como «Tickets del día»).
 */

type Importe = Readonly<{ moneda: string; monto: string }>;

export type FichaDeCompraParaLaPantalla = Readonly<{
  recepcionId: string;
  numero: number;
  proveedor: string | null;
  fechaNegocio: string;
  estado: "ANULADA" | "RECIBIDA_SIN_FACTURAR" | "RECIBIDA_Y_FACTURADA";
  remito: Readonly<{ puntoDeVenta: number; numero: number; fecha: string }> | null;
  registradaPor: string | null;
  registradaEn: string;
  anulacion: Readonly<{ motivo: string; hechaPor: string | null; hechaEn: string }> | null;
  lineas: readonly Readonly<{
    numero: number;
    producto: string | null;
    cantidadDeCompra: string;
    presentacion: string | null;
    unidadDeCompraId: string;
    cantidadEnStock: string;
    unidadDeStockId: string | null;
    importe: Importe | null;
    costoPorUnidadDeStock: Importe | null;
  }>[];
  total: Importe | null;
  factura: Readonly<{
    letra: "A" | "B" | "C";
    puntoDeVenta: number;
    numero: number;
    fecha: string | null;
    vencimientoDePago: string | null;
    totalSegunLaFactura: Importe;
  }> | null;
}>;

const SIN_DATO = "—";

type LineaDeFichaArmada = Readonly<{
  clave: number;
  nombre: string;
  importe: string;
  /** «2 cajas · Entra a tu stock: 46,6 Kilogramo». */
  cantidad: string;
  /** «Costo por unidad de stock: $ 1.140,00»; `null` si la línea no tiene precio. */
  costo: string | null;
}>;

export type FichaArmada = Readonly<{
  /** «Compra 5». */
  titulo: string;
  anulada: string | null;
  /** «Carnes del Sur · 31/10/2026». */
  proveedorYFecha: string;
  anulacion: Readonly<{ rotulo: string; motivo: string; quien: string | null }> | null;
  remito: Readonly<{ rotulo: string; valor: string }>;
  lineas: readonly LineaDeFichaArmada[];
  total: Readonly<{ rotulo: string; valor: string }>;
  factura: Readonly<{
    titulo: string;
    fechas: string | null;
    rotuloDelTotal: string;
    total: string;
  }> | null;
  /** «correo · 17/11/2026 21:14»; `null` sin correo que mostrar. */
  quien: string | null;
  volver: Readonly<{ texto: string; href: string }>;
}>;

/** «2 Kilogramo» sin presentación; «2 Caja de 12» con ella: la cantidad de compra con el nombre de lo que se compró. */
function cantidadDeCompra(l: FichaDeCompraParaLaPantalla["lineas"][number]): string {
  return l.presentacion === null
    ? cantidadConUnidad(l.cantidadDeCompra, l.unidadDeCompraId)
    : `${formatearCantidad(l.cantidadDeCompra)} ${l.presentacion}`;
}

const conUnidadDeStock = (l: FichaDeCompraParaLaPantalla["lineas"][number]): string =>
  l.unidadDeStockId === null
    ? formatearCantidad(l.cantidadEnStock)
    : cantidadConUnidad(l.cantidadEnStock, l.unidadDeStockId);

export function armarLaFicha(
  ficha: FichaDeCompraParaLaPantalla,
  textos: TextosDeCompras,
): FichaArmada {
  const quien = (por: string | null, en: string): string | null =>
    por === null ? null : `${por} · ${fechaYHoraParaMostrar(en)}`;
  return {
    titulo: `${textos.compra} ${String(ficha.numero)}`,
    anulada: ficha.estado === "ANULADA" ? textos.anulada : null,
    proveedorYFecha: `${ficha.proveedor ?? SIN_DATO} · ${formatearFecha(ficha.fechaNegocio)}`,
    anulacion:
      ficha.anulacion === null
        ? null
        : {
            rotulo: textos.motivo,
            motivo: ficha.anulacion.motivo,
            quien: quien(ficha.anulacion.hechaPor, ficha.anulacion.hechaEn),
          },
    remito: {
      rotulo: ficha.remito === null ? textos.sinRemito : textos.remitoDelProveedor,
      valor:
        ficha.remito === null
          ? ""
          : `${numeroImpreso(ficha.remito.puntoDeVenta, ficha.remito.numero)} · ${formatearFecha(ficha.remito.fecha)}`,
    },
    lineas: ficha.lineas.map((l) => ({
      clave: l.numero,
      nombre: l.producto ?? SIN_DATO,
      importe: totalParaMostrar(l.importe, textos),
      cantidad: `${cantidadDeCompra(l)} · ${textos.entraATuStock}: ${conUnidadDeStock(l)}`,
      costo:
        l.costoPorUnidadDeStock === null
          ? null
          : `${textos.costoPorUnidadDeStock}: ${formatearImporte(l.costoPorUnidadDeStock.monto)}`,
    })),
    total: { rotulo: textos.total, valor: totalParaMostrar(ficha.total, textos) },
    factura:
      ficha.factura === null
        ? null
        : {
            titulo: nombreDeLaFactura(ficha.factura),
            fechas:
              [
                ficha.factura.fecha === null ? null : formatearFecha(ficha.factura.fecha),
                ficha.factura.vencimientoDePago === null
                  ? null
                  : `${textos.vence} ${formatearFecha(ficha.factura.vencimientoDePago)}`,
              ]
                .filter((x): x is string => x !== null)
                .join(" · ") || null,
            rotuloDelTotal: textos.total,
            total: formatearImporte(ficha.factura.totalSegunLaFactura.monto),
          },
    quien: quien(ficha.registradaPor, ficha.registradaEn),
    volver: { texto: textos.volver, href: RUTA_DE_COMPRAS },
  };
}
