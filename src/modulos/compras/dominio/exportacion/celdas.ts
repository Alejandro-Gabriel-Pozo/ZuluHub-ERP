import type { Celda } from "../../../../primitivas/planilla/celda";

/** Las celdas son de la primitiva de planilla (las comparte con el escritor del archivo); acá se re-exportan y se suma la hoja con columnas por identificador. */
export {
  celdaDeFecha,
  celdaDeTexto,
  celdaDecimal,
  celdaEntera,
  type Celda,
} from "../../../../primitivas/planilla/celda";

/** Una hoja: las columnas por su identificador (el texto de cada encabezado lo pone la capa de pantalla/archivo desde el catálogo) y sus filas en el mismo orden. */
export type HojaDeExportacion<Columna extends string> = Readonly<{
  columnas: readonly Columna[];
  filas: readonly (readonly Celda[])[];
}>;
