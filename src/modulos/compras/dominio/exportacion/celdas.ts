/**
 * Lo que la exportación le pasa al escritor de la planilla: celdas tipadas, nunca un `number` de dinero. El decimal viaja como TEXTO exacto de la base con la
 * cantidad de decimales con que se muestra (2 en importes, 4 en cantidades, 6 en precios y costos); recién el escritor decide cómo se guarda en la celda.
 */
export type Celda =
  | null
  | Readonly<{ tipo: "texto"; valor: string }>
  | Readonly<{ tipo: "decimal"; valor: string; decimales: 2 | 4 | 6 }>
  /** Una fecha civil `AAAA-MM-DD`, sin hora ni zona (el día que dice la base). */
  | Readonly<{ tipo: "fecha"; valor: string }>
  | Readonly<{ tipo: "entero"; valor: number }>;

export const celdaDeTexto = (valor: string | null): Celda =>
  valor === null || valor === "" ? null : { tipo: "texto", valor };
export const celdaDecimal = (valor: string | null, decimales: 2 | 4 | 6): Celda =>
  valor === null ? null : { tipo: "decimal", valor, decimales };
export const celdaDeFecha = (valor: string | null): Celda =>
  valor === null ? null : { tipo: "fecha", valor };
export const celdaEntera = (valor: number | null): Celda =>
  valor === null ? null : { tipo: "entero", valor };

/** Una hoja: las columnas por su identificador (el texto de cada encabezado lo pone la capa de pantalla/archivo desde el catálogo) y sus filas en el mismo orden. */
export type HojaDeExportacion<Columna extends string> = Readonly<{
  columnas: readonly Columna[];
  filas: readonly (readonly Celda[])[];
}>;
