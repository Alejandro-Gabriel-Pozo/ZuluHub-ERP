import {
  formatearCantidad,
  formatearFecha,
  formatearImporte,
} from "../../../patrones/formato-fiscal";
import { nombreDeLaFactura } from "../lista/modelo-de-lista-de-compras";
import { nombreDeUnidad } from "../nueva/modelo-de-nueva-compra";
import {
  direccionDeLaListaDeFacturas,
  rutaDeLaFactura,
  rutaDeLasNotas,
  rutaDeReemplazar,
} from "../rutas-de-compras";
import type { TextosDeFacturas } from "./textos-de-facturas";

/**
 * El modelo de vista de «Facturas» (Compras 4; maqueta `compra-conciliar.html`): cada fila de la lista, el detalle de una factura y lo que se ofrece según el permiso. Puro: sin React ni servidor. Lo que llega es lo
 * que entrega el servidor (`facturas-web.ts`): cantidades e importes como texto decimal, fechas de negocio `AAAA-MM-DD`. El modelo NO calcula nada (ni saldos ni estados): muestra lo que devolvió el servidor.
 * Todo dato ausente es «—», nunca cero.
 */

type EstadoDeFactura =
  "ANULADA" | "FACTURADA_FALTA_RECIBIR" | "FALTA_CONCILIAR" | "CONCILIADA_EN_PARTE" | "CONCILIADA";

export type ListaDeFacturasParaLaPantalla = Readonly<{
  facturas: readonly Readonly<{
    comprobanteId: string;
    proveedor: string | null;
    tipo: string | null;
    puntoDeVenta: number | null;
    numero: number | null;
    fechaNegocio: string;
    totalSegunFactura: string;
    estado: EstadoDeFactura;
  }>[];
  siguiente: string | null;
}>;

export type FichaDeFacturaParaLaPantalla = Readonly<{
  comprobanteId: string;
  proveedor: string | null;
  tipo: string | null;
  puntoDeVenta: number | null;
  numero: number | null;
  fechaNegocio: string;
  totalSegunFactura: string;
  estado: EstadoDeFactura;
  lineas: readonly Readonly<{
    numero: number;
    producto: string | null;
    unidadDeStockId: string | null;
    facturada: string;
    conciliada: string;
    recibidoPorSucursal: readonly Readonly<{
      sucursalId: string;
      recibida: string;
      sinConciliar: string;
    }>[];
    costos: readonly Readonly<{
      recepcionId: string;
      recepcionNumero: number;
      linea: number;
      sucursalId: string;
      recibida: string;
      estado: "SE_PUEDE_TOMAR" | "TOMADO";
      precioNeto: string;
    }>[];
  }>[];
  conciliaciones: readonly Readonly<{
    conciliacionId: string;
    fechaNegocio: string;
    anulada: boolean;
    anulableEnAlcance: boolean;
    asignaciones: readonly Readonly<{
      lineaDeFactura: number;
      recepcionNumero: number;
      sucursalId: string;
      lineaDeRecepcion: number;
      cantidad: string;
    }>[];
  }>[];
}>;

/** Una sucursal con su nombre, de las que la persona puede elegir (el detalle muestra solo lo de ellas). */
export type SucursalConNombre = Readonly<{ id: string; nombre: string }>;

/** Lo que la persona puede hacer con una factura; todo nace cerrado. Solo ayuda para ofrecer o esconder botones: el servidor vuelve a decidir al actuar. */
export type AccionesDeLaFactura = Readonly<{
  cargar: boolean;
  verConciliaciones: boolean;
  conciliar: boolean;
  anularConciliacion: boolean;
  tomarElCosto: boolean;
  /** Ver las notas de la factura (las dos acciones de ver notas: la lectura las pide). */
  verNotas: boolean;
  /** Reemplazar el comprobante (`comprobantes_de_proveedor.reemplazar`). */
  reemplazar: boolean;
}>;
export const SIN_ACCIONES_DE_LA_FACTURA: AccionesDeLaFactura = {
  cargar: false,
  verConciliaciones: false,
  conciliar: false,
  anularConciliacion: false,
  tomarElCosto: false,
  verNotas: false,
  reemplazar: false,
};

const SIN_DATO = "—";
const LETRAS: Readonly<Record<string, "A" | "B" | "C">> = {
  FACTURA_A: "A",
  FACTURA_B: "B",
  FACTURA_C: "C",
};

/** El texto del estado de una factura (aprobado o por aprobar: ver la ficha de la pantalla). */
function textoDelEstado(estado: EstadoDeFactura, textos: TextosDeFacturas): string {
  switch (estado) {
    case "ANULADA":
      return textos.anulada;
    case "FACTURADA_FALTA_RECIBIR":
      return textos.facturadaFaltaRecibir;
    case "FALTA_CONCILIAR":
      return textos.faltaConciliar;
    case "CONCILIADA_EN_PARTE":
      return textos.conciliadaEnParte;
    case "CONCILIADA":
      return textos.todoCoincide;
  }
}

