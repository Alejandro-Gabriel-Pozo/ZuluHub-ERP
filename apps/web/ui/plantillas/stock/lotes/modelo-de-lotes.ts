import type { ClaveDeTexto } from "../../../../../../src/capacidades/vocabulario/catalogo";
import { fechaCivilDesdeTexto } from "../../../../../../src/primitivas/tiempo/fecha-civil";
import { fechaParaMostrar } from "../../../../../../src/primitivas/tiempo/fecha-para-mostrar";
import { cantidadConUnidad } from "../../produccion/modelo-de-ordenes";
import { RUTAS_DE_STOCK } from "../rutas-de-stock";

/**
 * El modelo de vista de la pestaña «Lotes» (maqueta `stock-lotes.html`, FP-STK-13 y FP-STK-14), solo lectura: el selector de artículos con sus lotes (Lote, Vence, Existencia, Disponible; «Sin asignar» al final, como
 * lo ordena el servidor) y la vista «Vencimientos» con su estado. La cantidad es texto decimal: nunca pasa por `Number` (ADR-006). Sin importes. Una fecha que no es válida no se muestra (nada se adivina). Puro.
 *
 * SUPUESTO (DEC-STK-002): el filtro de días de Vencimientos son enlaces a 7, 30 y 90 días (la maqueta pone un campo numérico; un campo pide dato, botón y texto nuevos). La dirección acepta cualquier valor de 0 a 365.
 */

const DIAS_DE_VENCIMIENTO = [7, 30, 90] as const;

type TextoDe = (clave: ClaveDeTexto, valores?: Readonly<Record<string, string>>) => string;

export type LotesDeLaComposicion = Readonly<{
  articulos: readonly Readonly<{ id: string; nombre: string }>[];
  articuloId: string | null;
  unidadId: string | null;
  lotes: readonly Readonly<{
    loteId: string;
    codigo: string;
    vence: string | null;
    existencia: string;
    disponible: string;
    sinAsignar: boolean;
    version: number;
    depositos: readonly Readonly<{ depositoId: string; existencia: string }>[];
  }>[];
  control: Readonly<{ activo: boolean }> | null;
}>;

export type VencimientosDeLaComposicion = Readonly<{
  dias: number;
  vencimientos: readonly Readonly<{
    loteId: string;
    nombre: string;
    codigo: string;
    vence: string;
    existencia: string;
    unidadId: string;
    estado: "VENCIDO" | "VENCE_HOY" | null;
  }>[];
}>;

export const hrefDeLotes = (articuloId: string | null = null): string =>
  articuloId === null
    ? RUTAS_DE_STOCK.lotes
    : `${RUTAS_DE_STOCK.lotes}?${new URLSearchParams({ articulo: articuloId }).toString()}`;

/** Las direcciones de Corregir y Reasignar: el artículo y el lote viajan escapados; la forma la valida la composición. */
export const hrefDeCorregir = (articuloId: string, loteId: string): string =>
  `${RUTAS_DE_STOCK.corregirLote}?${new URLSearchParams({ articulo: articuloId, lote: loteId }).toString()}`;
export const hrefDeReasignar = (articuloId: string, loteId: string): string =>
  `${RUTAS_DE_STOCK.reasignarLote}?${new URLSearchParams({ articulo: articuloId, lote: loteId }).toString()}`;

export const hrefDeVencimientos = (dias: number | null = null): string =>
  `${RUTAS_DE_STOCK.lotes}?${new URLSearchParams({ vista: "vencimientos", ...(dias === null ? {} : { dias: String(dias) }) }).toString()}`;

const fechaDeLote = (vence: string): string => {
  const fecha = fechaCivilDesdeTexto(vence);
  return fecha.ok ? fechaParaMostrar(fecha.valor) : "";
};

export type VistaDeLotes = Readonly<{
  articuloId: string | null;
  /** El artículo se controla por lote hoy (`true`), dejó de controlarse o nunca se controló (`false`). */
  controlado: boolean;
  opciones: readonly Readonly<{ id: string; nombre: string; href: string; actual: boolean }>[];
  hrefDeVencimientos: string;
  filas: readonly Readonly<{
    id: string;
    codigo: string;
    vence: string | null;
    existencia: string;
    disponible: string;
    /** Adónde lleva «Corregir» (no se ofrece en «Sin asignar», que no tiene fechas) y «Reasignar» (solo en «Sin asignar» con existencia). */
    hrefDeCorregir: string | null;
    hrefDeReasignar: string | null;
  }>[];
}>;

/** Hay existencia positiva (texto decimal exacto, sin `Number`). */
const hayExistencia = (cantidad: string): boolean =>
  !cantidad.startsWith("-") && /[1-9]/.test(cantidad);

