import { formatearCantidad, formatearFecha } from "../../../patrones/formato-fiscal";
import { numeroImpreso } from "../lista/modelo-de-lista-de-compras";
import { nombreDeUnidad } from "../nueva/modelo-de-nueva-compra";
import { direccionDeLaListaDeRecepciones, rutaDeLaRecepcion } from "../rutas-de-compras";
import type { TextosDeRecepciones } from "./textos-de-recepciones";

/**
 * El modelo de vista de «Recepciones» (Compras 4; maqueta `compra-recibir.html`): cada fila de la lista, el detalle de una recepción y lo que se ofrece según el permiso. Puro: sin React ni servidor.
 * Lo que llega es lo que entrega el servidor (`recepciones-web.ts`): cantidades como texto decimal, fechas de negocio `AAAA-MM-DD`. El modelo NO calcula nada: muestra lo que devolvió el servidor. NO hay
 * precios ni costos (la recepción separada no los pide). Todo dato ausente es «—», nunca cero.
 */

type EstadoDeRecepcion =
  | "PENDIENTE_DE_CONFIRMAR"
  | "ANULADA"
  | "RECIBIDA_SIN_FACTURAR"
  | "FACTURADA_EN_PARTE"
  | "RECIBIDA_Y_FACTURADA";

type Remito = Readonly<{ puntoDeVenta: number; numero: number; fecha: string }>;

export type ListaDeRecepcionesParaLaPantalla = Readonly<{
  recepciones: readonly Readonly<{
    recepcionId: string;
    numero: number;
    proveedor: string | null;
    fechaNegocio: string;
    remito: Remito | null;
    estado: EstadoDeRecepcion;
  }>[];
  siguiente: string | null;
}>;

export type FichaDeRecepcionParaLaPantalla = Readonly<{
  recepcionId: string;
  numero: number;
  proveedor: string | null;
  fechaNegocio: string;
  remito: Remito | null;
  estado: EstadoDeRecepcion;
  motivoDeAnulacion: string | null;
  lineas: readonly Readonly<{
    numero: number;
    producto: string | null;
    cantidadDeCompra: string;
    unidadDeCompraId: string;
    cantidadEnStock: string;
    unidadDeStockId: string | null;
  }>[];
}>;

/** Lo que la persona puede hacer con una recepción; todo nace cerrado. Solo ayuda para ofrecer o esconder botones: el servidor vuelve a decidir al actuar. */
export type AccionesDeLaRecepcion = Readonly<{
  registrar: boolean;
  confirmar: boolean;
  anular: boolean;
}>;
export const SIN_ACCIONES_DE_LA_RECEPCION: AccionesDeLaRecepcion = {
  registrar: false,
  confirmar: false,
  anular: false,
};

const SIN_DATO = "—";

/** El texto del estado de una recepción (aprobado o por aprobar: ver la ficha de la pantalla). */
function textoDelEstado(estado: EstadoDeRecepcion, textos: TextosDeRecepciones): string {
  switch (estado) {
    case "PENDIENTE_DE_CONFIRMAR":
      return textos.porConfirmar;
    case "ANULADA":
      return textos.anulada;
    case "RECIBIDA_SIN_FACTURAR":
      return textos.recibidaSinFacturar;
    case "FACTURADA_EN_PARTE":
      return textos.facturadaEnParte;
    case "RECIBIDA_Y_FACTURADA":
      return textos.facturada;
  }
}

const remitoParaMostrar = (remito: Remito | null): string =>
  remito === null
    ? ""
    : `${numeroImpreso(remito.puntoDeVenta, remito.numero)} · ${formatearFecha(remito.fecha)}`;

type FilaArmada = Readonly<{
  id: string;
  href: string;
  /** «Recepción 14 · Distribuidora Central». */
  titulo: string;
  /** El estado en texto y la fecha: «Por confirmar · 24/11/2026». */
  segunda: string;
  nombreAccesible: string;
}>;

export type ListaDeRecepcionesArmada = Readonly<{
  filas: readonly FilaArmada[];
  /** «Sin resultados» si no hay filas; `null` si las hay. */
  vacio: string | null;
  paginaSiguiente: Readonly<{ texto: string; href: string }> | null;
}>;

export function armarLaListaDeRecepciones(
  lista: ListaDeRecepcionesParaLaPantalla,
  textos: TextosDeRecepciones,
): ListaDeRecepcionesArmada {
  const filas = lista.recepciones.map((r): FilaArmada => {
    const titulo = `${textos.recepcion} ${String(r.numero)} · ${r.proveedor ?? SIN_DATO}`;
    const segunda = `${textoDelEstado(r.estado, textos)} · ${formatearFecha(r.fechaNegocio)}`;
    return {
      id: r.recepcionId,
      href: rutaDeLaRecepcion(r.recepcionId),
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
        : {
            texto: textos.paginaSiguiente,
            href: direccionDeLaListaDeRecepciones(lista.siguiente),
          },
  };
}

export type FichaDeRecepcionArmada = Readonly<{
  /** «Recepción 14». */
  titulo: string;
  estado: string;
  /** El estado es el de una anulada: se marca con la insignia de peligro. */
  anulada: boolean;
  proveedorYFecha: string;
  remito: Readonly<{ rotulo: string; valor: string }>;
  motivoDeAnulacion: Readonly<{ rotulo: string; texto: string }> | null;
  lineas: readonly Readonly<{ clave: string; nombre: string; cantidad: string }>[];
  /** «Confirmar recepción» y «Anular recepción» solo se ofrecen con la recepción «Por confirmar» y el permiso. */
  confirmar: boolean;
  anular: boolean;
}>;

/** La ficha armada. Una línea muestra lo recibido en la unidad en que se compró («2 kg»); nunca un precio ni un costo. */
export function armarLaFichaDeRecepcion(
  ficha: FichaDeRecepcionParaLaPantalla,
  textos: TextosDeRecepciones,
  acciones: AccionesDeLaRecepcion = SIN_ACCIONES_DE_LA_RECEPCION,
): FichaDeRecepcionArmada {
  const pendiente = ficha.estado === "PENDIENTE_DE_CONFIRMAR";
  return {
    titulo: `${textos.recepcion} ${String(ficha.numero)}`,
    estado: textoDelEstado(ficha.estado, textos),
    anulada: ficha.estado === "ANULADA",
    proveedorYFecha: `${ficha.proveedor ?? SIN_DATO} · ${formatearFecha(ficha.fechaNegocio)}`,
    remito: {
      rotulo: ficha.remito === null ? textos.sinRemito : textos.remitoDelProveedor,
      valor: remitoParaMostrar(ficha.remito),
    },
    motivoDeAnulacion:
      ficha.estado === "ANULADA" && ficha.motivoDeAnulacion !== null
        ? { rotulo: textos.motivo, texto: ficha.motivoDeAnulacion }
        : null,
    lineas: ficha.lineas.map((l) => ({
      clave: String(l.numero),
      nombre: l.producto ?? SIN_DATO,
      cantidad:
        `${formatearCantidad(l.cantidadDeCompra)} ${nombreDeUnidad(l.unidadDeCompraId)}`.trimEnd(),
    })),
    confirmar: pendiente && acciones.confirmar,
    anular: pendiente && acciones.anular,
  };
}
