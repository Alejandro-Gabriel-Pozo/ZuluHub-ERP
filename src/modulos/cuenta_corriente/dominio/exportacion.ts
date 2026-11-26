import {
  importeATexto,
  importeCero,
  restar,
  type Importe,
} from "../../../primitivas/dinero/importe";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { antiguedadEnDias, type DatosDelCliente } from "../antiguedad";
import { ORIGEN_DE_LA_COBRANZA_DE_VENTA, ORIGEN_DEL_CARGO_DE_VENTA } from "./cargo-de-venta";

/**
 * La exportación de la cuenta corriente de clientes para tablas dinámicas (CC-4; pedido del dueño): una hoja PLANA en formato largo, una fila por movimiento del libro de clase `A_COBRAR`
 * (con una fila por cada medio de pago cuando una cobranza se pagó con varios), sin celdas combinadas ni totales intercalados: cada dimensión es una columna. Puro: sin reloj ni azar
 * (la fecha de la exportación entra como parámetro), sin textos de pantalla (los códigos de cada valor los traduce quien arma el archivo) y sin `number` de dinero.
 * Previene: un total intercalado que duplica en la tabla dinámica, una cobranza con dos medios que se cuenta dos veces y una columna que cambia de nombre entre exportaciones.
 * Invariante: la suma de `importeConSigno` de TODAS las filas de un cliente es EXACTAMENTE su saldo del libro (las anuladas, con su espejo, suman cero).
 */
/**
 * Tope de filas de UNA exportación: por encima NO se corta en silencio ni se arma a medias, se rechaza el pedido entero. Previene: una petición web que arma un archivo sin tope (memoria y
 * tiempo de la función) y un archivo parcial que parece completo.
 */
export const FILAS_MAXIMAS_DE_LA_EXPORTACION = 20_000;

export const COLUMNAS_DE_LA_EXPORTACION = [
  "cliente",
  "cuit",
  "fecha_de_negocio",
  "vence_el",
  "clase",
  "importe_con_signo",
  "pendiente",
  "moneda",
  "antiguedad_en_dias",
  "tramo_de_antiguedad",
  "vencida",
  "origen",
  "sucursal",
  "medio_de_pago",
  "estado",
] as const;
export type ColumnaDeLaExportacion = (typeof COLUMNAS_DE_LA_EXPORTACION)[number];

/** Los cuatro tramos de antigüedad del brief: 0–30, 31–60, 61–90 y más de 90 días (el límite superior de cada uno está incluido). */
export const TRAMOS_DE_ANTIGUEDAD = ["DE_0_A_30", "DE_31_A_60", "DE_61_A_90", "MAS_DE_90"] as const;
export type TramoDeAntiguedad = (typeof TRAMOS_DE_ANTIGUEDAD)[number];

export function tramoDeAntiguedad(dias: number): TramoDeAntiguedad {
  if (dias <= 30) return "DE_0_A_30";
  if (dias <= 60) return "DE_31_A_60";
  if (dias <= 90) return "DE_61_A_90";
  return "MAS_DE_90";
}

export { antiguedadEnDias };

export const ORIGENES_DE_LA_EXPORTACION = ["TICKET", "COBRANZA", "OTRO"] as const;
export type OrigenDeLaExportacion = (typeof ORIGENES_DE_LA_EXPORTACION)[number];

export function origenDeLaExportacion(origenTipo: string): OrigenDeLaExportacion {
  if (origenTipo === ORIGEN_DEL_CARGO_DE_VENTA) return "TICKET";
  if (origenTipo === ORIGEN_DE_LA_COBRANZA_DE_VENTA) return "COBRANZA";
  return "OTRO";
}

/** Lo que el armado necesita saber de un movimiento del libro (lo lee `saldos_de_partes`; los tipos son propios para no depender de su persistencia). */
export type MovimientoParaExportar = Readonly<{
  asientoId: string;
  parteId: string;
  clase: string;
  importe: Importe;
  pendiente: Importe;
  anulado: boolean;
  vencida: boolean;
  fechaNegocio: FechaCivil;
  venceEl: FechaCivil | null;
  origenTipo: string;
  origenId: string;
  sucursales: readonly (string | null)[];
}>;

/** Un medio con el que se pagó una cobranza (el medio VIGENTE del cobro de caja, con sus correcciones aplicadas) y lo que se pagó con él. */
export type MedioDeCobranza = Readonly<{ orden: number; tipoDeMedio: string; importe: Importe }>;

export type ClienteParaExportar = DatosDelCliente;

