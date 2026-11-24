import type { ClaveDeTexto } from "../../../../../../src/capacidades/vocabulario/catalogo";
import { texto } from "../../../../../../src/capacidades/vocabulario/vocabulario";
import {
  formatearFecha,
  formatearImporte,
  formatearNumeroDeDocumento,
  formatearPuntoDeVenta,
} from "../../../patrones/formato-fiscal";
import { fechaYHoraParaMostrar } from "../../../../../../src/primitivas/tiempo/instante-para-mostrar";
import { CLAVE_DE_CONDICION } from "../../facturacion/modelo-de-emision";
import { nombreDe, type TipoVisible } from "../../facturacion/modelo-del-detalle";
import { numeroImpreso } from "../lista/modelo-de-lista-de-compras";
import { RUTA_DE_COMPRAS } from "../rutas-de-compras";
import type { TextosDeProveedor } from "./textos-de-proveedor";

/**
 * El modelo de vista de la ficha del proveedor de compras (maqueta `compra.html`, estados `proveedor` y `facturas-prov`; Compras PR 4). Puro: sin React ni servidor. Lo que llega es lo que entrega el
 * servidor (`ficha-de-proveedor-web.ts`): importes como texto decimal con moneda (nunca `number`), instantes en ISO UTC. El modelo NO decide permisos ni calcula nada: muestra la lista de puntos de
 * venta y de comprobantes que dice el servidor, y los botones solo si la oferta de permisos los pide (el servidor vuelve a verificar cada acción). Sin pedidos pendientes no se dibuja el bloque.
 */

type Importe = Readonly<{ moneda: string; monto: string }>;

export type FichaDelProveedorParaLaPantalla = Readonly<{
  parteId: string;
  nombre: string | null;
  documento: Readonly<{ tipo: string; numero: string }> | null;
  condicionIva: string | null;
  letraEsperada: "A" | "B" | "C" | null;
  puntosDeVenta: readonly number[];
  comprobantes: readonly string[];
  pedidosPendientes: readonly Readonly<{
    id: string;
    objeto: "PUNTO_DE_VENTA" | "COMPROBANTE";
    valor: string;
    pedidoEn: string;
  }>[];
  queLeCompramos: readonly Readonly<{
    productoNombre: string | null;
    ultimoPrecio: Importe;
    ultimaCompraEn: string;
  }>[];
  facturas: readonly Readonly<{
    clase: string;
    tipo: string | null;
    puntoDeVenta: number | null;
    numero: number | null;
    fecha: string | null;
    total: Importe;
    anulado: boolean;
  }>[];
  tiposDeComprobante: readonly string[];
  puntoDeVentaMaximo: number;
}>;

export type AccionesDeLaFichaParaLaPantalla = Readonly<{ editar: boolean; pedir: boolean }>;

const SIN_DATO = "—";
/** Las facturas que muestra la ficha; el resto, con «Ver todas». */
const FACTURAS_EN_LA_FICHA = 3;

export const rutaDeLaFichaDelProveedor = (parteId: string): string =>
  `${RUTA_DE_COMPRAS}/proveedores/${parteId}`;
export const rutaDeLasFacturasDelProveedor = (parteId: string): string =>
  `${rutaDeLaFichaDelProveedor(parteId)}/facturas`;

/** El nombre del tipo de comprobante («Factura A», «Nota de crédito B»), con el texto del catálogo. */
export const nombreDelTipo = (tipo: string): string => nombreDe({}, tipo as TipoVisible, null);

/** Cuántos dígitos tiene el mayor punto de venta: el largo del campo sale del dominio, no se escribe a mano. */
export const digitosDelPuntoDeVenta = (maximo: number): number => String(maximo).length;

export type FilaDeFactura = Readonly<{
  clave: string;
  nombre: string;
  segunda: string;
  total: string;
}>;

export function armarLasFacturas(
  facturas: FichaDelProveedorParaLaPantalla["facturas"],
  textos: TextosDeProveedor,
): readonly FilaDeFactura[] {
  return facturas.map((f, i) => {
    const nombre =
      f.tipo === null || f.puntoDeVenta === null || f.numero === null
        ? SIN_DATO
        : nombreDe({}, f.tipo as TipoVisible, numeroImpreso(f.puntoDeVenta, f.numero));
    const segunda = [
      f.fecha === null ? null : formatearFecha(f.fecha),
      f.anulado ? textos.anulada : null,
    ]
      .filter((x): x is string => x !== null)
      .join(" · ");
    const monto = formatearImporte(f.total.monto);
    return {
      clave: `${String(i)}-${nombre}`,
      nombre,
      segunda,
      total: f.clase === "NOTA_DE_CREDITO" ? `−${monto}` : monto,
    };
  });
}

