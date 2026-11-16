import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { formatearCantidad, formatearFecha, formatearImporte } from "../../patrones/formato-fiscal";
import { cantidadConUnidad, marcaDeEstado } from "./modelo-de-ordenes";

/**
 * El modelo de vista de la ficha de una orden de producción (maqueta aprobada `produccion.html`, 09/11/2026, función `vOrden`): de lo que entrega la composición, lo que se ve y NADA
 * más. Puro: sin React ni servidor. Arriba, el producto con su cantidad (la esperada; la obtenida si ya se cerró) y, si se cerró o se anuló, el lote, el vencimiento y el costo por
 * unidad; después «Consume» con lo esperado (o lo real, si ya se cerró). Los textos salen del catálogo (`produccion.*`, ya aprobados); no se arma ningún texto nuevo.
 *
 * Lo que NO se arma, a propósito (no existe o no tiene texto aprobado; va a preguntas pendientes): «En stock» y «Falta» por renglón (la ficha no los trae todavía), «Cerrar con lo real»
 * (otro tramo), la merma («Esperado x · obtenido y») y la nota «Orden anulada». El costo por unidad sale solo si la consulta lo trajo (solo con `costos.ver`): sin él no hay fila.
 * Los botones nacen cerrados: «Cancelar la orden» solo en una abierta y «Anular la orden» solo en una cerrada, y solo si el servidor ya resolvió que la persona puede (todo lo que no sea
 * exactamente `true` no lo muestra). Ocultar no es autorizar: cada acción vuelve a pasar por el guard.
 */

/** La ficha como la entrega la composición (la misma forma, sin importar de dónde venga; la UI no importa la composición). */
export type OrdenDeLaFicha = Readonly<{
  id: string;
  numero: number;
  estado: string;
  nombre: string;
  unidadId: string;
  cantidadEsperada: string;
  cantidadObtenida: string | null;
  /** `esperado − obtenido`; `null` hasta cerrar. */
  mermaDeLote: string | null;
  recetaCambiada: boolean;
  vence: string | null;
  lote: string | null;
  renglones: readonly Readonly<{
    nombre: string;
    esperado: string;
    real: string | null;
    unidadId: string;
  }>[];
  costo?: Readonly<{ costoUnitario: string | null; costoEstado: string | null }> | undefined;
}>;

/** Qué deja hacer hoy el servidor, ya resuelto (`accionesDeProduccion`). */
export type AccionesDeLaOrden = Readonly<{ cancelar: boolean; anular: boolean }>;

type DatoArmado = Readonly<{ rotulo: string; valor: string }>;

type AccionArmada = Readonly<{
  tipo: "CANCELAR" | "ANULAR";
  /** El botón de la ficha y el de la hoja: el mismo verbo («Anular la orden»). */
  boton: string;
  /** El título de la hoja («Anular la orden 13»). */
  titulo: string;
  motivo: string;
  cancelar: string;
  cerrar: string;
  /** «Se devuelve lo consumido y se saca lo producido…»: solo al anular (cancelar no devuelve nada). */
  explicacion: string | null;
  sinConexion: string;
}>;

export type OrdenArmada = Readonly<{
  /** «Orden 14». */
  titulo: string;
  estado: ReturnType<typeof marcaDeEstado>;
  producto: Readonly<{ nombre: string; cantidad: string }>;
  /** «Orden anulada»: solo en una anulada. */
  avisoDeAnulada: string | null;
  /** «La receta cambió desde que abriste la orden»: solo en una abierta. */
  avisoDeReceta: string | null;
  /** Lote, vencimiento y costo por unidad: solo lo que hay. */
  datos: readonly DatoArmado[];
  consume: Readonly<{
    titulo: string;
    filas: readonly Readonly<{ nombre: string; cantidad: string }>[];
  }>;
  accion: AccionArmada | null;
}>;

const esDeLoCerrado = (estado: string): boolean => estado === "CERRADA" || estado === "ANULADA";

