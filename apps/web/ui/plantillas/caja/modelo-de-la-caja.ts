import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import {
  importeATexto,
  importeCero,
  importeDesdeJson,
  sumar,
  type ImporteJson,
} from "../../../../../src/primitivas/dinero/importe";
import { ARS } from "../../../../../src/primitivas/dinero/moneda";
import type { TonoDeEstado } from "../../componentes/Insignia";
import { formatearFecha, formatearImporte } from "../../patrones/formato-fiscal";
import type { AccionesDeLaPantallaDeCaja } from "./lista-de-caja";

/**
 * El modelo de vista de la pantalla «Caja» del mostrador (maqueta aprobada `caja.html`; `vInicio`): de lo que entrega la composición (`LaCajaParaLaPantalla`), lo que se dibuja y NADA más.
 * Puro: sin React ni servidor, sin `Number` ni `Date` para dinero o fechas (los importes son texto decimal y se operan con las primitivas de dinero; el esperado VIENE del servidor). La UI
 * no importa `src/modulos`: los tipos son propios y estructurales, la composición los cumple tal cual. Los textos salen del catálogo (`caja.*`). Hoy dibuja abrir; los tramos siguientes
 * suman cerrar y la jornada.
 */

type LineaEsperada = Readonly<{ medioTipo: string; esperado: ImporteJson }>;

type SesionDeLaCaja = Readonly<{
  fechaDeNegocio: string;
  horaDeCorte: string;
  lineas: readonly LineaEsperada[];
}>;

export type CajaDeLaPantalla = Readonly<{
  cajaId: string;
  nombre: string;
  estado: string;
  sesion: SesionDeLaCaja | null;
}>;

const ESTADOS_DE_CAJA = {
  sinSesion: "SIN_SESION",
  abierta: "ABIERTA",
  enCierre: "EN_CIERRE",
} as const;

const EFECTIVO = "EFECTIVO";

/** «2026-11-09» pasa a «09/11/2026» (manipulación de texto, sin `Date`). */
const fechaParaMostrar = formatearFecha;

/** La cabecera de la sesión abierta: «Jornada 09/11/2026 · Corte 00:00». */
export const cabeceraDeJornada = (fechaDeNegocio: string, horaDeCorte: string): string =>
  `${texto({}, "caja.sesion.jornada")} ${fechaParaMostrar(fechaDeNegocio)} · ${texto({}, "caja.sesion.corte")} ${horaDeCorte}`;

/** El estado de la caja: sin sesión, «Cerrada»; con sesión (también en cierre: la sesión sigue abierta hasta cerrarse), «Abierta». */
export const estadoDeLaCaja = (estado: string): Readonly<{ texto: string; tono: TonoDeEstado }> =>
  estado === ESTADOS_DE_CAJA.sinSesion
    ? { texto: texto({}, "caja.estado.cerrada"), tono: "aviso" }
    : { texto: texto({}, "caja.estado.abierta"), tono: "exito" };

/** El efectivo que debería haber: la suma exacta (primitivas de dinero) de las líneas de efectivo de la sesión; el servidor ya calculó el esperado de cada línea. */
export function efectivoEsperado(lineas: readonly LineaEsperada[]): string {
  let suma = importeCero(ARS);
  for (const l of lineas) {
    if (l.medioTipo === EFECTIVO) suma = sumar(suma, importeDesdeJson(l.esperado));
  }
  return importeATexto(suma);
}

/** «Efectivo: $ 1.500,00». */
export const textoDelEfectivo = (lineas: readonly LineaEsperada[]): string =>
  `${texto({}, "caja.medios.tipo.efectivo")}: ${formatearImporte(efectivoEsperado(lineas))}`;

/** Qué botones de la caja se ofrecen activos: lo que el servidor deja hacer (`acciones`) y el estado de la caja. Solo una ayuda: el servidor decide al enviar. */
export type BotonesDeLaCaja = Readonly<{ abrir: boolean }>;

export const botonesDeLaCaja = (
  estado: string,
  acciones: AccionesDeLaPantallaDeCaja,
): BotonesDeLaCaja => ({ abrir: estado === ESTADOS_DE_CAJA.sinSesion && acciones.abrir });

/** ¿Se puede abrir la caja? Con el fondo inicial declarado. */
export const puedeAbrir = (fondoInicial: string): boolean => fondoInicial !== "";
