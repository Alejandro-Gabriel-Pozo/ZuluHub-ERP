import { TIPOS_DE_MEDIO } from "../modulos/caja/publico";
import {
  COLUMNAS_DE_LA_EXPORTACION,
  ORIGENES_DE_LA_EXPORTACION,
  TRAMOS_DE_ANTIGUEDAD,
  type ColumnaDeLaExportacion,
  type OrigenDeLaExportacion,
  type RotulosDeLaExportacion,
  type TramoDeAntiguedad,
} from "../modulos/cuenta_corriente/publico";
import { texto } from "../capacidades/vocabulario/vocabulario";
import { encabezadosDeCabecera, rotulosDeExportacion } from "./compras-exportacion-textos";

/**
 * Los textos del archivo de la cuenta corriente (CC-5 D; dueño, 26/11/2026: «usen textos de la exportación de Compras»). Ninguno se escribe a mano: todos salen del catálogo, y los diez que no
 * existían se asentaron en `DEC-CCL-007` (`textos-de-exportacion-de-cuenta-corriente.ts`). Un valor sin texto (una clase de asiento no prevista, un medio que el catálogo no conoce) sale con
 * su código estable: nunca un texto inventado. Previene: un encabezado o un valor escrito a mano que nadie aprobó. Chequeo: `cuenta-corriente-exportacion-textos.test.ts`.
 */

const t = (clave: Parameters<typeof texto>[1]): string => texto({}, clave);

const TEXTO_DE_TRAMO: Readonly<Record<TramoDeAntiguedad, () => string>> = {
  DE_0_A_30: () => t("exportacion_de_cuenta_corriente.tramo_0_a_30"),
  DE_31_A_60: () => t("exportacion_de_cuenta_corriente.tramo_31_a_60"),
  DE_61_A_90: () => t("exportacion_de_cuenta_corriente.tramo_61_a_90"),
  MAS_DE_90: () => t("exportacion_de_cuenta_corriente.tramo_mas_de_90"),
};

/** Las columnas que la exportación de compras ya tiene aprobadas: se piden con la misma función (fecha de negocio, moneda, sucursal, medio de pago y estado). */
function deCompras(): Readonly<Record<string, string>> {
  const columnas = ["fecha_de_negocio", "moneda", "sucursal", "medio_de_pago", "estado"] as const;
  const rotulos = encabezadosDeCabecera(columnas);
  return Object.fromEntries(columnas.map((c, i) => [c, rotulos[i] as string]));
}

function encabezados(): Readonly<Record<ColumnaDeLaExportacion, string>> {
  const compras = deCompras();
  return {
    cliente: t("fiscal.pantalla.rotulo_cliente"),
    cuit: t("fiscal.pantalla.documento_cuit"),
    fecha_de_negocio: compras["fecha_de_negocio"] as string,
    vence_el: t("compras.control.vence"),
    clase: t("cuenta_corriente.movimiento.movimiento"),
    // El importe del movimiento: el signo lo lleva el número (cargo suma, cobranza resta).
    importe_con_signo: t("ventas.cobro.importe"),
    pendiente: t("fiscal.pantalla.config_cartel_pendiente"),
    moneda: compras["moneda"] as string,
    antiguedad_en_dias: t("exportacion_de_cuenta_corriente.antiguedad_en_dias"),
    tramo_de_antiguedad: t("exportacion_de_cuenta_corriente.tramo_de_antiguedad"),
    vencida: t("cuenta_corriente.movimiento.vencida"),
    origen: t("cuenta_corriente.movimiento.origen_del_movimiento"),
    sucursal: compras["sucursal"] as string,
    medio_de_pago: compras["medio_de_pago"] as string,
    estado: compras["estado"] as string,
  };
}

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

function origenes(): Readonly<Record<OrigenDeLaExportacion, string>> {
  const textos: Readonly<Record<OrigenDeLaExportacion, string>> = {
    TICKET: t("fiscal.pantalla.imprimir_formato_ticket"),
    COBRANZA: t("exportacion_de_cuenta_corriente.cobranza"),
    OTRO: t("caja.medios.tipo.otro"),
  };
  return Object.fromEntries(ORIGENES_DE_LA_EXPORTACION.map((o) => [o, textos[o]])) as Readonly<
    Record<OrigenDeLaExportacion, string>
  >;
}

/** Los rótulos de la hoja: hoja, encabezados y valores. */
export function rotulosDeLaExportacionDeCuentaCorriente(): RotulosDeLaExportacion {
  return {
    hoja: t("cuenta_corriente.menu.entrada"),
    columnas: Object.fromEntries(
      COLUMNAS_DE_LA_EXPORTACION.map((c) => [c, encabezados()[c]]),
    ) as RotulosDeLaExportacion["columnas"],
    tramos: Object.fromEntries(
      TRAMOS_DE_ANTIGUEDAD.map((tramo) => [tramo, TEXTO_DE_TRAMO[tramo]()]),
    ) as RotulosDeLaExportacion["tramos"],
    origenes: origenes(),
    estados: {
      VIGENTE: t("exportacion_de_cuenta_corriente.vigente"),
      ANULADO: t("caja.estado.anulado"),
    },
    si: t("exportacion_de_cuenta_corriente.si"),
    no: t("exportacion_de_cuenta_corriente.no"),
    clases: {
      CARGO_DE_VENTA_A_CUENTA: t("cuenta_corriente.movimiento.venta_a_cuenta"),
      COBRANZA: t("exportacion_de_cuenta_corriente.cobranza"),
    },
    tiposDeMedio: tiposDeMedioConocidos(),
  };
}

/**
 * El nombre del archivo: el texto de la entrada del menú («Cuenta corriente») en minúsculas y con guion bajo (sin espacios), y el día al que se calculó, solo con la fecha ya validada (nada
 * escrito por la persona). No agrega ningún texto nuevo: sale de uno aprobado.
 */
export const nombreDelArchivoDeCuentaCorriente = (alDia: string): string =>
  `${t("cuenta_corriente.menu.entrada").toLowerCase().replaceAll(" ", "_")}_${alDia}.xlsx`;