function accionDe(
  orden: OrdenDeLaFicha,
  acciones: AccionesDeLaOrden,
  d: DiccionarioResuelto,
): AccionArmada | null {
  const numero = String(orden.numero);
  const comun = {
    motivo: texto(d, "stock.accion.motivo"),
    cancelar: texto(d, "catalogo.accion.cancelar"),
    cerrar: texto(d, "vidriera.producto.cerrar"),
    sinConexion: texto(d, "produccion.accion.sin_conexion"),
  };
  if (orden.estado === "ABIERTA" && acciones.cancelar === true) {
    const boton = texto(d, "produccion.accion.cancelar_la_orden");
    return { tipo: "CANCELAR", boton, titulo: `${boton} ${numero}`, explicacion: null, ...comun };
  }
  if (orden.estado === "CERRADA" && acciones.anular === true) {
    const boton = texto(d, "produccion.accion.anular_la_orden");
    return {
      tipo: "ANULAR",
      boton,
      titulo: `${boton} ${numero}`,
      explicacion: texto(d, "produccion.accion.anular_explicacion"),
      ...comun,
    };
  }
  return null;
}

/** El costo por unidad: el importe con formato, o «Sin costo» si la orden quedó sin costo. Solo con `costos.ver` (la consulta decide). */
function costoDe(orden: OrdenDeLaFicha, d: DiccionarioResuelto): DatoArmado | null {
  if (orden.costo === undefined) return null;
  const { costoUnitario, costoEstado } = orden.costo;
  return {
    rotulo: texto(d, "produccion.cierre.costo_por_unidad"),
    valor:
      costoUnitario === null || costoEstado === "SIN_COSTO"
        ? texto(d, "stock.accion.sin_costo")
        : formatearImporte(costoUnitario),
  };
}

/** La diferencia de rendimiento del lote (esperado menos obtenido) solo se dice si hay una (maqueta: «− 4 unidades»). */
const hayMerma = (merma: string | null): merma is string =>
  merma !== null && !merma.startsWith("-") && /[1-9]/.test(merma);

/** «Esperado 100 · obtenido 96» con lo que faltó a la derecha («− 4 Unidad»); solo con una orden cerrada o anulada. */
function mermaDe(orden: OrdenDeLaFicha, d: DiccionarioResuelto): DatoArmado | null {
  if (!hayMerma(orden.mermaDeLote) || orden.cantidadObtenida === null) return null;
  return {
    rotulo: texto(d, "produccion.cierre.esperado_obtenido", {
      esperado: formatearCantidad(orden.cantidadEsperada),
      obtenido: formatearCantidad(orden.cantidadObtenida),
    }),
    valor: `− ${cantidadConUnidad(orden.mermaDeLote, orden.unidadId, d)}`,
  };
}

export function armarLaOrden(
  orden: OrdenDeLaFicha,
  acciones: AccionesDeLaOrden,
  d: DiccionarioResuelto = {},
): OrdenArmada {
  const cerrada = esDeLoCerrado(orden.estado);
  const cantidadDelProducto =
    cerrada && orden.cantidadObtenida !== null ? orden.cantidadObtenida : orden.cantidadEsperada;
  const costo = cerrada ? costoDe(orden, d) : null;
  const merma = cerrada ? mermaDe(orden, d) : null;
  return {
    titulo: `${texto(d, "produccion.pantalla.orden")} ${String(orden.numero)}`,
    estado: marcaDeEstado(orden.estado, d),
    producto: {
      nombre: orden.nombre,
      cantidad: cantidadConUnidad(cantidadDelProducto, orden.unidadId, d),
    },
    avisoDeAnulada: orden.estado === "ANULADA" ? texto(d, "produccion.orden.anulada") : null,
    avisoDeReceta:
      orden.estado === "ABIERTA" && orden.recetaCambiada
        ? texto(d, "produccion.orden.receta_cambio")
        : null,
    datos: [
      ...(cerrada && orden.lote !== null
        ? [{ rotulo: texto(d, "produccion.cierre.lote"), valor: orden.lote }]
        : []),
      ...(cerrada && orden.vence !== null
        ? [{ rotulo: texto(d, "produccion.cierre.vence"), valor: formatearFecha(orden.vence) }]
        : []),
      ...(costo === null ? [] : [costo]),
      ...(merma === null ? [] : [merma]),
    ],
    consume: {
      titulo: texto(d, cerrada ? "produccion.orden.consumio" : "produccion.orden.consume"),
      filas: orden.renglones.map((r) => ({
        nombre: r.nombre,
        cantidad: cantidadConUnidad(
          cerrada && r.real !== null ? r.real : r.esperado,
          r.unidadId,
          d,
        ),
      })),
    },
    accion: accionDe(orden, acciones, d),
  };
}
