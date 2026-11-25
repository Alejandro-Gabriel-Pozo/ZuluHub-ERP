import type { ClaveDeTexto } from "../../../../../../src/capacidades/vocabulario/catalogo";
import { fechaYHoraParaMostrar } from "../../../../../../src/primitivas/tiempo/instante-para-mostrar";
import { cantidadConUnidad } from "../../produccion/modelo-de-ordenes";
import { hrefDeLectura } from "../lectura/modelo-de-lectura";

/**
 * El modelo de vista de «Movimientos» (maqueta aprobada `stock.html`, 09/11/2026), el libro del depósito en solo lectura: una tarjeta por renglón con la clase, «Anulado» si lo está, la cantidad con signo y su
 * unidad, el artículo, el motivo (solo los que tienen texto aprobado), quién lo registró y cuándo (hora de Argentina). La cantidad es texto decimal: nunca pasa por `Number` (ADR-006). La clase o el motivo
 * que la pantalla no conoce no se rotula (lista de permitidos; ante la duda el sistema cierra): `test/web/stock-movimientos-modelo.test.ts` las compara con las del servidor. Puro.
 */

/** El texto de cada clase del libro. «Entrada» y «Salida» son los verbos aprobados el 09/11; «Transferencia», «Ajuste» y «Anulación», los de DEC-1022. El ajuste por conteo se rotula «Ajuste» (SUPUESTO, DEC-1023). */
export const CLAVE_DE_TEXTO_DE_LA_CLASE: Readonly<Record<string, ClaveDeTexto>> = {
  ENTRADA: "stock.accion.entrada",
  SALIDA: "stock.accion.salida",
  TRANSFERENCIA: "stock.clase.transferencia",
  AJUSTE: "stock.clase.ajuste",
  AJUSTE_POR_CONTEO: "stock.clase.ajuste",
  ANULACION: "stock.clase.anulacion",
};

/** El texto aprobado de cada motivo manual (`stock.motivo.*`, 09/11/2026). Los motivos de sistema (venta, producción, conteo…) no tienen texto aprobado y no se rotulan. */
export const CLAVE_DE_TEXTO_DEL_MOTIVO: Readonly<Record<string, ClaveDeTexto>> = {
  COMPRA: "stock.motivo.compra",
  CARGA_INICIAL: "stock.motivo.carga_inicial",
  DEVOLUCION_DE_CLIENTE: "stock.motivo.devolucion_de_cliente",
  OTRA_ENTRADA: "stock.motivo.otra_entrada",
  CONSUMO_INTERNO: "stock.motivo.consumo_interno",
  MERMA: "stock.motivo.merma",
  ROTURA: "stock.motivo.rotura",
  VENCIMIENTO: "stock.motivo.vencimiento",
  OTRA_SALIDA: "stock.motivo.otra_salida",
  CORRECCION: "stock.motivo.correccion",
};

export type MovimientosDeLaComposicion = Readonly<{
  depositos: readonly Readonly<{ id: string; nombre: string }>[];
  depositoId: string | null;
  movimientos: readonly Readonly<{
    movimientoId: string;
    numero: number;
    clase: string;
    motivo: string;
    hechoEn: string;
    quien: string | null;
    nombre: string;
    unidadId: string;
    cantidad: string;
    anulado: boolean;
  }>[];
  siguiente: string | null;
}>;

export type TarjetaDeMovimiento = Readonly<{
  id: string;
  /** La clase, o `null` si no tiene texto aprobado. */
  clase: string | null;
  anulado: boolean;
  /** «+5 kg» o «-1,25 kg»: el signo viene del texto de la cantidad. */
  cantidad: string;
  /** «Harina · Compra · ana@ejemplo.com» sin los que faltan. */
  detalle: string;
  /** «25/11/2026 12:30», hora de Argentina. */
  cuando: string;
}>;

export type VistaDeMovimientos = Readonly<{
  opciones: readonly Readonly<{ id: string; nombre: string; href: string; actual: boolean }>[];
  tarjetas: readonly TarjetaDeMovimiento[];
  hrefDeSiguiente: string | null;
}>;

const conSigno = (cantidad: string): string =>
  cantidad.startsWith("-") ? cantidad : `+${cantidad}`;

export function armarLosMovimientos(
  dato: MovimientosDeLaComposicion,
  textoDe: (clave: ClaveDeTexto) => string,
): VistaDeMovimientos {
  const rotulo = (tabla: Readonly<Record<string, ClaveDeTexto>>, codigo: string): string | null =>
    Object.hasOwn(tabla, codigo) ? textoDe(tabla[codigo] as ClaveDeTexto) : null;
  return {
    opciones: dato.depositos.map((d) => ({
      id: d.id,
      nombre: d.nombre,
      href: hrefDeLectura("movimientos", d.id),
      actual: d.id === dato.depositoId,
    })),
    tarjetas: dato.movimientos.map((m) => ({
      id: `${m.movimientoId}:${String(m.numero)}`,
      clase: rotulo(CLAVE_DE_TEXTO_DE_LA_CLASE, m.clase),
      anulado: m.anulado,
      cantidad: cantidadConUnidad(conSigno(m.cantidad), m.unidadId),
      detalle: [m.nombre, rotulo(CLAVE_DE_TEXTO_DEL_MOTIVO, m.motivo), m.quien]
        .filter((x): x is string => x !== null)
        .join(" · "),
      cuando: fechaYHoraParaMostrar(m.hechoEn),
    })),
    hrefDeSiguiente:
      dato.siguiente === null
        ? null
        : hrefDeLectura("movimientos", dato.depositoId, dato.siguiente),
  };
}
