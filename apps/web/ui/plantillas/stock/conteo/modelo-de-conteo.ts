import type { ClaveDeTexto } from "../../../../../../src/capacidades/vocabulario/catalogo";
import { horaParaMostrar } from "../../../../../../src/primitivas/tiempo/instante-para-mostrar";
import { cantidadConUnidad } from "../../produccion/modelo-de-ordenes";
import { RUTAS_DE_STOCK } from "../rutas-de-stock";

/**
 * El modelo de vista de «Conteo» (STK-D, FP-STK-10 a FP-STK-12; maqueta `stock-conteo.html`): las direcciones, qué fila hay que guardar, los motivos con su texto aprobado y la revisión formateada. Puro: sin React ni
 * servidor. TODO es ayuda: el servidor valida la cantidad, la hora y el motivo y decide. Las cantidades son texto decimal exacto (nunca `Number`, ADR-006); cero es válido. El conteo es A CIEGAS: lo que el sistema creía,
 * lo movido y la diferencia solo se arman si vinieron (solo quien puede aplicar los recibe); sin ellos el campo no existe.
 */

export const hrefDelConteo = (depositoId: string | null = null): string =>
  depositoId === null
    ? RUTAS_DE_STOCK.conteo
    : `${RUTAS_DE_STOCK.conteo}?${new URLSearchParams({ deposito: depositoId }).toString()}`;

export const hrefDeRevisar = (conteoId: string): string =>
  `${RUTAS_DE_STOCK.revisarConteo}?${new URLSearchParams({ conteo: conteoId }).toString()}`;

/** Lo que el navegador manda en la dirección, solo como texto: la forma la valida la composición. Un valor repetido o vacío se descarta. */
export function leerElConteo(
  params: Readonly<Record<string, string | string[] | undefined>>,
): Readonly<{ depositoId?: string; conteoId?: string }> {
  const uno = (v: string | string[] | undefined): string | undefined =>
    typeof v === "string" && v !== "" ? v : undefined;
  const depositoId = uno(params["deposito"]);
  const conteoId = uno(params["conteo"]);
  return {
    ...(depositoId === undefined ? {} : { depositoId }),
    ...(conteoId === undefined ? {} : { conteoId }),
  };
}

/** El texto aprobado de cada motivo de diferencia. «Venta no registrada» es del conteo; el resto reutiliza el de los motivos de movimiento. Un motivo sin texto no se ofrece (lista de permitidos). */
export const CLAVE_DE_TEXTO_DEL_MOTIVO_DE_DIFERENCIA: Readonly<Record<string, ClaveDeTexto>> = {
  VENTA_NO_REGISTRADA: "stock.conteo.motivo_venta_no_registrada",
  CONSUMO_INTERNO: "stock.motivo.consumo_interno",
  MERMA: "stock.motivo.merma",
  ROTURA: "stock.motivo.rotura",
  VENCIMIENTO: "stock.motivo.vencimiento",
  OTRA_SALIDA: "stock.motivo.otra_salida",
  DEVOLUCION_DE_CLIENTE: "stock.motivo.devolucion_de_cliente",
  OTRA_ENTRADA: "stock.motivo.otra_entrada",
};

// ---- la carga (autoguardado por fila) -------------------------------------------------------------------------------------------

/** Lo que tiene una fila de la carga: lo escrito, lo último que se guardó y el intento en curso (con su id, para que reintentar el MISMO valor no duplique). */
export type FilaDeLaCarga = Readonly<{
  articuloId: string;
  /** Lo escrito en «Contado» (texto decimal canónico) y en «Hora del conteo» (`HH:MM` o vacío = la de la carga). */
  contado: string;
  hora: string;
  /** Lo último que el servidor confirmó, o `null`. */
  guardado: Readonly<{ contado: string; hora: string }> | null;
  /** El intento que falló o está en curso: se reusa su id si se vuelve a guardar lo mismo. */
  intento: Readonly<{ id: string; contado: string; hora: string }> | null;
}>;

/** Una fila se guarda al salir del campo si hay algo contado (cero también) y es distinto de lo ya guardado. */
export const hayQueGuardar = (fila: FilaDeLaCarga): boolean =>
  fila.contado !== "" &&
  (fila.guardado === null ||
    fila.guardado.contado !== fila.contado ||
    fila.guardado.hora !== fila.hora);

/** El id del registro a mandar: el del intento anterior si es lo MISMO (reintento tras un fallo: no duplica), si no uno nuevo (recontar). */
export function idDelRegistro(fila: FilaDeLaCarga, nuevo: () => string): string {
  const intento = fila.intento;
  return intento !== null && intento.contado === fila.contado && intento.hora === fila.hora
    ? intento.id
    : nuevo();
}

