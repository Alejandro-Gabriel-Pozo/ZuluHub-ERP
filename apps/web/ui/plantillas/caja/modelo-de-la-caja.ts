import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import {
  importeATexto,
  importeCero,
  importeDesdeJson,
  importeDesdeTexto,
  restar,
  sumar,
  type ImporteJson,
} from "../../../../../src/primitivas/dinero/importe";
import { ARS } from "../../../../../src/primitivas/dinero/moneda";
import type { TonoDeEstado } from "../../componentes/Insignia";
import { formatearFecha, formatearImporte } from "../../patrones/formato-fiscal";
import type { AccionesDeLaPantallaDeCaja } from "./lista-de-caja";
import { nombreDelTipo } from "./modelo-de-medios-de-pago";

/**
 * El modelo de vista de la pantalla «Caja» del mostrador (maqueta aprobada `caja.html`; `vInicio`, `movHtml` y `resumenCierre`): de lo que entrega la composición (`LaCajaParaLaPantalla`),
 * lo que se dibuja y NADA más. Puro: sin React ni servidor, sin `Number` ni `Date` para dinero o fechas (los importes son texto decimal y se operan con las primitivas de dinero; el esperado y la
 * diferencia VIENEN del servidor). La UI no importa `src/modulos`: los tipos son propios y estructurales, la composición los cumple tal cual. Los textos salen del catálogo (`caja.*`).
 * No muestra del movimiento quién lo cargó (el servidor devuelve solo el id de la persona) ni `jornadaVencida` (sin texto aprobado).
 */

type LineaEsperada = Readonly<{
  medioDePagoId: string;
  medioTipo: string;
  medioNombre: string | null;
  cuentaDeCobroId: string | null;
  cuentaNombre: string | null;
  esperado: ImporteJson;
}>;

export type MovimientoDeLaCaja = Readonly<{
  id: string;
  clase: string;
  medioTipo: string;
  medioNombre: string | null;
  cuentaNombre: string | null;
  importe: ImporteJson;
  motivo: string | null;
  anuladoPor: string | null;
}>;

type SesionDeLaCaja = Readonly<{
  sesionId: string;
  fechaDeNegocio: string;
  horaDeCorte: string;
  lineas: readonly LineaEsperada[];
  movimientos: readonly MovimientoDeLaCaja[];
}>;

type LineaDeArqueo = LineaEsperada &
  Readonly<{ contado: ImporteJson | null; conforme: boolean; diferencia: ImporteJson | null }>;

export type UltimaSesionDeLaCaja = Readonly<{
  observacion: string | null;
  arqueo: readonly LineaDeArqueo[];
}>;

export type CajaDeLaPantalla = Readonly<{
  cajaId: string;
  nombre: string;
  estado: string;
  sesion: SesionDeLaCaja | null;
  ultimaSesion: UltimaSesionDeLaCaja | null;
}>;

export const ESTADOS_DE_CAJA = {
  sinSesion: "SIN_SESION",
  abierta: "ABIERTA",
  enCierre: "EN_CIERRE",
} as const;

/** Los textos de la clase de cada movimiento: tabla cerrada; una clase que la pantalla no conoce se dice con su propio valor (nunca se esconde un movimiento). */
const CLASES: Readonly<Record<string, ClaveDeTexto>> = {
  FONDO_INICIAL: "caja.movimiento.fondo_inicial",
  COBRO: "caja.movimiento.cobro",
  ANULACION: "caja.movimiento.anulacion",
};

const EFECTIVO = "EFECTIVO";

export const rotuloDeLaClase = (clase: string): string =>
  Object.hasOwn(CLASES, clase) ? texto({}, CLASES[clase] as ClaveDeTexto) : clase;

/** El medio como se lee: su nombre propio si lo tiene, si no el de su tipo. */
export const rotuloDelMedio = (medioTipo: string, medioNombre: string | null): string =>
  medioNombre !== null && medioNombre !== "" ? medioNombre : nombreDelTipo(medioTipo);

/** La cuenta de cobro de un medio que no es el efectivo; sin cuenta, «Sin cuenta». El efectivo no lleva cuenta: `null`. */
export const rotuloDeLaCuenta = (medioTipo: string, cuentaNombre: string | null): string | null =>
  medioTipo === EFECTIVO
    ? null
    : cuentaNombre !== null && cuentaNombre !== ""
      ? cuentaNombre
      : texto({}, "caja.sin_cuenta");

/** Un importe (texto decimal) como «$ 1.500,00». Solo pesos en v1. */
export const importeParaMostrar = (importe: ImporteJson): string => formatearImporte(importe.monto);

/** «2026-11-09» pasa a «09/11/2026» (manipulación de texto, sin `Date`). */
export const fechaParaMostrar = formatearFecha;

/** La cabecera de la sesión abierta: «Jornada 09/11/2026 · Corte 00:00». */
export const cabeceraDeJornada = (fechaDeNegocio: string, horaDeCorte: string): string =>
  `${texto({}, "caja.sesion.jornada")} ${fechaParaMostrar(fechaDeNegocio)} · ${texto({}, "caja.sesion.corte")} ${horaDeCorte}`;

/** El estado de la caja: sin sesión, «Cerrada»; con sesión (también en cierre: la sesión sigue abierta hasta cerrarse), «Abierta». */
export const estadoDeLaCaja = (estado: string): Readonly<{ texto: string; tono: TonoDeEstado }> =>
  estado === ESTADOS_DE_CAJA.sinSesion
    ? { texto: texto({}, "caja.estado.cerrada"), tono: "aviso" }
    : { texto: texto({}, "caja.estado.abierta"), tono: "exito" };