export function armarLosLotes(dato: LotesDeLaComposicion, textoDe: TextoDe): VistaDeLotes {
  const articuloId = dato.articuloId;
  return {
    articuloId,
    controlado: dato.control?.activo === true,
    opciones: dato.articulos.map((a) => ({
      id: a.id,
      nombre: a.nombre,
      href: hrefDeLotes(a.id),
      actual: a.id === dato.articuloId,
    })),
    hrefDeVencimientos: hrefDeVencimientos(),
    filas: dato.lotes.map((l) => ({
      id: l.loteId,
      codigo: l.sinAsignar ? textoDe("stock.lotes.sin_asignar") : l.codigo,
      vence: l.vence === null ? null : fechaDeLote(l.vence),
      existencia: cantidadConUnidad(l.existencia, dato.unidadId ?? ""),
      disponible: cantidadConUnidad(l.disponible, dato.unidadId ?? ""),
      hrefDeCorregir:
        articuloId === null || l.sinAsignar ? null : hrefDeCorregir(articuloId, l.loteId),
      hrefDeReasignar:
        articuloId !== null && l.sinAsignar && hayExistencia(l.existencia)
          ? hrefDeReasignar(articuloId, l.loteId)
          : null,
    })),
  };
}

type LoteDeLaComposicion = LotesDeLaComposicion["lotes"][number];

/** El lote a corregir: tiene que ser uno del artículo y no el «Sin asignar» (no tiene fechas). Su versión es la que se manda de vuelta. */
export function loteParaCorregir(
  dato: LotesDeLaComposicion,
  loteId: string | undefined,
): Readonly<{ codigo: string; vence: string; version: number }> | null {
  const lote = dato.lotes.find((l) => l.loteId === loteId);
  return lote === undefined || lote.sinAsignar
    ? null
    : { codigo: lote.codigo, vence: lote.vence ?? "", version: lote.version };
}

/**
 * La reasignación del «Sin asignar» con existencia: de qué lote sale, en qué depósitos tiene existencia (con su nombre) y a qué lotes EXISTENTES puede ir. Un lote que no es el «Sin asignar» o sin existencia no se reasigna
 * desde acá (`null`). Ayuda: el servidor valida el saldo, el artículo y el depósito.
 */
export function loteParaReasignar(
  dato: LotesDeLaComposicion,
  loteId: string | undefined,
  depositos: readonly Readonly<{ id: string; nombre: string }>[],
  textoDe: TextoDe,
): Readonly<{
  origen: string;
  unidadId: string;
  depositos: readonly Readonly<{ valor: string; etiqueta: string }>[];
  destinos: readonly Readonly<{ valor: string; etiqueta: string }>[];
}> | null {
  const origen: LoteDeLaComposicion | undefined = dato.lotes.find((l) => l.loteId === loteId);
  if (origen === undefined || !origen.sinAsignar || !hayExistencia(origen.existencia)) return null;
  const conExistencia = new Set(
    origen.depositos.filter((d) => hayExistencia(d.existencia)).map((d) => d.depositoId),
  );
  return {
    origen: textoDe("stock.lotes.sin_asignar"),
    unidadId: dato.unidadId ?? "",
    depositos: depositos
      .filter((d) => conExistencia.has(d.id))
      .map((d) => ({ valor: d.id, etiqueta: d.nombre })),
    destinos: dato.lotes
      .filter((l) => l.loteId !== origen.loteId && !l.sinAsignar)
      .map((l) => ({ valor: l.loteId, etiqueta: l.codigo })),
  };
}

export type VistaDeVencimientos = Readonly<{
  /** Un enlace por horizonte, con el rótulo ya resuelto; el aplicado va marcado. */
  horizontes: readonly Readonly<{ dias: number; texto: string; href: string; actual: boolean }>[];
  filas: readonly Readonly<{
    id: string;
    articulo: string;
    codigo: string;
    vence: string;
    existencia: string;
    estado: string | null;
    vencido: boolean;
  }>[];
}>;

export function armarLosVencimientos(
  dato: VencimientosDeLaComposicion,
  textoDe: TextoDe,
): VistaDeVencimientos {
  return {
    horizontes: DIAS_DE_VENCIMIENTO.map((dias) => ({
      dias,
      texto: textoDe("stock.lotes.dias", { dias: String(dias) }),
      href: hrefDeVencimientos(dias),
      actual: dias === dato.dias,
    })),
    filas: dato.vencimientos.map((v) => ({
      id: v.loteId,
      articulo: v.nombre,
      codigo: v.codigo,
      vence: fechaDeLote(v.vence),
      existencia: cantidadConUnidad(v.existencia, v.unidadId),
      estado:
        v.estado === "VENCIDO"
          ? textoDe("stock.lotes.vencido")
          : v.estado === "VENCE_HOY"
            ? textoDe("stock.lotes.vence_hoy")
            : null,
      vencido: v.estado === "VENCIDO",
    })),
  };
}

/** Lo que el navegador manda en la dirección, solo como texto: la forma la valida la composición. Un valor repetido o de otro tipo se descarta. */
export function leerLosLotes(
  params: Readonly<Record<string, string | string[] | undefined>>,
): Readonly<{ vencimientos: boolean; articuloId?: string; loteId?: string; dias?: string }> {
  const uno = (v: string | string[] | undefined): string | undefined =>
    typeof v === "string" && v !== "" ? v : undefined;
  const articuloId = uno(params["articulo"]);
  const loteId = uno(params["lote"]);
  const dias = uno(params["dias"]);
  return {
    vencimientos: uno(params["vista"]) === "vencimientos",
    ...(articuloId === undefined ? {} : { articuloId }),
    ...(loteId === undefined ? {} : { loteId }),
    ...(dias === undefined ? {} : { dias }),
  };
}
