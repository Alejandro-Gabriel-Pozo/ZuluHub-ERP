import { importeATexto, type Importe } from "../../../primitivas/dinero/importe";
import {
  MAXIMO_DE_REFERENCIAS,
  type ControlDelDia,
  type ReconocimientoDeControl,
} from "../../cierre/publico";
import type { EstadoDeSesion } from "../estados";
import { hayDiferenciaDeArqueo } from "./arqueo";
import type { DiferenciaDeTicket } from "./cobrado-contra-ticket";
import { lineaPorExplicar, type LineaDeConciliacion } from "./conciliacion";
import { CONTROLES_DE_CAJA, type DefinicionDeControl } from "./controles";
import { huellaDeCampos, type CampoDeHuella } from "./huella";
import type { ParDeCobro } from "./medios";

/**
 * Los controles que caja entrega al cierre del día (e3b §4.2), calculados SOLO con datos que llegan ya leídos: sin reloj ni azar, así que
 * con los mismos datos dan la misma huella, en cualquier orden de llegada (todo se ordena acá). `cierre` compara esa huella con la que vio
 * la pantalla: si el detalle cambia, la huella cambia y no se cierra con algo que nadie vio. Puro.
 * Previene: un control que cambia de resultado según el orden de las filas (el cierre fallaría con `CONTROLES_CAMBIARON` sin que nada cambie)
 * y un detalle que cambia sin que la huella lo note.
 */

export type SesionParaControles = Readonly<{
  id: string;
  estado: EstadoDeSesion;
  /** Las líneas del arqueo que quedó al cerrarla (vacío si no se cerró). */
  arqueo: readonly Readonly<ParDeCobro & { diferencia: Importe | null }>[];
}>;

export type CorreccionParaControles = Readonly<{
  id: string;
  cobroId: string;
  secuencia: number;
  importe: Importe;
  antes: ParDeCobro;
  despues: ParDeCobro;
}>;

export type AjusteParaControles = Readonly<
  ParDeCobro & { id: string; corrigeJornada: string; importe: Importe }
>;

export type DatosParaLosControles = Readonly<{
  sesiones: readonly SesionParaControles[];
  conciliacion: readonly LineaDeConciliacion[];
  diferenciasDeTicket: readonly DiferenciaDeTicket[];
  correcciones: readonly CorreccionParaControles[];
  /** Los ajustes de ESTA jornada que corrigen una jornada ya cerrada. */
  ajustes: readonly AjusteParaControles[];
}>;

type Fila = readonly CampoDeHuella[];

/**
 * El orden de las filas no depende de cómo llegaron: se ordena su texto con el orden por defecto (unidades de código), sin comparador propio
 * (como `ordenarControles` de `cierre`).
 */
const ordenadas = (filas: readonly Fila[]): string[] =>
  filas.map((fila) => JSON.stringify(fila)).sort();

function referenciasDe(referencias: readonly string[]): string[] {
  return [...new Set(referencias)].sort().slice(0, MAXIMO_DE_REFERENCIAS);
}

function controlDe(
  definicion: DefinicionDeControl,
  filas: readonly Fila[],
  referencias: readonly string[],
): ControlDelDia {
  return {
    modulo: "caja",
    clave: definicion.clave,
    severidad: definicion.severidad,
    cantidad: filas.length,
    huellaDelDetalle: huellaDeCampos([definicion.clave, JSON.stringify(ordenadas(filas))]),
    referencias: referenciasDe(referencias),
  };
}

/** La referencia de un par (medio, cuenta) para que la pantalla navegue a su línea de la conciliación. */
export const referenciaDelPar = (par: ParDeCobro): string =>
  `${par.medioDePagoId}/${par.cuentaDeCobroId ?? "sin_cuenta"}`;

const textoONulo = (importe: Importe | null): string | null =>
  importe === null ? null : importeATexto(importe);

function sesionesSinCerrar(sesiones: readonly SesionParaControles[]): ControlDelDia {
  const abiertas = sesiones.filter((s) => s.estado !== "CERRADA");
  return controlDe(
    CONTROLES_DE_CAJA.SESIONES_SIN_CERRAR,
    abiertas.map((s) => [s.id, s.estado]),
    abiertas.map((s) => s.id),
  );
}

/**
 * Lo que impide EMPEZAR a contar el día (e3b §3.4): las sesiones sin cerrar (hay dinero todavía sin contar). Es el mismo control
 * `caja.sesiones_sin_cerrar` que después aparece entre los controles.
 */