/** La suma exacta (con las primitivas de dinero) de importes en pesos, como texto decimal. */
export function sumaDeImportes(importes: readonly ImporteJson[]): string {
  let suma = importeCero(ARS);
  for (const importe of importes) suma = sumar(suma, importeDesdeJson(importe));
  return importeATexto(suma);
}

/** El efectivo que debería haber: la suma de las líneas de efectivo de la sesión; el servidor ya calculó el esperado de cada línea. */
export const efectivoEsperado = (lineas: readonly LineaEsperada[]): string =>
  sumaDeImportes(lineas.filter((l) => l.medioTipo === EFECTIVO).map((l) => l.esperado));

/** «Efectivo: $ 1.500,00». */
export const textoDelEfectivo = (lineas: readonly LineaEsperada[]): string =>
  `${nombreDelTipo(EFECTIVO)}: ${formatearImporte(efectivoEsperado(lineas))}`;

/** Qué botones de la caja se ofrecen activos: lo que el servidor deja hacer (`acciones`) y el estado de la caja. Solo una ayuda: el servidor decide al enviar. */
export type BotonesDeLaCaja = Readonly<{ abrir: boolean; cerrar: boolean }>;

export function botonesDeLaCaja(
  estado: string,
  acciones: AccionesDeLaPantallaDeCaja,
): BotonesDeLaCaja {
  const conSesion = estado === ESTADOS_DE_CAJA.abierta || estado === ESTADOS_DE_CAJA.enCierre;
  return {
    abrir: estado === ESTADOS_DE_CAJA.sinSesion && acciones.abrir,
    cerrar: conSesion && acciones.iniciarCierre,
  };
}

export type LineaDeMovimiento = Readonly<{
  id: string;
  clase: string;
  anulado: boolean;
  motivo: string | null;
  /** «Efectivo» o «Tarjeta de débito · Posnet 1». */
  detalle: string;
  importe: string;
}>;

/** Una línea de la lista de movimientos de la jornada (solo lectura). Marca el anulado, lleva la cuenta de un medio que no es efectivo y el motivo si hay. */
export function lineaDeMovimiento(m: MovimientoDeLaCaja): LineaDeMovimiento {
  const cuenta = rotuloDeLaCuenta(m.medioTipo, m.cuentaNombre);
  const medio = rotuloDelMedio(m.medioTipo, m.medioNombre);
  return {
    id: m.id,
    clase: rotuloDeLaClase(m.clase),
    anulado: m.anuladoPor !== null,
    motivo: m.motivo,
    detalle: cuenta === null ? medio : `${medio} · ${cuenta}`,
    importe: importeParaMostrar(m.importe),
  };
}

/** La diferencia contra lo esperado: en rojo si falta, en aviso si sobra, sin tono si es cero. `null` si no hay. */
export function tonoDeLaDiferencia(diferencia: string | null): "peligro" | "aviso" | null {
  if (diferencia === null) return null;
  const cantidad = importeDesdeTexto(ARS, diferencia).unidades;
  if (cantidad < 0n) return "peligro";
  return cantidad > 0n ? "aviso" : null;
}

/** Contado menos esperado, exacto, como texto decimal; `null` si no hay contado. */
export function diferenciaDe(contado: string | null, esperado: string): string | null {
  return contado === null
    ? null
    : importeATexto(restar(importeDesdeTexto(ARS, contado), importeDesdeTexto(ARS, esperado)));
}

export type FilaDeResumen = Readonly<{
  clave: string;
  titulo: string;
  cuenta: string | null;
  /** «Conforme», lo contado o «Sin declarar». */
  principal: string;
  /** «Esperado $ x» y, si no es conforme y hay contado, «· Diferencia $ y». */
  secundaria: string;
  tonoDeLaDiferencia: "peligro" | "aviso" | null;
}>;

/** El resumen de la última sesión cerrada (`resumenCierre`): una fila por medio y cuenta, la observación si hay. */
export function resumenDeLaUltimaSesion(u: UltimaSesionDeLaCaja): Readonly<{
  filas: readonly FilaDeResumen[];
  observacion: string | null;
}> {
  const filas = u.arqueo.map((l) => {
    const esperado = `${texto({}, "caja.arqueo.esperado")} ${importeParaMostrar(l.esperado)}`;
    const dif =
      l.conforme || l.diferencia === null
        ? null
        : `${texto({}, "caja.arqueo.diferencia")} ${importeParaMostrar(l.diferencia)}`;
    return {
      clave: `${l.medioDePagoId}|${l.cuentaDeCobroId ?? ""}`,
      titulo: rotuloDelMedio(l.medioTipo, l.medioNombre),
      cuenta: rotuloDeLaCuenta(l.medioTipo, l.cuentaNombre),
      principal: l.conforme
        ? texto({}, "caja.conforme")
        : l.contado === null
          ? texto({}, "caja.sin_declarar")
          : importeParaMostrar(l.contado),
      secundaria: dif === null ? esperado : `${esperado} · ${dif}`,
      tonoDeLaDiferencia: l.conforme ? null : tonoDeLaDiferencia(l.diferencia?.monto ?? null),
    };
  });
  return {
    filas,
    observacion: u.observacion === "" ? null : u.observacion,
  };
}

/** Un texto de una línea que respeta el largo máximo de su dato (el largo viene de la primitiva del dato, no se escribe acá). */
export const limitarElTexto = (valor: string, largoMaximo: number): string =>
  valor.slice(0, largoMaximo);

/** ¿Se puede abrir la caja? Con el fondo inicial declarado. */
export const puedeAbrir = (fondoInicial: string): boolean => fondoInicial !== "";
