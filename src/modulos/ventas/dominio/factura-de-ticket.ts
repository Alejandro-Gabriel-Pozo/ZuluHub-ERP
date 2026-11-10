import { uuidV5DeLista } from "../../../primitivas/identificadores/uuid-determinista";

/**
 * Lo puro de facturar un ticket (E1 §3.3): los identificadores DETERMINÍSTICOS de cada intento y cómo se arma cada renglón de la factura.
 * Previene que un identificador al azar se pierda con un corte y obligue a emitir otra vez lo que fiscal ya emitió: con (ticket, intento) el
 * origen y el comprobante se pueden volver a calcular, y el puntero `documento_de_ticket` se reconstruye desde fiscal.
 * Chequeo: `factura-de-ticket.test.ts`.
 */

/** Lo que el dominio necesita saber de un renglón (el de persistencia lo cumple por forma: el dominio no importa la persistencia). */
export type RenglonParaFacturar = Readonly<{
  descripcion: string;
  varianteNombre: string | null;
  opciones: readonly Readonly<{ nombre: string }>[];
  unidadDeVenta: string;
  unidadSimbolo: string;
}>;

/** El espacio de nombres (uuid v5) de todo lo que ventas deriva al facturar: fijo para siempre, cambiarlo rompería la reconstrucción. */
const ESPACIO_DE_FACTURAS = "7c1e4a9e-5b2d-4f6a-9d38-0e1f2a3b4c5d";

export type TipoDeOrigenDeFactura = "EJEMPLAR_DE_TICKET" | "REEMISION_DE_TICKET";

/**
 * El origen de la factura de un intento: el primero se identifica con el ejemplar que se factura; los siguientes (cuando el anterior dejó de
 * valer) con un uuid v5 de (ticket, número de intento), que es el mismo cada vez que se calcula. Una factura acreditada por completo sigue
 * ocupando su origen en fiscal, por eso la reemisión no puede reusarlo.
 */
export function origenDeLaFactura(
  ticket: string,
  intento: number,
  ejemplar: string,
): Readonly<{ tipo: TipoDeOrigenDeFactura; id: string }> {
  return intento === 1
    ? { tipo: "EJEMPLAR_DE_TICKET", id: ejemplar }
    : {
        tipo: "REEMISION_DE_TICKET",
        id: uuidV5DeLista(ESPACIO_DE_FACTURAS, [ticket, String(intento)]),
      };
}

/** El id del comprobante de ese intento (lo elige ventas y es el que fiscal guarda): siempre el mismo para el mismo (ticket, intento). */
export const comprobanteIdDeLaFactura = (ticket: string, intento: number): string =>
  uuidV5DeLista(ESPACIO_DE_FACTURAS, ["comprobante", ticket, String(intento)]);

/** El id del puntero de ese intento. */
export const documentoIdDeLaFactura = (ticket: string, intento: number): string =>
  uuidV5DeLista(ESPACIO_DE_FACTURAS, ["documento", ticket, String(intento)]);

/**
 * «Producto · tamaño · opción · opción» (separador « · » de `venta-rapida.html:421`). `maximo` es lo más largo que fiscal admite en la descripción
 * de un renglón: lo da el puerto del facturador (una sola fuente, la de fiscal). Si se pasa se recorta a `maximo - 1` y termina en
 * «…» (SUPUESTO S-4 de E1: fiscal rechazaría el renglón y la persona no podría facturar; el detalle completo queda en el ticket).
 */
export function descripcionDelRenglon(r: RenglonParaFacturar, maximo: number): string {
  const partes = [
    r.descripcion,
    ...(r.varianteNombre === null ? [] : [r.varianteNombre]),
    ...r.opciones.map((o) => o.nombre),
  ];
  const texto = partes.join(" · ");
  return texto.length <= maximo ? texto : `${texto.slice(0, maximo - 1)}…`;
}

/** Fiscal imprime la unidad de todo lo que no sea «unidad»: quien conoce la unidad base (ventas) decide cuál es la implícita. */
export const unidadDelRenglon = (r: RenglonParaFacturar): string | null =>
  r.unidadDeVenta === "UNIDAD" ? null : r.unidadSimbolo;
