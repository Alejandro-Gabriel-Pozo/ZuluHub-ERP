import { TIPOS_DE_MEDIO } from "../modulos/caja/publico";
import {
  COLUMNAS_DE_LA_EXPORTACION,
  ORIGENES_DE_LA_EXPORTACION,
  TRAMOS_DE_ANTIGUEDAD,
  type ColumnaDeLaExportacion,
  type RotulosDeLaExportacion,
} from "../modulos/cuenta_corriente/publico";
import { texto } from "../capacidades/vocabulario/vocabulario";
import { encabezadosDeCabecera, rotulosDeExportacion } from "./compras-exportacion-textos";

/**
 * Los textos del archivo de la cuenta corriente (CC-5 D; dueño, 26/11/2026: «usen textos de la exportación de Compras»). No se crea ningún texto: lo que la exportación de compras ya
 * tiene aprobado se reutiliza desde su misma función (fecha de negocio, moneda, sucursal, medio de pago, estado, anulado, los tipos de medio); lo que no tiene texto aprobado sale con su
 * CÓDIGO ESTABLE (`importe_con_signo`, `DE_31_A_60`), nunca con un texto inventado. Cuando CC-1 (catálogo de cuenta corriente) deje aprobados los demás, se cambian acá, en esta tabla.
 * Previene: un encabezado o un valor escrito a mano que nadie aprobó. Chequeo: `cuenta-corriente-exportacion-textos.test.ts` (cada texto sale del catálogo o es su código).
 */

const t = (clave: Parameters<typeof texto>[1]): string => texto({}, clave);

/** Las columnas que la exportación de compras ya tiene con texto aprobado; las demás salen con su código. */
const DE_COMPRAS: Readonly<Partial<Record<ColumnaDeLaExportacion, string>>> = (() => {
  const [fecha, moneda, sucursal, medio, estado] = encabezadosDeCabecera([
    "fecha_de_negocio",
    "moneda",
    "sucursal",
    "medio_de_pago",
    "estado",
  ]);
  return {
    fecha_de_negocio: fecha as string,
    moneda: moneda as string,
    sucursal: sucursal as string,
    medio_de_pago: medio as string,
    estado: estado as string,
  };
})();

/** El genérico: el código de la columna, que es estable entre exportaciones. */
const encabezadoDe = (columna: ColumnaDeLaExportacion): string => DE_COMPRAS[columna] ?? columna;

/** Los tipos de medio de caja que el catálogo conoce, con su texto (el mismo de compras). Uno que no conoce sale con su código (lo resuelve `armarHojaDeLaExportacion`). */
function tiposDeMedioConocidos(): Readonly<Record<string, string>> {
  const compras = rotulosDeExportacion();
  const conocidos: Record<string, string> = {};
  for (const tipo of TIPOS_DE_MEDIO) {
    const rotulo = compras.medioDePago(tipo);
    if (rotulo !== "") conocidos[tipo] = rotulo;
  }
  return conocidos;
}

/** Los rótulos de la hoja: hoja y valores. Sin texto aprobado, el código. */
export function rotulosDeLaExportacionDeCuentaCorriente(): RotulosDeLaExportacion {
  return {
    hoja: NOMBRE_DE_LA_HOJA,
    columnas: Object.fromEntries(
      COLUMNAS_DE_LA_EXPORTACION.map((c) => [c, encabezadoDe(c)]),
    ) as RotulosDeLaExportacion["columnas"],
    tramos: Object.fromEntries(
      TRAMOS_DE_ANTIGUEDAD.map((tramo) => [tramo, tramo]),
    ) as RotulosDeLaExportacion["tramos"],
    origenes: Object.fromEntries(
      ORIGENES_DE_LA_EXPORTACION.map((origen) => [origen, origen]),
    ) as RotulosDeLaExportacion["origenes"],
    estados: { VIGENTE: "VIGENTE", ANULADO: t("caja.estado.anulado") },
    si: "SI",
    no: "NO",
    clases: {},
    tiposDeMedio: tiposDeMedioConocidos(),
  };
}

/** El nombre de la hoja y del archivo: sin texto aprobado, el código `cuenta_corriente`. */
const NOMBRE_DE_LA_HOJA = "cuenta_corriente";

/** El nombre del archivo: el código y el día al que se calculó, solo con la fecha ya validada (nada escrito por la persona). */
export const nombreDelArchivoDeCuentaCorriente = (alDia: string): string =>
  `${NOMBRE_DE_LA_HOJA}_${alDia}.xlsx`;
