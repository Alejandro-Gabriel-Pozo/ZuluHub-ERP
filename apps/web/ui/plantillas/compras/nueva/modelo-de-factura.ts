import type { ClaveDeTexto } from "../../../../../../src/capacidades/vocabulario/catalogo";
import {
  presentacionElegida,
  type RenglonEscrito,
  type RenglonCotizado,
} from "./modelo-de-nueva-compra";

/**
 * El modelo de la factura que se carga con «Nueva compra» cuando la empresa compra «Con factura» (maqueta `compra.html`, estados `factura` y `factura-total`; Compras PR 7). Puro: sin React ni servidor. NO calcula ningún
 * importe (neto, IVA, total calculado, si coincide: todo lo hace el servidor con la función del alta, `cotizarFactura`); solo arma el pedido y decide qué se precarga. Cada línea de la factura corresponde a un renglón de la
 * compra (el mismo orden) y va en la UNIDAD BASE del producto (la unidad en que se guarda lo recibido). Se precarga desde el renglón y la persona lo ajusta: la cantidad es la del renglón si se compró en la unidad base (si no, la
 * que dice el servidor que entra al stock) y el precio neto es el del renglón si se paga por la unidad base (si no, queda vacío: la conversión es del servidor, no de la pantalla).
 */

/** Los tipos que se ofrecen: facturas (la nota de crédito y la de débito no se cargan acá). La lista del dominio es la de `TIPOS_DE_COMPROBANTE_DE_PROVEEDOR`; la prueba `modelo-de-factura.test.ts` falla si difieren. */
export const TIPOS_DE_FACTURA = ["FACTURA_A", "FACTURA_B", "FACTURA_C"] as const;
export type TipoDeFactura = (typeof TIPOS_DE_FACTURA)[number];

/** Las alícuotas que se ofrecen en una factura A (de la lista del dominio, `ALICUOTAS_DE_COMPRA`; la prueba falla si una no existe allá). */
export const ALICUOTAS_PARA_ELEGIR = ["21", "10.5", "27", "EXENTO", "NO_GRAVADO"] as const;
const ALICUOTA_INICIAL = "21";

export const CLAVE_DE_TEXTO_DEL_TIPO: Readonly<Record<TipoDeFactura, ClaveDeTexto>> = {
  FACTURA_A: "compras.factura.tipo_factura_a",
  FACTURA_B: "compras.factura.tipo_factura_b",
  FACTURA_C: "compras.factura.tipo_factura_c",
};

export const CLAVE_DE_TEXTO_DE_LA_ALICUOTA: Readonly<
  Record<(typeof ALICUOTAS_PARA_ELEGIR)[number], ClaveDeTexto>
> = {
  "21": "catalogo.alicuota.21",
  "10.5": "catalogo.alicuota.10_5",
  "27": "catalogo.alicuota.27",
  EXENTO: "fiscal.pantalla.anular_alicuota_exento",
  NO_GRAVADO: "fiscal.pantalla.anular_alicuota_no_gravado",
};

/** Lo que la persona cambió de una línea de la factura; lo que no tocó se precarga del renglón. */
export type LineaDeFacturaEscrita = Readonly<{
  cantidad?: string;
  precio?: string;
  alicuota?: string;
}>;

export type FacturaEscrita = Readonly<{
  tipo: string;
  puntoDeVenta: string;
  numero: string;
  fecha: string;
  vencimientoDePago: string;
  percepciones: string;
  totalSegunFactura: string;
  /** Solo para la primera factura de un proveedor sin CUIT. */
  cuit: string;
  /** Por el id del renglón de la compra. */
  lineas: Readonly<Record<number, LineaDeFacturaEscrita>>;
}>;

export const FACTURA_VACIA: FacturaEscrita = {
  tipo: "",
  puntoDeVenta: "",
  numero: "",
  fecha: "",
  vencimientoDePago: "",
  percepciones: "",
  totalSegunFactura: "",
  cuit: "",
  lineas: {},
};

const esTipoDeFactura = (valor: string): valor is TipoDeFactura =>
  (TIPOS_DE_FACTURA as readonly string[]).includes(valor);

/** Una factura A discrimina el IVA (cada línea lleva su alícuota); una B o C no. Es solo qué se dibuja: la cuenta y la validación son del servidor (`discriminaIva` del dominio; la prueba compara). */
export const discriminaIva = (tipo: string): boolean => tipo === "FACTURA_A";

export const conLinea = (
  factura: FacturaEscrita,
  renglonId: number,
  cambios: LineaDeFacturaEscrita,
): FacturaEscrita => ({
  ...factura,
  lineas: { ...factura.lineas, [renglonId]: { ...factura.lineas[renglonId], ...cambios } },
});