/** «Factura A 00004-00005678»; una factura sin tipo o sin número legibles se muestra «—», nunca inventada. */
export function nombreDeLaFacturaDeLaEmpresa(
  f: Readonly<{ tipo: string | null; puntoDeVenta: number | null; numero: number | null }>,
): string {
  const letra = f.tipo === null ? undefined : LETRAS[f.tipo];
  return letra === undefined || f.puntoDeVenta === null || f.numero === null
    ? SIN_DATO
    : nombreDeLaFactura({ letra, puntoDeVenta: f.puntoDeVenta, numero: f.numero });
}

/** El nombre de una sucursal; una que no está entre las de quien mira se muestra «—» (no se inventa). */
export const nombreDeLaSucursal = (sucursales: readonly SucursalConNombre[], id: string): string =>
  sucursales.find((s) => s.id === id)?.nombre ?? SIN_DATO;

/** «1,5 kg»: la cantidad en la unidad de stock del producto; sin unidad conocida, solo la cantidad. */
export const cantidadConUnidad = (cantidad: string, unidadDeStockId: string | null): string =>
  `${formatearCantidad(cantidad)} ${unidadDeStockId === null ? "" : nombreDeUnidad(unidadDeStockId)}`.trimEnd();

type FilaArmada = Readonly<{
  id: string;
  href: string;
  /** «Factura A 00004-00005678 · Distribuidora Central». */
  titulo: string;
  /** El estado en texto, la fecha y el total: «Falta conciliar · 24/11/2026 · $ 1.210,00». */
  segunda: string;
  nombreAccesible: string;
}>;

export type ListaDeFacturasArmada = Readonly<{
  filas: readonly FilaArmada[];
  /** «Sin resultados» si no hay filas; `null` si las hay. */
  vacio: string | null;
  paginaSiguiente: Readonly<{ texto: string; href: string }> | null;
}>;

export function armarLaListaDeFacturas(
  lista: ListaDeFacturasParaLaPantalla,
  textos: TextosDeFacturas,
): ListaDeFacturasArmada {
  const filas = lista.facturas.map((f): FilaArmada => {
    const titulo = `${nombreDeLaFacturaDeLaEmpresa(f)} · ${f.proveedor ?? SIN_DATO}`;
    const segunda = [
      textoDelEstado(f.estado, textos),
      formatearFecha(f.fechaNegocio),
      formatearImporte(f.totalSegunFactura),
    ].join(" · ");
    return {
      id: f.comprobanteId,
      href: rutaDeLaFactura(f.comprobanteId),
      titulo,
      segunda,
      nombreAccesible: [titulo, segunda].join(", "),
    };
  });
  return {
    filas,
    vacio: filas.length === 0 ? textos.sinResultados : null,
    paginaSiguiente:
      lista.siguiente === null
        ? null
        : { texto: textos.paginaSiguiente, href: direccionDeLaListaDeFacturas(lista.siguiente) },
  };
}

export type FichaDeFacturaArmada = Readonly<{
  /** «Factura A 00004-00005678». */
  titulo: string;
  estado: string;
  anulada: boolean;
  proveedorYFecha: string;
  total: Readonly<{ rotulo: string; valor: string }>;
  lineas: readonly Readonly<{
    clave: string;
    nombre: string;
    facturado: Readonly<{ rotulo: string; valor: string }>;
    conciliado: Readonly<{ rotulo: string; valor: string }>;
    /** Lo recibido (CONFIRMADO) por cada sucursal del alcance: «Sucursal Centro: 40 kg». */
    recibido: Readonly<{
      rotulo: string;
      porSucursal: readonly Readonly<{ clave: string; texto: string }>[];
    }>;
    /** El costo de cada línea recibida que esta línea cubre entera y sola: «Tomar el costo de la factura» (con permiso) o, si ya se tomó, el «Precio neto» tomado. */
    costos: readonly Readonly<{
      clave: string;
      recepcionId: string;
      linea: number;
      /** El nombre de la sucursal de la línea recibida (lo recibido ya está arriba). */
      titulo: string;
      /** «Norte · Precio neto: $ 1.000,00» si ya se tomó; `null` si todavía no. */
      tomado: string | null;
      /** El botón se ofrece: se puede tomar y quien mira tiene el permiso. */
      sePuedeTomar: boolean;
      /** Lo que muestra la hoja del botón, ya con el precio de la factura que se va a tomar (no se escribe nada). */
      hoja: Readonly<{ producto: string; sucursalYCantidad: string; precioNeto: string }>;
    }>[];
  }>[];
  conciliaciones: Readonly<{
    titulo: string;
    filas: readonly Readonly<{
      id: string;
      texto: string;
      anulada: boolean;
      /** «Anular conciliación» se ofrece en esta fila (permiso, no anulada y con alcance sobre cada sucursal que repartió). */
      anulable: boolean;
    }>[];
  }> | null;
  /** Adónde lleva «Notas de crédito»: solo con el permiso de ver las notas; `null` si no se ofrece. */
  notas: Readonly<{ texto: string; href: string }> | null;
  /** «Reemplazar» se ofrece (permiso y factura no anulada); lleva a «Reemplazar el comprobante». Los frenos (pago, conciliaciones, notas) los muestra esa pantalla y los revalida el servidor. */
  reemplazar: Readonly<{ texto: string; href: string }> | null;
  /** «Conciliar» se ofrece (permiso y el estado de la factura que dice el servidor: «Falta conciliar» o «Conciliada en parte»; la pantalla no recalcula saldos). */
  conciliar: boolean;
}>;

