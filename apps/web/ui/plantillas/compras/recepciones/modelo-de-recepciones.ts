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

/** Las causas de una corrección de lo recibido, como las entrega el servidor (la lista cerrada vive una vez, en el módulo de compras: la página se la pasa a la pantalla y el compilador comprueba que coincidan). */
export type CausaDeCorreccion = "ERROR_DE_CARGA" | "REPARTO_INTERNO" | "FALTANTE_DEL_PROVEEDOR";

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
    /** Lo recibido que rige hoy (ya con las correcciones), en la unidad de stock. */
    cantidadRecibida: string;
    /** La versión que se devuelve al corregir: cuántas correcciones tiene la línea. */
    correccionesVistas: number;
    correcciones: readonly Readonly<{
      numero: number;
      cantidadAnterior: string;
      cantidadNueva: string;
      causa: CausaDeCorreccion;
      nota: string | null;
    }>[];
  }>[];
}>;

/** Lo que la persona puede hacer con una recepción; todo nace cerrado. Solo ayuda para ofrecer o esconder botones: el servidor vuelve a decidir al actuar. */
export type AccionesDeLaRecepcion = Readonly<{
  registrar: boolean;
  confirmar: boolean;
  anular: boolean;
  corregir: boolean;
}>;
export const SIN_ACCIONES_DE_LA_RECEPCION: AccionesDeLaRecepcion = {
  registrar: false,
  confirmar: false,
  anular: false,
  corregir: false,
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
  lineas: readonly Readonly<{
    clave: string;
    nombre: string;
    cantidad: string;
    /** Los datos de «Corregir lo recibido» de la línea; `null` si no se ofrece (la recepción no está confirmada o falta el permiso). */
    corregir: Readonly<{
      linea: number;
      /** Lo recibido que rige hoy, en la unidad de stock («1.500 g»). */
      hoy: string;
      correccionesVistas: number;
    }> | null;
  }>[];
  /** «Correcciones»: lo que se corrigió, de la primera a la última; `null` si no se corrigió nada. */
  correcciones: Readonly<{
    titulo: string;
    filas: readonly Readonly<{ clave: string; texto: string }>[];
  }> | null;
  /** «Confirmar recepción» y «Anular recepción» solo se ofrecen con la recepción «Por confirmar» y el permiso. */
  confirmar: boolean;
  anular: boolean;
}>;

const textoDeLaCausa = (causa: CausaDeCorreccion, textos: TextosDeRecepciones): string => {
  switch (causa) {
    case "ERROR_DE_CARGA":
      return textos.causaErrorDeCarga;
    case "REPARTO_INTERNO":
      return textos.causaRepartoInterno;
    case "FALTANTE_DEL_PROVEEDOR":
      return textos.causaFaltanteDelProveedor;
  }
};

/** Una cantidad de stock con su unidad: «1.500 g». */
const enStock = (cantidad: string, unidadDeStockId: string | null): string =>
  `${formatearCantidad(cantidad)} ${unidadDeStockId === null ? "" : nombreDeUnidad(unidadDeStockId)}`.trimEnd();

/** La ficha armada. Una línea muestra lo recibido en la unidad en que se compró («2 kg»); nunca un precio ni un costo. */
export function armarLaFichaDeRecepcion(
  ficha: FichaDeRecepcionParaLaPantalla,
  textos: TextosDeRecepciones,
  acciones: AccionesDeLaRecepcion = SIN_ACCIONES_DE_LA_RECEPCION,
): FichaDeRecepcionArmada {
  const pendiente = ficha.estado === "PENDIENTE_DE_CONFIRMAR";
  // Se corrige lo recibido de una recepción ya confirmada (la pendiente no movió stock y la anulada no recibió nada).
  const confirmada = !pendiente && ficha.estado !== "ANULADA";
  const filasDeCorreccion = ficha.lineas.flatMap((l) =>
    l.correcciones.map((c) => ({
      clave: `${String(l.numero)}-${String(c.numero)}`,
      texto: [
        `${l.producto ?? SIN_DATO} · ${enStock(c.cantidadAnterior, l.unidadDeStockId)} → ${enStock(c.cantidadNueva, l.unidadDeStockId)}`,
        textoDeLaCausa(c.causa, textos),
        c.nota,
      ]
        .filter((parte): parte is string => parte !== null)
        .join(" · "),
    })),
  );
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
      // Una línea corregida muestra lo que rige hoy (en la unidad de stock); la que no, lo que se cargó (en la unidad en que se compró).
      cantidad:
        l.correccionesVistas > 0
          ? enStock(l.cantidadRecibida, l.unidadDeStockId)
          : `${formatearCantidad(l.cantidadDeCompra)} ${nombreDeUnidad(l.unidadDeCompraId)}`.trimEnd(),
      corregir:
        confirmada && acciones.corregir
          ? {
              linea: l.numero,
              hoy: enStock(l.cantidadRecibida, l.unidadDeStockId),
              correccionesVistas: l.correccionesVistas,
            }
          : null,
    })),
    correcciones:
      filasDeCorreccion.length === 0
        ? null
        : { titulo: textos.correcciones, filas: filasDeCorreccion },
    confirmar: pendiente && acciones.confirmar,
    anular: pendiente && acciones.anular,
  };
}
