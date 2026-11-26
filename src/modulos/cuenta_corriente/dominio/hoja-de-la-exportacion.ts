import {
  celdaDeFecha,
  celdaDeTexto,
  celdaDecimal,
  celdaEntera,
  type Celda,
  type HojaDePlanilla,
} from "../../../primitivas/planilla/celda";
import {
  COLUMNAS_DE_LA_EXPORTACION,
  type ColumnaDeLaExportacion,
  type FilaDeExportacion,
  type OrigenDeLaExportacion,
  type TramoDeAntiguedad,
} from "./exportacion";

/**
 * Los textos con que se escribe la hoja: los pone QUIEN ARMA EL ARCHIVO desde el catálogo de textos aprobados (este módulo no escribe ningún texto de pantalla). Un valor sin texto
 * (una clase de asiento nueva, un tipo de medio no previsto) sale con su código, que es estable: nunca un texto inventado.
 */
export type RotulosDeLaExportacion = Readonly<{
  hoja: string;
  columnas: Readonly<Record<ColumnaDeLaExportacion, string>>;
  tramos: Readonly<Record<TramoDeAntiguedad, string>>;
  origenes: Readonly<Record<OrigenDeLaExportacion, string>>;
  estados: Readonly<Record<FilaDeExportacion["estado"], string>>;
  si: string;
  no: string;
  clases: Readonly<Record<string, string>>;
  tiposDeMedio: Readonly<Record<string, string>>;
}>;

/**
 * La hoja plana: una fila por fila de la exportación, las columnas en el orden fijo de `COLUMNAS_DE_LA_EXPORTACION`, sin celdas combinadas ni totales. Las fechas salen como fecha civil
 * (`AAAA-MM-DD`, sin hora ni zona), el dinero como decimal exacto de 2 decimales con su signo (nunca `number`) y todo texto de cliente como celda de TEXTO: el escritor del archivo
 * nunca lo interpreta como fórmula.
 */
export function armarHojaDeLaExportacion(
  filas: readonly FilaDeExportacion[],
  rotulos: RotulosDeLaExportacion,
): HojaDePlanilla {
  const celdas = (f: FilaDeExportacion): Readonly<Record<ColumnaDeLaExportacion, Celda>> => ({
    cliente: celdaDeTexto(f.cliente),
    cuit: celdaDeTexto(f.cuit),
    fecha_de_negocio: celdaDeFecha(f.fechaDeNegocio),
    vence_el: celdaDeFecha(f.venceEl),
    clase: celdaDeTexto(rotulos.clases[f.clase] ?? f.clase),
    importe_con_signo: celdaDecimal(f.importeConSigno, 2),
    pendiente: celdaDecimal(f.pendiente, 2),
    moneda: celdaDeTexto(f.moneda),
    antiguedad_en_dias: celdaEntera(f.antiguedadEnDias),
    tramo_de_antiguedad: celdaDeTexto(rotulos.tramos[f.tramoDeAntiguedad]),
    vencida: celdaDeTexto(f.vencida ? rotulos.si : rotulos.no),
    origen: celdaDeTexto(rotulos.origenes[f.origen]),
    sucursal: celdaDeTexto(f.sucursal),
    medio_de_pago: celdaDeTexto(
      f.tipoDeMedio === null ? null : (rotulos.tiposDeMedio[f.tipoDeMedio] ?? f.tipoDeMedio),
    ),
    estado: celdaDeTexto(rotulos.estados[f.estado]),
  });
  return {
    nombre: rotulos.hoja,
    encabezados: COLUMNAS_DE_LA_EXPORTACION.map((c) => rotulos.columnas[c]),
    filas: filas.map((f) => {
      const por = celdas(f);
      return COLUMNAS_DE_LA_EXPORTACION.map((c) => por[c]);
    }),
  };
}