// ---- la revisión y el resultado ---------------------------------------------------------------------------------------------------

type TextoDe = (clave: ClaveDeTexto, valores?: Readonly<Record<string, string>>) => string;

export type RevisionDeLaComposicion = Readonly<{
  conteoId: string;
  estado: "ABIERTO" | "APLICADO" | "CANCELADO";
  huella: string | null;
  filas: readonly Readonly<{
    articuloId: string;
    nombre: string;
    unidadId: string;
    contada: string;
    contadoEn: string;
    sistema?: string;
    movido?: string;
    diferencia?: string;
    motivos?: readonly Readonly<{ codigo: string; pideDetalle: boolean }>[];
  }>[];
  aplicadas: readonly Readonly<{
    articuloId: string;
    nombre: string;
    unidadId: string;
    contada: string;
    diferencia: string;
    motivo: string | null;
    detalle: string | null;
  }>[];
}>;

export type FilaParaRevisar = Readonly<{
  articuloId: string;
  nombre: string;
  contado: string;
  /** Solo si vinieron (quien aplica): lo que el sistema creía a esa hora, lo movido desde entonces (con su rótulo) y la diferencia. */
  sistema: string | null;
  movido: string | null;
  rotuloDeMovido: string;
  diferencia: string | null;
  /** Hay diferencia y hay que explicarla con un motivo. */
  conDiferencia: boolean;
  motivos: readonly Readonly<{ codigo: string; etiqueta: string; pideDetalle: boolean }>[];
}>;

const hayAlgo = (cantidad: string): boolean => /[1-9]/.test(cantidad);

export function armarLaRevision(dato: RevisionDeLaComposicion, textoDe: TextoDe) {
  const filas = dato.filas.map((f): FilaParaRevisar => {
    const con = (c: string | undefined) =>
      c === undefined ? null : cantidadConUnidad(c, f.unidadId);
    return {
      articuloId: f.articuloId,
      nombre: f.nombre,
      contado: cantidadConUnidad(f.contada, f.unidadId),
      sistema: con(f.sistema),
      movido: con(f.movido),
      rotuloDeMovido: textoDe("stock.conteo.movido_desde", { hora: horaParaMostrar(f.contadoEn) }),
      diferencia: con(f.diferencia),
      conDiferencia: f.diferencia !== undefined && hayAlgo(f.diferencia),
      motivos: (f.motivos ?? []).flatMap((m) => {
        const clave = CLAVE_DE_TEXTO_DEL_MOTIVO_DE_DIFERENCIA[m.codigo];
        return clave === undefined
          ? []
          : [{ codigo: m.codigo, etiqueta: textoDe(clave), pideDetalle: m.pideDetalle }];
      }),
    };
  });
  const aplicadas = dato.aplicadas.map((a) => ({
    articuloId: a.articuloId,
    nombre: a.nombre,
    contado: cantidadConUnidad(a.contada, a.unidadId),
    diferencia: cantidadConUnidad(a.diferencia, a.unidadId),
    motivo:
      a.motivo === null
        ? null
        : CLAVE_DE_TEXTO_DEL_MOTIVO_DE_DIFERENCIA[a.motivo] === undefined
          ? null
          : textoDe(CLAVE_DE_TEXTO_DEL_MOTIVO_DE_DIFERENCIA[a.motivo] as ClaveDeTexto),
    detalle: a.detalle,
  }));
  return { filas, aplicadas };
}

/** «Aplicar» se ofrece cuando toda fila con diferencia tiene su motivo (y su detalle si el motivo lo pide). Es ayuda: el servidor decide. */
export function puedeAplicar(
  filas: readonly FilaParaRevisar[],
  respuestas: Readonly<Record<string, Readonly<{ motivo: string; detalle: string }>>>,
): boolean {
  return filas.every((f) => {
    if (!f.conDiferencia) return true;
    const r = respuestas[f.articuloId];
    const motivo = f.motivos.find((m) => m.codigo === r?.motivo);
    return motivo !== undefined && (!motivo.pideDetalle || (r?.detalle.trim() ?? "") !== "");
  });
}

/** Lo guardado llega con sus cuatro decimales («18.0000»): para el campo se lleva a su forma corta («18», «17.5», «0»). Texto a texto, sin `Number`. */
export function sinCerosDeSobra(cantidad: string): string {
  if (!cantidad.includes(".")) return cantidad;
  return cantidad.replace(/0+$/, "").replace(/\.$/, "");
}