/** La cantidad de la línea: la que escribió la persona o, si no tocó nada, la precargada del renglón. */
export function cantidadDeLaLinea(
  factura: FacturaEscrita,
  renglon: RenglonEscrito,
  cotizado: RenglonCotizado | undefined,
): string {
  const escrita = factura.lineas[renglon.id]?.cantidad;
  if (escrita !== undefined) return escrita;
  // Con una presentación la cantidad del renglón son presentaciones («3 cajas»): la factura va en la unidad base, así que se precarga lo que entra al stock.
  if (renglon.unidadDeCompra === renglon.unidadBase && presentacionElegida(renglon) === null) {
    return renglon.cantidad;
  }
  return cotizado === undefined ? "" : sinCerosDeRelleno(cotizado.cantidadEnStock);
}

/** El precio neto de la línea: el que escribió la persona o el del renglón si se paga por la unidad base; si no, vacío. */
export function precioDeLaLinea(factura: FacturaEscrita, renglon: RenglonEscrito): string {
  const escrito = factura.lineas[renglon.id]?.precio;
  if (escrito !== undefined) return escrito;
  return renglon.unidadDePrecio === renglon.unidadBase ? renglon.precio : "";
}

export const alicuotaDeLaLinea = (factura: FacturaEscrita, renglon: RenglonEscrito): string =>
  factura.lineas[renglon.id]?.alicuota ?? ALICUOTA_INICIAL;

/** «2000.0000» pasa a «2000»; «1.5000», a «1.5»: el mismo valor canónico, sin ceros de relleno. */
export function sinCerosDeRelleno(decimal: string): string {
  if (!decimal.includes(".")) return decimal;
  return decimal.replace(/0+$/, "").replace(/\.$/, "");
}

type LineaParaElServidor = Readonly<{
  renglon: number;
  cantidadFacturada: string;
  precioNeto: string;
  alicuota: string | null;
}>;

function lineasParaElServidor(
  factura: FacturaEscrita,
  renglones: readonly RenglonEscrito[],
  cotizados: ReadonlyMap<string, RenglonCotizado>,
): readonly LineaParaElServidor[] {
  return renglones.map((r, i) => ({
    renglon: i + 1,
    cantidadFacturada: cantidadDeLaLinea(factura, r, cotizados.get(r.productoId)),
    precioNeto: precioDeLaLinea(factura, r),
    alicuota: discriminaIva(factura.tipo) ? alicuotaDeLaLinea(factura, r) : null,
  }));
}

/** La factura está completa para cotizar: tipo, total según la factura y cantidad y precio de cada línea. */
function lista(factura: FacturaEscrita, lineas: readonly LineaParaElServidor[]): boolean {
  return (
    esTipoDeFactura(factura.tipo) &&
    factura.totalSegunFactura !== "" &&
    lineas.length > 0 &&
    lineas.every((l) => l.cantidadFacturada !== "" && l.precioNeto !== "")
  );
}

/** Lo que se manda a `cotizarFactura`; `null` mientras falta algo (nada que mostrar todavía). Las percepciones vacías son «no hay». */
export function facturaParaCotizar(
  factura: FacturaEscrita,
  renglones: readonly RenglonEscrito[],
  cotizados: ReadonlyMap<string, RenglonCotizado>,
) {
  const lineas = lineasParaElServidor(factura, renglones, cotizados);
  if (!lista(factura, lineas)) return null;
  return {
    tipo: factura.tipo,
    lineas: lineas.map(({ cantidadFacturada, precioNeto, alicuota }) => ({
      cantidadFacturada,
      precioNeto,
      alicuota,
    })),
    percepciones: factura.percepciones === "" ? null : factura.percepciones,
    totalSegunFactura: factura.totalSegunFactura,
  };
}

/** Lo que sale con «Comprar y recibir»: la factura completa; `null` si falta algo (el botón queda apagado). Un opcional en blanco es «no hay»; el servidor valida todo. */
export function facturaParaElServidor(
  factura: FacturaEscrita,
  renglones: readonly RenglonEscrito[],
  cotizados: ReadonlyMap<string, RenglonCotizado>,
  pideCuit: boolean,
) {
  const lineas = lineasParaElServidor(factura, renglones, cotizados);
  if (
    !lista(factura, lineas) ||
    factura.puntoDeVenta === "" ||
    factura.numero === "" ||
    factura.fecha === "" ||
    (pideCuit && factura.cuit === "")
  ) {
    return null;
  }
  return {
    tipo: factura.tipo,
    puntoDeVenta: factura.puntoDeVenta,
    numero: factura.numero,
    fecha: factura.fecha,
    vencimientoDePago: factura.vencimientoDePago === "" ? null : factura.vencimientoDePago,
    lineas,
    percepciones: factura.percepciones === "" ? null : factura.percepciones,
    totalSegunFactura: factura.totalSegunFactura,
    cuitDelProveedor: pideCuit ? factura.cuit : null,
  };
}

/** Lo que devuelve `cotizarFactura` (la misma forma que `FacturaCotizadaParaLaPantalla` de la composición: la UI no importa la composición). */
export type FacturaCotizada = Readonly<{
  lineas: readonly Readonly<{ netoDeLinea: string; ivaDeLinea: string }>[];
  totalCalculado: string;
  totalSegunFactura: string;
  totalCoincide: boolean;
}>;
