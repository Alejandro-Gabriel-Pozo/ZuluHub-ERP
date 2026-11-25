import { cantidadConUnidad } from "../../produccion/modelo-de-ordenes";
import { CLAVE_DE_TEXTO_DE_UNIDAD } from "../../../../../../src/capacidades/vocabulario/unidades-de-medida";
import { texto as textoDelCatalogo } from "../../../../../../src/capacidades/vocabulario/vocabulario";
import { fechaYHoraParaMostrar } from "../../../../../../src/primitivas/tiempo/instante-para-mostrar";
import {
  formatearCantidad,
  formatearFecha,
  formatearImporte,
} from "../../../patrones/formato-fiscal";
import { RUTA_DE_COMPRAS, rutaDeCorregirLaLinea, rutaDelPago } from "../rutas-de-compras";
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
    precioPor: Readonly<{ tipo: "PRESENTACION" | "UNIDAD"; unidadId: string | null }> | null;
    correccionesVistas: number;
    correcciones: readonly Readonly<{
      numero: number;
      precioAnterior: Importe | null;
      precioNuevo: Importe;
      motivo: string;
      hechaPor: string | null;
      hechaEn: string;
    }>[];
  }>[];
  total: Importe | null;
  factura: Readonly<{
    comprobanteId: string;
    letra: "A" | "B" | "C";
    puntoDeVenta: number;
    numero: number;
    fecha: string | null;
    vencimientoDePago: string | null;
    totalSegunLaFactura: Importe;
  }> | null;
  pagos: readonly Readonly<{
    id: string;
    fechaDePago: string;
    medio: string;
    importe: Importe;
    estado: "VIGENTE" | "ANULADO";
    declaradoPor: string | null;
    declaradoEn: string;
    anuladoPor: string | null;
    anuladoEn: string | null;
    motivoDeAnulacion: string | null;
  }>[];
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
  /** Adónde lleva «Corregir» (el formulario de la línea); `null` si no se ofrece (sin permiso, sin precio o compra anulada). */
  corregir: string | null;
  /** Las correcciones de precio de la línea, de la más vieja a la más nueva. */
  correcciones: readonly Readonly<{
    clave: number;
    /** «Corregido por ana@ejemplo.com · 24/11/2026 21:14»; sin correo que mostrar, solo el momento no se dibuja. */
    quien: string | null;
    /** «Antes: $ 1.000,00»; `null` si no había precio anterior. */
    antes: string | null;
    motivo: string;
  }>[];
}>;

/** Lo que la persona puede hacer sobre una compra (solo ayuda para ofrecer botones: cada acción vuelve a pasar por el guard del servidor). Sin permisos leídos, todo cerrado. */
export type AccionesDeLaCompraParaLaPantalla = Readonly<{
  corregir: boolean;
  anular: boolean;
  /** «Declarar pago» (`comprobantes_de_proveedor.pagar`). */
  pagar: boolean;
  /** Anular el pago (`comprobantes_de_proveedor.anular_pago`). */
  anularPago: boolean;
}>;
export const SIN_ACCIONES_DE_LA_COMPRA: AccionesDeLaCompraParaLaPantalla = {
  corregir: false,
  anular: false,
  pagar: false,
  anularPago: false,
};