/** La ficha armada. El estado y los saldos los dice el servidor; la pantalla solo los ordena. */
export function armarLaFichaDeFactura(
  ficha: FichaDeFacturaParaLaPantalla,
  textos: TextosDeFacturas,
  sucursales: readonly SucursalConNombre[],
  acciones: AccionesDeLaFactura = SIN_ACCIONES_DE_LA_FACTURA,
): FichaDeFacturaArmada {
  return {
    titulo: nombreDeLaFacturaDeLaEmpresa(ficha),
    estado: textoDelEstado(ficha.estado, textos),
    anulada: ficha.estado === "ANULADA",
    proveedorYFecha: `${ficha.proveedor ?? SIN_DATO} · ${formatearFecha(ficha.fechaNegocio)}`,
    total: { rotulo: textos.totalSegunLaFactura, valor: formatearImporte(ficha.totalSegunFactura) },
    lineas: ficha.lineas.map((l) => ({
      clave: String(l.numero),
      nombre: l.producto ?? SIN_DATO,
      facturado: {
        rotulo: textos.facturado,
        valor: cantidadConUnidad(l.facturada, l.unidadDeStockId),
      },
      conciliado: {
        rotulo: textos.conciliado,
        valor: cantidadConUnidad(l.conciliada, l.unidadDeStockId),
      },
      recibido: {
        rotulo: textos.recibido,
        porSucursal: l.recibidoPorSucursal.map((r) => ({
          clave: r.sucursalId,
          texto: `${nombreDeLaSucursal(sucursales, r.sucursalId)}: ${cantidadConUnidad(r.recibida, l.unidadDeStockId)}`,
        })),
      },
      costos: l.costos.map((k) => {
        const sucursal = nombreDeLaSucursal(sucursales, k.sucursalId);
        const precioNeto = `${textos.precioNeto}: ${formatearImporte(k.precioNeto)}`;
        return {
          clave: `${k.recepcionId}:${String(k.linea)}`,
          recepcionId: k.recepcionId,
          linea: k.linea,
          titulo: sucursal,
          tomado: k.estado === "TOMADO" ? `${sucursal} · ${precioNeto}` : null,
          sePuedeTomar: k.estado === "SE_PUEDE_TOMAR" && acciones.tomarElCosto,
          hoja: {
            producto: l.producto ?? SIN_DATO,
            sucursalYCantidad: `${sucursal}: ${cantidadConUnidad(k.recibida, l.unidadDeStockId)}`,
            precioNeto,
          },
        };
      }),
    })),
    conciliaciones: acciones.verConciliaciones
      ? {
          titulo: textos.conciliaciones,
          filas: ficha.conciliaciones.map((c) => ({
            id: c.conciliacionId,
            texto: [
              formatearFecha(c.fechaNegocio),
              ...c.asignaciones.map(
                (a) =>
                  `${nombreDeLaSucursal(sucursales, a.sucursalId)}: ${formatearCantidad(a.cantidad)}`,
              ),
              ...(c.anulada ? [textos.anulada] : []),
            ].join(" · "),
            anulada: c.anulada,
            anulable: acciones.anularConciliacion && !c.anulada && c.anulableEnAlcance,
          })),
        }
      : null,
    notas: acciones.verNotas
      ? { texto: textos.notasDeCredito, href: rutaDeLasNotas(ficha.comprobanteId) }
      : null,
    reemplazar:
      acciones.reemplazar && ficha.estado !== "ANULADA"
        ? { texto: textos.reemplazar, href: rutaDeReemplazar(ficha.comprobanteId) }
        : null,
    conciliar:
      acciones.conciliar &&
      (ficha.estado === "FALTA_CONCILIAR" || ficha.estado === "CONCILIADA_EN_PARTE"),
  };
}
