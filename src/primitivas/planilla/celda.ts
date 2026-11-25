/**
 * Lo que un archivo de planilla (Excel) recibe de quien lo arma: celdas tipadas, nunca un `number` de dinero. El decimal viaja como TEXTO exacto de la base con la cantidad de
 * decimales con que se muestra (2 en importes, 4 en cantidades, 6 en precios y costos); recién el escritor decide cómo se guarda en la celda. Lo comparten el módulo que arma las
 * hojas y el escritor del archivo (una regla, un lugar).
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

/** Una hoja lista para escribir: su nombre, los encabezados ya escritos y las filas. */
export type HojaDePlanilla = Readonly<{
  nombre: string;
  encabezados: readonly string[];
  filas: readonly (readonly Celda[])[];
}>;
