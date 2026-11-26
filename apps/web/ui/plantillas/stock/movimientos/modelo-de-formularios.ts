import type { ClaveDeTexto } from "../../../../../../src/capacidades/vocabulario/catalogo";
import { RUTAS_DE_STOCK } from "../rutas-de-stock";
import { CLAVE_DE_TEXTO_DEL_MOTIVO } from "./modelo-de-movimientos";

/**
 * El modelo de vista de los formularios de movimientos (STK-B2): las direcciones, qué campos lleva cada tipo y las opciones de cada selector, con el texto aprobado de cada una. Puro: sin React ni servidor.
 * Un motivo o un uso que no tiene texto aprobado no se ofrece (lista de permitidos). El artículo se elige por nombre y su unidad es la de stock (no se elige).
 */

export type TipoDeMovimiento = "ENTRADA" | "SALIDA" | "TRANSFERIR" | "AJUSTAR" | "ANULAR";

const BASE = `${RUTAS_DE_STOCK.movimientos}`;
export const RUTAS_DE_MOVIMIENTOS = {
  lista: BASE,
  entrada: `${BASE}/entrada`,
  salida: `${BASE}/salida`,
  transferir: `${BASE}/transferir`,
  ajustar: `${BASE}/ajustar`,
  anular: (movimientoId: string): string => `${BASE}/${movimientoId}/anular`,
} as const;

/** Qué campos lleva cada tipo (el de anular es solo el detalle). El costo, además, solo aparece con el motivo «Compra». */
export const CAMPOS_DEL_TIPO: Readonly<
  Record<
    TipoDeMovimiento,
    Readonly<{
      deposito: boolean;
      origenYDestino: boolean;
      articulo: boolean;
      sentido: boolean;
      cantidad: boolean;
      motivo: boolean;
      costo: boolean;
      detalleObligatorio: boolean;
    }>
  >
> = {
  ENTRADA: {
    deposito: true,
    origenYDestino: false,
    articulo: true,
    sentido: false,
    cantidad: true,
    motivo: true,
    costo: true,
    detalleObligatorio: false,
  },
  SALIDA: {
    deposito: true,
    origenYDestino: false,
    articulo: true,
    sentido: false,
    cantidad: true,
    motivo: true,
    costo: false,
    detalleObligatorio: false,
  },
  TRANSFERIR: {
    deposito: false,
    origenYDestino: true,
    articulo: true,
    sentido: false,
    cantidad: true,
    motivo: false,
    costo: false,
    detalleObligatorio: false,
  },
  AJUSTAR: {
    deposito: true,
    origenYDestino: false,
    articulo: true,
    sentido: true,
    cantidad: true,
    motivo: false,
    costo: false,
    detalleObligatorio: true,
  },
  ANULAR: {
    deposito: false,
    origenYDestino: false,
    articulo: false,
    sentido: false,
    cantidad: false,
    motivo: false,
    costo: false,
    detalleObligatorio: true,
  },
};

/** El motivo con el que la entrada declara costo (el servidor lo exige igual: la pantalla solo ofrece el campo). */
export const MOTIVO_CON_COSTO = "COMPRA";

export type Opcion = Readonly<{ valor: string; etiqueta: string }>;

/** Los depósitos para elegir: en una entrada, los de uso Normal (Cuarentena y Rechazo reciben solo por transferencia, ajuste o anulación). */
export function opcionesDeDeposito(
  depositos: readonly Readonly<{ id: string; nombre: string; uso: string }>[],
  tipo: TipoDeMovimiento,
): readonly Opcion[] {
  return depositos
    .filter((d) => tipo !== "ENTRADA" || d.uso === "NORMAL")
    .map((d) => ({ valor: d.id, etiqueta: d.nombre }));
}

export const opcionesDeArticulo = (
  articulos: readonly Readonly<{ id: string; nombre: string }>[],
): readonly Opcion[] => articulos.map((a) => ({ valor: a.id, etiqueta: a.nombre }));

/** Los motivos con texto aprobado, en el orden que da el servidor. */
export function opcionesDeMotivo(
  motivos: readonly string[],
  textoDe: (clave: ClaveDeTexto) => string,
): readonly Opcion[] {
  return motivos.flatMap((m) =>
    Object.hasOwn(CLAVE_DE_TEXTO_DEL_MOTIVO, m)
      ? [{ valor: m, etiqueta: textoDe(CLAVE_DE_TEXTO_DEL_MOTIVO[m] as ClaveDeTexto) }]
      : [],
  );
}

/** «Sobra» suma y «Falta» resta. */
export const opcionesDeSentido = (textoDe: (clave: ClaveDeTexto) => string): readonly Opcion[] => [
  { valor: "SUMA", etiqueta: textoDe("stock.ajuste.sobra") },
  { valor: "RESTA", etiqueta: textoDe("stock.ajuste.falta") },
];