export function impedimentosDeCaja(
  sesiones: readonly SesionParaControles[],
): readonly ControlDelDia[] {
  return [sesionesSinCerrar(sesiones)];
}

function diferenciasDeArqueo(sesiones: readonly SesionParaControles[]): ControlDelDia {
  const conDiferencia = sesiones.filter((s) => hayDiferenciaDeArqueo(s.arqueo));
  const filas = conDiferencia.flatMap((s) =>
    s.arqueo
      .filter((l) => l.diferencia !== null && l.diferencia.unidades !== 0n)
      .map((l) => [s.id, l.medioDePagoId, l.cuentaDeCobroId, textoONulo(l.diferencia)]),
  );
  return {
    ...controlDe(
      CONTROLES_DE_CAJA.DIFERENCIA_DE_ARQUEO,
      filas,
      conDiferencia.map((s) => s.id),
    ),
    // La cantidad son las SESIONES con diferencia, no sus líneas.
    cantidad: conDiferencia.length,
  };
}

function conciliacionPorMedio(lineas: readonly LineaDeConciliacion[]): ControlDelDia {
  // El detalle es TODA la conciliación (lo que muestra la pantalla); la cantidad, solo lo que hay que explicar.
  const filas = lineas.map((l) => [
    l.medioDePagoId,
    l.cuentaDeCobroId,
    l.estado,
    importeATexto(l.registrado),
    importeATexto(l.correcciones),
    textoONulo(l.declarado),
    textoONulo(l.diferencia),
    l.conformePor,
    l.conformeEn === null ? null : l.conformeEn.toISOString(),
  ]);
  const porExplicar = lineas.filter(lineaPorExplicar);
  return {
    ...controlDe(
      CONTROLES_DE_CAJA.CONCILIACION_POR_MEDIO,
      filas,
      porExplicar.map(referenciaDelPar),
    ),
    cantidad: porExplicar.length,
  };
}

function cobradoContraTicket(diferencias: readonly DiferenciaDeTicket[]): ControlDelDia {
  return controlDe(
    CONTROLES_DE_CAJA.COBRADO_CONTRA_TICKET,
    diferencias.map((d) => [
      d.origen.tipo,
      d.origen.id,
      d.ticketId,
      importeATexto(d.cobrado),
      importeATexto(d.totalDelTicket),
      importeATexto(d.diferencia),
    ]),
    diferencias.map((d) => d.origen.id),
  );
}

function cobrosCorregidos(correcciones: readonly CorreccionParaControles[]): ControlDelDia {
  return controlDe(
    CONTROLES_DE_CAJA.COBROS_CORREGIDOS,
    correcciones.map((c) => [
      c.id,
      c.cobroId,
      c.secuencia,
      importeATexto(c.importe),
      c.antes.medioDePagoId,
      c.antes.cuentaDeCobroId,
      c.despues.medioDePagoId,
      c.despues.cuentaDeCobroId,
    ]),
    correcciones.map((c) => c.cobroId),
  );
}

function ajustesACerradas(ajustes: readonly AjusteParaControles[]): ControlDelDia {
  return controlDe(
    CONTROLES_DE_CAJA.AJUSTES_A_JORNADAS_CERRADAS,
    ajustes.map((a) => [
      a.id,
      a.corrigeJornada,
      importeATexto(a.importe),
      a.medioDePagoId,
      a.cuentaDeCobroId,
    ]),
    ajustes.map((a) => a.id),
  );
}

/** Los seis controles de caja, en el orden de `CONTROLES_DE_CAJA` (e3b §4.2). */
export function controlesDeCaja(datos: DatosParaLosControles): readonly ControlDelDia[] {
  return [
    sesionesSinCerrar(datos.sesiones),
    diferenciasDeArqueo(datos.sesiones),
    conciliacionPorMedio(datos.conciliacion),
    cobradoContraTicket(datos.diferenciasDeTicket),
    cobrosCorregidos(datos.correcciones),
    ajustesACerradas(datos.ajustes),
  ];
}

/**
 * La explicación opcional que quien cierra escribió al reconocer un control (decisión 160): `null` si no reconoció ese control o no
 * escribió nada. Se copia a cada línea que ese control cuenta (conciliación por medio, cobrado contra ticket) al congelar.
 */
export function explicacionDelReconocimiento(
  reconocidos: readonly ReconocimientoDeControl[],
  definicion: DefinicionDeControl,
): string | null {
  return reconocidos.find((r) => r.clave === definicion.clave)?.texto ?? null;
}
