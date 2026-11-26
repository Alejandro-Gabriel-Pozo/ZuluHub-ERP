import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import { CLAVE_DE_TEXTO_DE_UNIDAD } from "../../../../../src/capacidades/vocabulario/unidades-de-medida";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import type { TonoDeEstado } from "../../componentes/Insignia";
import { formatearCantidad } from "../../patrones/formato-fiscal";
import {
  direccionDeLaLista,
  RUTA_DE_NUEVA_ORDEN,
  rutaDeLaOrden,
  type EstadoDelFiltroDeLaLista,
} from "./filtros-de-ordenes";

/**
 * El modelo de vista de la lista de órdenes de producción (maqueta aprobada `produccion.html`, 09/11/2026, función `vLista`): de lo que entrega la composición, lo que se ve en cada
 * fila y NADA más. Puro: sin React ni servidor. Una fila lleva «Orden N · producto», el estado en texto y la cantidad con su unidad; los filtros son enlaces. Los textos salen del
 * catálogo (`produccion.*`, ya aprobados); no se arma ningún texto nuevo, solo se eligen los aprobados. Sin órdenes, «Sin resultados» (`catalogo.lista.sin_resultados`, ya aprobado).
 */

const CLAVE_DE_ESTADO = {
  ABIERTA: "produccion.estado.abierta",
  CERRADA: "produccion.estado.cerrada",
  CANCELADA: "produccion.estado.cancelada",
  ANULADA: "produccion.estado.anulada",
} as const satisfies Readonly<Record<string, ClaveDeTexto>>;

const TONO_DE_ESTADO = {
  ABIERTA: "info",
  CERRADA: "exito",
  CANCELADA: "neutro",
  ANULADA: "aviso",
} as const satisfies Readonly<Record<keyof typeof CLAVE_DE_ESTADO, TonoDeEstado | "neutro">>;

/** Un valor que la pantalla no conoce se dice con el propio valor (nunca se esconde una orden por no saber nombrar su estado o su unidad). */
const conocido = (
  tabla: Readonly<Record<string, ClaveDeTexto>>,
  valor: string,
): ClaveDeTexto | null => (Object.hasOwn(tabla, valor) ? (tabla[valor] as ClaveDeTexto) : null);

/** El estado de una orden: su texto y su tono. */
export function marcaDeEstado(
  estado: string,
  d: DiccionarioResuelto = {},
): Readonly<{ texto: string; tono: TonoDeEstado | "neutro" }> {
  const clave = conocido(CLAVE_DE_ESTADO, estado);
  return clave === null
    ? { texto: estado, tono: "neutro" }
    : { texto: texto(d, clave), tono: TONO_DE_ESTADO[estado as keyof typeof TONO_DE_ESTADO] };
}

/** «KILOGRAMO» pasa a «Kilogramo»; una unidad que la pantalla no conoce se dice con el propio valor. */
export function textoDeLaUnidad(unidadId: string, d: DiccionarioResuelto = {}): string {
  const clave = conocido(CLAVE_DE_TEXTO_DE_UNIDAD, unidadId);
  return clave === null ? unidadId : texto(d, clave);
}

/** «10» y «KILOGRAMO» pasan a «10 Kilogramo»; sin unidad, solo la cantidad. La cantidad es texto decimal: nunca pasa por `Number` (ADR-006). */
export function cantidadConUnidad(
  cantidad: string,
  unidadId: string,
  d: DiccionarioResuelto = {},
): string {
  const unidad = textoDeLaUnidad(unidadId, d);
  return unidad === "" ? formatearCantidad(cantidad) : `${formatearCantidad(cantidad)} ${unidad}`;
}

/** Las órdenes como las entrega la composición (la misma forma, sin importar de dónde venga; la UI no importa la composición). */
export type OrdenesDeLaLista = Readonly<{
  ordenes: readonly Readonly<{
    id: string;
    numero: number;
    estado: string;
    nombre: string;
    cantidad: string;
    unidadId: string;
  }>[];
}>;

type FiltroArmado = Readonly<{ href: string; texto: string; actual: boolean }>;

type FilaDeOrden = Readonly<{
  id: string;
  href: string;
  /** «Orden 14 · Masa de medialuna». */
  titulo: string;
  estado: Readonly<{ texto: string; tono: TonoDeEstado | "neutro" }>;
  cantidad: string;
}>;

export type ListaArmada = Readonly<{
  filtros: readonly FiltroArmado[];
  filas: readonly FilaDeOrden[];
  /** «Sin resultados» si no hay filas; `null` si las hay. */
  vacio: string | null;
  /** «Nueva orden»: solo si el servidor ofrece abrir hoy; `null` si no. Una ayuda: abrir vuelve a pasar por el guard. */
  nueva: Readonly<{ href: string; texto: string }> | null;
}>;

/** Qué se ofrece hoy en la lista (lo calcula el servidor con la oferta de `transformaciones.abrir`). */
export type AccionesDeLaLista = Readonly<{ abrir?: boolean | undefined }>;

/** «Todas» y «Abiertas»: los textos de la maqueta (`produccion.html`, línea 341), aceptados por delegación del dueño (DEC-0555). */
const FILTROS = [
  { estado: "", clave: "produccion.lista.todas" },
  { estado: "ABIERTA", clave: "produccion.lista.abiertas" },
] as const satisfies readonly Readonly<{ estado: EstadoDelFiltroDeLaLista; clave: ClaveDeTexto }>[];

export function armarLaLista(
  lista: OrdenesDeLaLista,
  estado: EstadoDelFiltroDeLaLista,
  d: DiccionarioResuelto = {},
  acciones: AccionesDeLaLista = {},
): ListaArmada {
  return {
    filtros: FILTROS.map((f) => ({
      href: direccionDeLaLista(f.estado),
      texto: texto(d, f.clave),
      actual: f.estado === estado,
    })),
    filas: lista.ordenes.map((o) => ({
      id: o.id,
      href: rutaDeLaOrden(o.id),
      titulo: `${texto(d, "produccion.pantalla.orden")} ${String(o.numero)} · ${o.nombre}`,
      estado: marcaDeEstado(o.estado, d),
      cantidad: cantidadConUnidad(o.cantidad, o.unidadId, d),
    })),
    vacio: lista.ordenes.length === 0 ? texto(d, "catalogo.lista.sin_resultados") : null,
    nueva:
      acciones.abrir === true
        ? { href: RUTA_DE_NUEVA_ORDEN, texto: texto(d, "produccion.pantalla.nueva_orden") }
        : null,
  };
}