/** Un pago de la factura ya armado para mostrar: «Transferencia · 24/11/2026», su importe, quién y cuándo, y, si se anuló, «Anulado» con su motivo, quién y cuándo. */
type PagoArmado = Readonly<{
  clave: string;
  titulo: string;
  importe: string;
  /** «correo · 24/11/2026 21:14»; `null` sin correo que mostrar. */
  quien: string | null;
  anulado: Readonly<{
    rotulo: string;
    motivo: string | null;
    quien: string | null;
  }> | null;
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
  /** «Anular» al pie: solo con el permiso y si la compra no está anulada. */
  anular: boolean;
  /** Adónde lleva «Corregir» junto al aviso de una compra ya consumida: la primera línea que se puede corregir; `null` si ninguna. */
  corregirLaPrimera: string | null;
  /** Los pagos de la factura, del más viejo al más nuevo (los anulados quedan a la vista: nada se borra). Vacía sin factura o sin pagos. */
  pagos: readonly PagoArmado[];
  /** Adónde lleva «Declarar pago»: solo con el permiso, una factura vigente de una compra no anulada y sin pago vigente; `null` si no se ofrece. */
  declararPago: Readonly<{ texto: string; href: string }> | null;
  /** El pago vigente que «Anular» puede anular (con el permiso); `null` si no se ofrece. */
  anularPagoId: string | null;
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

/** El nombre de la unidad como lo dice el catálogo; una que la pantalla no conoce se dice con su propio valor (nunca se esconde). */
const nombreDeLaUnidad = (unidadId: string): string =>
  Object.hasOwn(CLAVE_DE_TEXTO_DE_UNIDAD, unidadId)
    ? textoDelCatalogo(
        {},
        CLAVE_DE_TEXTO_DE_UNIDAD[unidadId as keyof typeof CLAVE_DE_TEXTO_DE_UNIDAD],
      )
    : unidadId;

/** «Precio por Caja de 12» o «Precio por Kilogramo»: el rótulo del precio de una línea que ya tiene precio. Sin «precio por» conocido, solo «Precio». */
export function rotuloDelPrecio(
  linea: FichaDeCompraParaLaPantalla["lineas"][number],
  textos: TextosDeCompras,
): string {
  if (linea.precioPor === null) return textos.precio;
  const por =
    linea.precioPor.tipo === "PRESENTACION"
      ? linea.presentacion
      : linea.precioPor.unidadId === null
        ? null
        : nombreDeLaUnidad(linea.precioPor.unidadId);
  return por === null ? textos.precio : `${textos.precioPor} ${por}`;
}

/** Una línea se puede corregir si ya tiene precio (completar «Sin precio» es de otro tramo) y la compra no está anulada. */
const sePuedeCorregir = (
  ficha: FichaDeCompraParaLaPantalla,
  linea: FichaDeCompraParaLaPantalla["lineas"][number],
): boolean => ficha.estado !== "ANULADA" && linea.importe !== null;

export function armarLaFicha(
  ficha: FichaDeCompraParaLaPantalla,
  textos: TextosDeCompras,
  acciones: AccionesDeLaCompraParaLaPantalla = SIN_ACCIONES_DE_LA_COMPRA,
): FichaArmada {
  const hrefDeCorregir = (l: FichaDeCompraParaLaPantalla["lineas"][number]): string | null =>
    acciones.corregir && sePuedeCorregir(ficha, l)
      ? rutaDeCorregirLaLinea(ficha.recepcionId, l.numero)
      : null;
  const quien = (por: string | null, en: string): string | null =>
    por === null ? null : `${por} · ${fechaYHoraParaMostrar(en)}`;
  const vigente = ficha.pagos.find((p) => p.estado === "VIGENTE");
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
      corregir: hrefDeCorregir(l),
      correcciones: l.correcciones.map((c) => ({
        clave: c.numero,
        quien:
          c.hechaPor === null
            ? null
            : textos.corregidoPor(c.hechaPor, fechaYHoraParaMostrar(c.hechaEn)),
        antes:
          c.precioAnterior === null
            ? null
            : `${textos.antes}: ${formatearImporte(c.precioAnterior.monto)}`,
        motivo: c.motivo,
      })),
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
    anular: acciones.anular && ficha.estado !== "ANULADA",
    corregirLaPrimera:
      ficha.lineas.map((l) => hrefDeCorregir(l)).find((href) => href !== null) ?? null,
    pagos: ficha.pagos.map((p) => ({
      clave: p.id,
      titulo: `${textos.medioDePago(p.medio)} · ${formatearFecha(p.fechaDePago)}`,
      importe: formatearImporte(p.importe.monto),
      quien: quien(p.declaradoPor, p.declaradoEn),
      anulado:
        p.estado === "ANULADO"
          ? {
              rotulo: textos.anulado,
              motivo: p.motivoDeAnulacion,
              quien: p.anuladoEn === null ? null : quien(p.anuladoPor, p.anuladoEn),
            }
          : null,
    })),
    declararPago:
      acciones.pagar &&
      ficha.factura !== null &&
      ficha.estado !== "ANULADA" &&
      vigente === undefined
        ? { texto: textos.declararPago, href: rutaDelPago(ficha.recepcionId) }
        : null,
    anularPagoId: acciones.anularPago && vigente !== undefined ? vigente.id : null,
  };
}
