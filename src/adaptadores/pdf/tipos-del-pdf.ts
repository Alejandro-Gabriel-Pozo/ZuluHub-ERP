import type { FilaDelPdf } from "./pincel-del-pdf";

/**
 * Lo que el adaptador de PDF recibe: la hoja YA ARMADA (textos del catálogo, importes y fechas con su formato) y nada más. Es un tipo
 * propio y estructural, como el de la hoja en pantalla: `HojaArmada` (`apps/web/ui/.../modelo-de-la-hoja.ts`) lo cumple tal cual y este
 * adaptador no importa la web. El adaptador no formatea ni traduce nada: lo que la pantalla dibuja es lo que el PDF dibuja.
 */

export type ColumnaDelPdf = Readonly<{
  clave: "descripcion" | "cantidad" | "precio" | "iva" | "importe";
  titulo: string;
  numerica: boolean;
}>;

export type RenglonDelPdf = Readonly<{
  descripcion: string;
  cantidad: string;
  precio: string;
  /** `null` si el renglón no lleva IVA (letra C, exento, no gravado). */
  iva: string | null;
  importe: string;
}>;

export type TotalDelPdf = Readonly<{ rotulo: string; valor: string; fuerte: boolean }>;

export type HojaParaElPdf = Readonly<{
  leyendas: readonly string[];
  leyendasLegales: readonly string[];
  nombreDeFantasia: string | null;
  /** El nombre de la sucursal congelado al emitir (D-114), tal cual y sin rótulo, entre el nombre de fantasía y la razón social; `null` si no se imprime. */
  nombreDeLaSucursal: string | null;
  emisor: readonly FilaDelPdf[];
  contacto: string | null;
  letra: string;
  codigo: string;
  rotulo: string;
  numero: string;
  datos: readonly FilaDelPdf[];
  corresponde: string | null;
  receptor: readonly FilaDelPdf[];
  columnas: readonly ColumnaDelPdf[];
  renglones: readonly RenglonDelPdf[];
  rotuloDeTransporte: string;
  rotuloDeATransportar: string;
  totales: readonly TotalDelPdf[];
  transparencia: Readonly<{ titulo: string; filas: readonly FilaDelPdf[] }> | null;
  cae: FilaDelPdf;
}>;

/** Las alturas MEDIDAS de las piezas de la hoja, en píxeles de CSS (96 por pulgada): lo que el paginador de la hoja espera. */
export type MedidasDeLaHoja = Readonly<{
  encabezadoDeLaHoja: number;
  encabezadoDeLaTabla: number;
  filaDeTransporte: number;
  renglones: readonly number[];
  pie: number;
}>;

export type HojaRepartida = Readonly<{
  /** El primer renglón de la hoja y el siguiente al último: `[desde, hasta)`. */
  desde: number;
  hasta: number;
  /** El parcial con que abre («Transporte»), importe sin formato; `null` en la primera. */
  transporte: string | null;
  /** El parcial con que cierra («A transportar»), importe sin formato; `null` en la última. */
  aTransportar: string | null;
}>;

/**
 * Las reglas de la hoja que el PDF NO escribe de nuevo: las pone quien lo pide, con las mismas funciones que usa la pantalla (una regla,
 * un lugar). `repartir` es el paginador de la hoja (un renglón nunca se parte, «Transporte» / «A transportar», sumas en centavos
 * enteros); `formatearImporte` y `textoDeLaHoja` son el formato de importes y el «Hoja k de n» del catálogo.
 */
export type ReglasDeLaHoja = Readonly<{
  papel: Readonly<{ anchoMm: number; altoMm: number; margenMm: number }>;
  repartir: (
    medidas: MedidasDeLaHoja,
    importes: readonly string[],
  ) => Readonly<{ hojas: readonly HojaRepartida[]; excedeLaHoja: boolean }>;
  formatearImporte: (importe: string) => string;
  textoDeLaHoja: (k: number, n: number) => string;
}>;
