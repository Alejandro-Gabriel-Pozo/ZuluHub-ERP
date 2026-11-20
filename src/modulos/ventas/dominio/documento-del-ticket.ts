import { fechaParaMostrar } from "../../../primitivas/tiempo/fecha-para-mostrar";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { cantidadParaMostrar } from "../../../primitivas/cantidad/cantidad-para-mostrar";
import { importeParaMostrar } from "../../../primitivas/dinero/importe-para-mostrar";
import {
  columnasDelPapel,
  envolver,
  SEPARADOR,
  sangrado,
  type LineaDePapel,
  type ModeloDePapel,
  type PapelEnMm,
} from "../../../primitivas/papel/modelo-de-papel";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * EL TICKET DEL CLIENTE EN EL PAPEL (mostrador, K6). Función pura que arma el MODELO del papel (líneas con estilo y ancho 58/80 mm); el navegador lo imprime con
 * el diálogo del sistema (PP-1). Sale de lo que YA tiene la ficha del ticket (foto del ejemplar vigente), nunca del catálogo vivo. Lleva: «Ticket N.º», la
 * fecha en DD/MM/AAAA (decisión del dueño, fila 178; una sola regla: `fechaParaMostrar`), cada línea con su cantidad como en pantalla («½», «1 ½», «350 g»: una sola
 * regla, `cantidadParaMostrar`; respuestas 24 a 27, 27A), la medida y las opciones elegidas en renglones sangrados (los textos salen de los datos del ticket, no
 * hay textos nuevos), el importe a la derecha (formato argentino «3.000,00», sin «$»: `importeParaMostrar`) y el «Total». SIN medios de pago ni vuelto ni empresa, sucursal u hora (supuesto del orquestador, a corregir por el dueño).
 * Textos: «Ticket N.º» y «Total» son los aprobados del papel (E7 §10, `imprimir.html:298/300`, decisión 120), antes en `comandas/dominio/documento.ts`.
 * Falla cerrada: una cantidad que no se puede mostrar (un tercio) o una fecha o un importe que no se pueden mostrar no sacan un papel a medias.
 */
export const TEXTOS_DEL_TICKET = { ticket: "Ticket N.º", total: "Total" } as const;

export type ErrorDelPapelDelTicket =
  "CANTIDAD_NO_MOSTRABLE" | "FECHA_INVALIDA" | "IMPORTE_NO_MOSTRABLE";

export type RenglonParaElTicket = Readonly<{
  /** Texto decimal exacto. */
  cantidad: string;
  unidadDeVenta: string;
  descripcion: string;
  /** La medida elegida («Grande»); `null` si el producto no tiene. */
  varianteNombre: string | null;
  /** Las opciones elegidas, en el orden de la ficha. */
  opciones: readonly Readonly<{ nombre: string }>[];
  /** Texto decimal. */
  importe: string;
}>;

export type FichaParaElTicket = Readonly<{
  numero: number;
  /** Fecha de negocio del ticket (AAAA-MM-DD): se muestra DD/MM/AAAA. */
  fechaNegocio: FechaCivil;
  lineas: readonly RenglonParaElTicket[];
  total: string;
}>;

export function documentoDeTicket(
  ficha: FichaParaElTicket,
  opciones: Readonly<{ ancho: PapelEnMm }>,
): Resultado<ModeloDePapel, ErrorDelPapelDelTicket> {
  const columnas = columnasDelPapel(opciones.ancho);
  const dosColumnas = (izquierda: string, derecha: string): LineaDePapel[] => {
    const lugar = columnas - derecha.length - 1;
    // La descripción siempre trae al menos la cantidad: con lugar 0 o negativo nunca entra y se parte.
    if (izquierda.length <= lugar) {
      return [{ texto: `${izquierda.padEnd(lugar)} ${derecha}`, estilo: "NORMAL" }];
    }
    return [...envolver(izquierda, columnas, "NORMAL"), ...envolver(derecha, columnas, "NORMAL")];
  };
  let fecha: string;
  try {
    fecha = fechaParaMostrar(ficha.fechaNegocio);
  } catch (error) {
    if (error instanceof RangeError) return err("FECHA_INVALIDA");
    throw error;
  }
  const lineas: LineaDePapel[] = [
    { texto: `${TEXTOS_DEL_TICKET.ticket} ${ficha.numero}`, estilo: "NEGRITA" },
    ...envolver(fecha, columnas, "NORMAL"),
    SEPARADOR,
  ];
  for (const l of ficha.lineas) {
    const cantidad = cantidadParaMostrar(l.cantidad, { unidadDeVenta: l.unidadDeVenta });
    if (!cantidad.ok) return err("CANTIDAD_NO_MOSTRABLE");
    const importe = importeParaMostrar(l.importe);
    if (!importe.ok) return err("IMPORTE_NO_MOSTRABLE");
    lineas.push(...dosColumnas(`${cantidad.valor} ${l.descripcion}`, importe.valor));
    const detalle = [
      ...(l.varianteNombre === null ? [] : [l.varianteNombre]),
      ...l.opciones.map((o) => o.nombre),
    ];
    for (const d of detalle) lineas.push(...sangrado(d, columnas));
  }
  const total = importeParaMostrar(ficha.total);
  if (!total.ok) return err("IMPORTE_NO_MOSTRABLE");
  lineas.push(SEPARADOR);
  for (const l of dosColumnas(TEXTOS_DEL_TICKET.total, total.valor)) {
    lineas.push({ ...l, estilo: "NEGRITA" });
  }
  return ok({ ancho: opciones.ancho, lineas });
}