export type FichaDeProveedorArmada = Readonly<{
  titulo: string;
  volver: Readonly<{ texto: string; href: string }>;
  datos: Readonly<{
    titulo: string;
    nombre: string;
    cuit: string | null;
    condicion: string | null;
  }>;
  comprobantes: Readonly<{
    titulo: string;
    valor: string;
    porCondicion: string;
    /** Los que ya están (para dejar de usar): `[tipo, nombre]`. */
    quitables: readonly Readonly<{ tipo: string; nombre: string }>[];
    /** Los que se pueden agregar: los de la lista cerrada que todavía no están. */
    agregables: readonly Readonly<{ valor: string; etiqueta: string }>[];
  }>;
  puntosDeVenta: Readonly<{
    titulo: string;
    vacio: string | null;
    numeros: readonly Readonly<{ numero: number; texto: string }>[];
  }>;
  pedidos: Readonly<{
    titulo: string;
    filas: readonly Readonly<{ id: string; nombre: string; fecha: string }>[];
  }> | null;
  queLeCompramos: Readonly<{
    titulo: string;
    vacio: string | null;
    filas: readonly Readonly<{ clave: string; nombre: string; precio: string; ultima: string }>[];
  }>;
  facturas: Readonly<{
    titulo: string;
    vacio: string | null;
    filas: readonly FilaDeFactura[];
    verTodas: Readonly<{ texto: string; href: string }> | null;
  }>;
}>;

/** «Por ser responsable inscripto emite A.» si la condición define la letra; si no, «Su condición no define la letra: se elige a mano.». */
function porCondicion(ficha: FichaDelProveedorParaLaPantalla, textos: TextosDeProveedor): string {
  const condicion = ficha.condicionIva;
  const clave =
    condicion === null
      ? undefined
      : (CLAVE_DE_CONDICION as Record<string, ClaveDeTexto>)[condicion];
  if (ficha.letraEsperada === null || clave === undefined) {
    return `${textos.condicionNoDefineLaLetra}.`;
  }
  return `${textos.porSer} ${texto({}, clave)} ${textos.emite} ${ficha.letraEsperada}.`;
}

export function armarLaFichaDelProveedor(
  ficha: FichaDelProveedorParaLaPantalla,
  textos: TextosDeProveedor,
): FichaDeProveedorArmada {
  const nombre = ficha.nombre ?? SIN_DATO;
  const claveDeCondicion =
    ficha.condicionIva === null
      ? undefined
      : (CLAVE_DE_CONDICION as Record<string, ClaveDeTexto>)[ficha.condicionIva];
  const nombreDelPedido = (p: FichaDelProveedorParaLaPantalla["pedidosPendientes"][number]) =>
    p.objeto === "PUNTO_DE_VENTA"
      ? `${textos.puntoDeVenta} ${numeroDePuntoDeVenta(p.valor)}`
      : nombreDelTipo(p.valor);
  const facturas = armarLasFacturas(ficha.facturas, textos);
  return {
    titulo: nombre,
    volver: { texto: textos.volver, href: RUTA_DE_COMPRAS },
    datos: {
      titulo: textos.datosDelDirectorio,
      nombre,
      cuit:
        ficha.documento === null
          ? null
          : `${textos.cuit} ${formatearNumeroDeDocumento(ficha.documento.tipo, ficha.documento.numero)}`,
      condicion: claveDeCondicion === undefined ? null : texto({}, claveDeCondicion),
    },
    comprobantes: {
      titulo: textos.comprobantesQueEmite,
      valor:
        ficha.comprobantes.length === 0
          ? textos.ningunoCargado
          : ficha.comprobantes.map(nombreDelTipo).join(", "),
      porCondicion: porCondicion(ficha, textos),
      quitables: ficha.comprobantes.map((tipo) => ({ tipo, nombre: nombreDelTipo(tipo) })),
      agregables: ficha.tiposDeComprobante
        .filter((tipo) => !ficha.comprobantes.includes(tipo))
        .map((tipo) => ({ valor: tipo, etiqueta: nombreDelTipo(tipo) })),
    },
    puntosDeVenta: {
      titulo: textos.puntosDeVenta,
      vacio: ficha.puntosDeVenta.length === 0 ? textos.sinPuntosDeVenta : null,
      numeros: ficha.puntosDeVenta.map((numero) => ({
        numero,
        texto: numeroDePuntoDeVenta(String(numero)),
      })),
    },
    pedidos:
      ficha.pedidosPendientes.length === 0
        ? null
        : {
            titulo: textos.pedidosPendientes,
            filas: ficha.pedidosPendientes.map((p) => ({
              id: p.id,
              nombre: nombreDelPedido(p),
              fecha: `${textos.pedidoEl} ${fechaYHoraParaMostrar(p.pedidoEn)}`,
            })),
          },
    queLeCompramos: {
      titulo: textos.queLeCompramos,
      vacio: ficha.queLeCompramos.length === 0 ? textos.todaviaNoSeLeComproNada : null,
      filas: ficha.queLeCompramos.map((o, i) => ({
        clave: `${String(i)}-${o.productoNombre ?? ""}`,
        nombre: o.productoNombre ?? SIN_DATO,
        precio: formatearImporte(o.ultimoPrecio.monto),
        ultima: `${textos.ultimaCompra}: ${fechaYHoraParaMostrar(o.ultimaCompraEn)}`,
      })),
    },
    facturas: {
      titulo: `${textos.facturasYNotas} (${String(facturas.length)})`,
      vacio: facturas.length === 0 ? textos.todaviaNoTieneFacturas : null,
      filas: facturas.slice(0, FACTURAS_EN_LA_FICHA),
      verTodas:
        facturas.length === 0
          ? null
          : { texto: textos.verTodas, href: rutaDeLasFacturasDelProveedor(ficha.parteId) },
    },
  };
}

/** El número del punto de venta como se imprime (el formato de las facturas). */
const numeroDePuntoDeVenta = (numero: string): string => formatearPuntoDeVenta(Number(numero));