export type FilaDeExportacion = Readonly<{
  parteId: string;
  asientoId: string;
  cliente: string | null;
  cuit: string | null;
  fechaDeNegocio: FechaCivil;
  venceEl: FechaCivil | null;
  clase: string;
  /** Texto decimal exacto con su signo: positivo suma lo que el cliente debe; negativo lo resta. */
  importeConSigno: string;
  /** Solo un cargo vigente con algo por saldar: lo que le falta (`importe − imputado`). El resto, `0.00`. Aparte de `importeConSigno` para no romper la suma por cliente. */
  pendiente: string;
  moneda: "ARS";
  antiguedadEnDias: number;
  tramoDeAntiguedad: TramoDeAntiguedad;
  vencida: boolean;
  origen: OrigenDeLaExportacion;
  /** El id de la sucursal (centro de costo) si el movimiento tiene UNA; `null` si no tiene o si tiene varias. */
  sucursalId: string | null;
  /** El nombre de esa sucursal (`null` si no hay sucursal o no se encontró). */
  sucursal: string | null;
  /** El tipo del medio de pago de la cobranza (`null` si no es una cobranza o su medio no se pudo determinar). */
  tipoDeMedio: string | null;
  estado: "VIGENTE" | "ANULADO";
}>;

/**
 * Arma las filas de la exportación. Un movimiento sale como UNA fila, salvo una cobranza cuyos medios suman EXACTAMENTE su importe: sale una fila por medio (mismo asiento, cada
 * una con su importe), así la suma por cliente sigue siendo el saldo. Si los medios no suman el importe (o no hay), sale UNA fila con el importe completo y el medio vacío: nunca se
 * inventa ni se pierde un centavo. El espejo de una anulación reparte igual que el asiento que anula, con el signo contrario. Orden: el del libro (por cliente y registro).
 */
export function armarFilasDeLaExportacion(
  movimientos: readonly MovimientoParaExportar[],
  clientes: ReadonlyMap<string, ClienteParaExportar>,
  mediosPorCobranza: ReadonlyMap<string, readonly MedioDeCobranza[]>,
  nombresDeSucursales: ReadonlyMap<string, string>,
  hoy: FechaCivil,
): FilaDeExportacion[] {
  const filas: FilaDeExportacion[] = [];
  for (const m of movimientos) {
    const cliente = clientes.get(m.parteId);
    const origen = origenDeLaExportacion(m.origenTipo);
    const antiguedad = antiguedadEnDias(m.fechaNegocio, hoy);
    const sucursales = [...new Set(m.sucursales)];
    const sucursalId = sucursales.length === 1 ? (sucursales[0] ?? null) : null;
    const base = {
      parteId: m.parteId,
      asientoId: m.asientoId,
      cliente: cliente?.nombre ?? null,
      cuit: cliente?.cuit ?? null,
      fechaDeNegocio: m.fechaNegocio,
      venceEl: m.venceEl,
      clase: m.clase,
      pendiente: importeATexto(m.pendiente),
      moneda: "ARS" as const,
      antiguedadEnDias: antiguedad,
      tramoDeAntiguedad: tramoDeAntiguedad(antiguedad),
      vencida: m.vencida,
      origen,
      sucursalId,
      sucursal: sucursalId === null ? null : (nombresDeSucursales.get(sucursalId) ?? null),
      estado: m.anulado ? ("ANULADO" as const) : ("VIGENTE" as const),
    };
    const medios = origen === "COBRANZA" ? (mediosPorCobranza.get(m.origenId) ?? []) : [];
    const total = medios.reduce((suma, medio) => suma + medio.importe.unidades, 0n);
    // El importe del asiento va con su signo (negativo en una cobranza); los medios, en positivo: se reparte el valor absoluto y se devuelve el signo.
    const absoluto = m.importe.unidades < 0n ? -m.importe.unidades : m.importe.unidades;
    if (medios.length > 1 && total === absoluto) {
      const negativo = m.importe.unidades < 0n;
      for (const medio of [...medios].sort((a, b) => a.orden - b.orden)) {
        filas.push({
          ...base,
          importeConSigno: importeATexto(
            negativo ? restar(importeCero(m.importe.moneda), medio.importe) : medio.importe,
          ),
          tipoDeMedio: medio.tipoDeMedio,
        });
      }
      continue;
    }
    filas.push({
      ...base,
      importeConSigno: importeATexto(m.importe),
      tipoDeMedio:
        medios.length === 1 && total === absoluto ? (medios[0]?.tipoDeMedio ?? null) : null,
    });
  }
  return filas;
}
