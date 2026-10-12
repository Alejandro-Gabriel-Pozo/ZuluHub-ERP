import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { DesenlaceDeAutorizacion, TipoDeComprobante } from "./comprobante-emitido";
import type { EmisorId, PuntoDeVentaId, SolicitudId } from "./identificadores";

/**
 * Numeración de comprobantes sin huecos ni duplicados (spec H7 §B.8). Una serie por (punto de
 * venta, tipo) con tres estados:
 *
 * - `LIBRE`: nadie tiene un número reservado.
 * - `EN_CURSO`: una solicitud reservó `ultimoNumero + 1` y está pidiendo la autorización.
 * - `BLOQUEADA`: la reconciliación encontró un desfase con el servicio. En H7 no tiene salida (la
 *   diseña la facturación).
 *
 * Todo es puro: sin reloj ni azar (la hora y el último número del servicio entran como datos) y sin
 * I/O. La transacción serializable y el disparador de la base imponen lo mismo (un test compara
 * ambos); acá están las reglas para probarlas sin base.
 */
export type EstadoDeSerie = "LIBRE" | "EN_CURSO" | "BLOQUEADA";

/**
 * Transiciones de estado permitidas. Una serie `EN_CURSO` que sigue `EN_CURSO` (autorización
 * incierta) no cambia de estado y no figura acá. La base impone la misma tabla con un disparador.
 */
export const TRANSICIONES_DE_SERIE: Readonly<Record<EstadoDeSerie, readonly EstadoDeSerie[]>> = {
  LIBRE: ["EN_CURSO"],
  EN_CURSO: ["LIBRE", "BLOQUEADA"],
  BLOQUEADA: [],
};

type IdentidadDeSerie = Readonly<{
  empresaId: EmpresaId;
  puntoDeVentaId: PuntoDeVentaId;
  /** Atado al punto de venta por clave compuesta: una serie no mezcla emisor y punto de venta. */
  emisorId: EmisorId;
  tipo: TipoDeComprobante;
  version: number;
}>;

export type SerieLibre = IdentidadDeSerie & Readonly<{ estado: "LIBRE"; ultimoNumero: bigint }>;

export type SerieEnCurso = IdentidadDeSerie &
  Readonly<{
    estado: "EN_CURSO";
    ultimoNumero: bigint;
    /** Siempre `ultimoNumero + 1`. */
    numeroEnCurso: bigint;
    solicitud: SolicitudId;
    /** Pasado este instante la reserva se considera vencida y se reconcilia. */
    enCursoHasta: Date;
  }>;

export type SerieBloqueada = IdentidadDeSerie &
  Readonly<{ estado: "BLOQUEADA"; ultimoNumero: bigint; motivoBloqueo: string }>;

export type Serie = SerieLibre | SerieEnCurso | SerieBloqueada;

export type ErrorDeNumeracion =
  | "SERIE_OCUPADA"
  | "SERIE_BLOQUEADA"
  | "SERIE_AGOTADA"
  | "SOLICITUD_NO_VIGENTE"
  | "SERIE_NO_EN_CURSO"
  | "RESERVA_NO_VENCIDA"
  | "NUMERO_INVALIDO";

/**
 * Valores configurables.
 * - `plazoDeReservaEnMs`: cuánto dura una reserva antes de poder reconciliarse. SUPUESTO (5 minutos);
 *   el diseño no lo fija.
 * - `numeroMaximo`: tope del número de comprobante. El tamaño máximo en ARCA es NO VERIFICADO; el
 *   valor por defecto es el máximo de la columna `bigint` de la base (2^63 − 1).
 */
export type OpcionesDeNumeracion = Readonly<{ plazoDeReservaEnMs: number; numeroMaximo: bigint }>;

export const OPCIONES_DE_NUMERACION: OpcionesDeNumeracion = {
  plazoDeReservaEnMs: 5 * 60_000,
  numeroMaximo: 9_223_372_036_854_775_807n,
};

/** Una serie `LIBRE` nueva con el último número que informa el servicio de emisión (o cero). */
export function iniciarSerie(
  identidad: Omit<IdentidadDeSerie, "version">,
  ultimoNumeroDelServicio: bigint,
): Resultado<SerieLibre, ErrorDeNumeracion> {
  if (ultimoNumeroDelServicio < 0n) return err("NUMERO_INVALIDO");
  return ok({ ...identidad, version: 1, estado: "LIBRE", ultimoNumero: ultimoNumeroDelServicio });
}

/** Una serie «usada» ya no permite cambiar el CUIT del emisor ni el número del punto de venta. */
export function serieUsada(serie: Serie): boolean {
  return serie.ultimoNumero > 0n || serie.estado !== "LIBRE";
}

export function hayNumerosUsados(series: readonly Serie[]): boolean {
  return series.some(serieUsada);
}

export type ReservaDeNumero =
  /** Se reservó el número: hay que guardar `serie`. */
  | Readonly<{ tipo: "RESERVADA"; serie: SerieEnCurso; numero: bigint }>
  /** La misma solicitud ya lo había reservado: mismo número, sin escribir. */
  | Readonly<{ tipo: "YA_RESERVADA"; numero: bigint }>;

/**
 * Reserva el próximo número para `solicitud`. Orden: serie bloqueada (`SERIE_BLOQUEADA`); reserva de
 * la misma solicitud (idempotente: el mismo número); reserva de otra (`SERIE_OCUPADA`, se reintenta
 * luego); libre pero sin números (`SERIE_AGOTADA`); si no, `EN_CURSO` con `ultimoNumero + 1` hasta
 * `ahora + plazoDeReservaEnMs`.
 */
export function reservarNumero(
  serie: Serie,
  solicitud: SolicitudId,
  ahora: Date,
  opciones: OpcionesDeNumeracion = OPCIONES_DE_NUMERACION,
): Resultado<ReservaDeNumero, ErrorDeNumeracion> {
  if (!Number.isSafeInteger(opciones.plazoDeReservaEnMs) || opciones.plazoDeReservaEnMs <= 0) {
    throw new RangeError("el plazo de reserva debe ser un entero positivo de milisegundos");
  }
  if (serie.estado === "BLOQUEADA") return err("SERIE_BLOQUEADA");
  if (serie.estado === "EN_CURSO") {
    return serie.solicitud === solicitud
      ? ok({ tipo: "YA_RESERVADA", numero: serie.numeroEnCurso })
      : err("SERIE_OCUPADA");
  }
  if (serie.ultimoNumero >= opciones.numeroMaximo) return err("SERIE_AGOTADA");
  const numero = serie.ultimoNumero + 1n;
  return ok({
    tipo: "RESERVADA",
    numero,
    serie: {
      empresaId: serie.empresaId,
      puntoDeVentaId: serie.puntoDeVentaId,
      emisorId: serie.emisorId,
      tipo: serie.tipo,
      version: serie.version,
      estado: "EN_CURSO",
      ultimoNumero: serie.ultimoNumero,
      numeroEnCurso: numero,
      solicitud,
      enCursoHasta: new Date(ahora.getTime() + opciones.plazoDeReservaEnMs),
    },
  });
}

export type CierreDeSerie = Readonly<{
  /** La serie a guardar. Si el desenlace fue incierto es la misma, todavía `EN_CURSO`. */
  serie: SerieLibre | SerieEnCurso;
  /** El número que quedó autorizado, o `null` si no se autorizó ninguno. */
  numeroAutorizado: bigint | null;
}>;

/**
 * Cierra la reserva de `solicitud` según cómo terminó la autorización:
 * - autorizado: `ultimoNumero` pasa a ser el número reservado y la serie queda `LIBRE`;
 * - rechazado: `LIBRE` sin avanzar (no hay hueco: ese número nunca se usó);
 * - incierto: sigue `EN_CURSO` (se reconcilia después contra el servicio).
 * Si la serie no está `EN_CURSO` por esta solicitud, `SOLICITUD_NO_VIGENTE`.
 */
export function cerrarSerie(
  serie: Serie,
  solicitud: SolicitudId,
  desenlace: DesenlaceDeAutorizacion,
): Resultado<CierreDeSerie, ErrorDeNumeracion> {
  if (serie.estado !== "EN_CURSO" || serie.solicitud !== solicitud) {
    return err("SOLICITUD_NO_VIGENTE");
  }
  if (desenlace === "INCIERTO") return ok({ serie, numeroAutorizado: null });
  const autorizado = desenlace === "AUTORIZADO";
  return ok({
    serie: libreDesde(serie, autorizado ? serie.numeroEnCurso : serie.ultimoNumero),
    numeroAutorizado: autorizado ? serie.numeroEnCurso : null,
  });
}

function libreDesde(serie: SerieEnCurso, ultimoNumero: bigint): SerieLibre {
  return {
    empresaId: serie.empresaId,
    puntoDeVentaId: serie.puntoDeVentaId,
    emisorId: serie.emisorId,
    tipo: serie.tipo,
    version: serie.version,
    estado: "LIBRE",
    ultimoNumero,
  };
}

export type ResolucionDeReconciliacion = "CERRADA_COMO_AUTORIZADA" | "LIBERADA" | "BLOQUEADA";

export type ReconciliacionDeSerie = Readonly<{
  serie: SerieLibre | SerieBloqueada;
  resolucion: ResolucionDeReconciliacion;
}>;

/**
 * Reconcilia una reserva vencida (`ahora >= enCursoHasta`) con lo que informa el servicio de
 * emisión (`ultimoAutorizado`):
 * - igual al número en curso: sí se había autorizado, se cierra como autorizado;
 * - igual al último número guardado: nunca se autorizó, se libera sin avanzar;
 * - otro valor: desfase, la serie queda `BLOQUEADA` con el motivo (diseno-inicial §10).
 * Una serie que no está `EN_CURSO` es `SERIE_NO_EN_CURSO`; una reserva que no venció,
 * `RESERVA_NO_VENCIDA`.
 */
export function reconciliarSerie(
  serie: Serie,
  ultimoAutorizado: bigint,
  ahora: Date,
): Resultado<ReconciliacionDeSerie, ErrorDeNumeracion> {
  if (serie.estado !== "EN_CURSO") return err("SERIE_NO_EN_CURSO");
  if (ahora.getTime() < serie.enCursoHasta.getTime()) return err("RESERVA_NO_VENCIDA");
  if (ultimoAutorizado === serie.numeroEnCurso) {
    return ok({
      serie: libreDesde(serie, serie.numeroEnCurso),
      resolucion: "CERRADA_COMO_AUTORIZADA",
    });
  }
  if (ultimoAutorizado === serie.ultimoNumero) {
    return ok({ serie: libreDesde(serie, serie.ultimoNumero), resolucion: "LIBERADA" });
  }
  return ok({
    resolucion: "BLOQUEADA",
    serie: {
      empresaId: serie.empresaId,
      puntoDeVentaId: serie.puntoDeVentaId,
      emisorId: serie.emisorId,
      tipo: serie.tipo,
      version: serie.version,
      estado: "BLOQUEADA",
      ultimoNumero: serie.ultimoNumero,
      motivoBloqueo: `desfase con el servicio de emisión: informa ${ultimoAutorizado}, se esperaba ${serie.ultimoNumero} o ${serie.numeroEnCurso}`,
    },
  });
}

/**
 * Coherencia interna de una serie (las restricciones `CHECK` de la tabla): el último número no es
 * negativo, la reserva es exactamente el siguiente número y trae solicitud, y el bloqueo trae motivo.
 */
export function serieEsConsistente(serie: Serie): boolean {
  if (serie.ultimoNumero < 0n) return false;
  if (serie.estado === "EN_CURSO") {
    return (
      serie.numeroEnCurso === serie.ultimoNumero + 1n &&
      serie.solicitud.trim() !== "" &&
      !Number.isNaN(serie.enCursoHasta.getTime())
    );
  }
  return serie.estado === "BLOQUEADA" ? serie.motivoBloqueo.trim() !== "" : true;
}

/**
 * ¿Es válido pasar de `antes` a `despues`? Es la regla del disparador de la base, escrita como
 * función (coincide con `TRANSICIONES_DE_SERIE`, más quedarse en el mismo estado sin cambios): la identidad no cambia; `ultimoNumero` nunca baja y solo sube de a uno, cerrando una
 * `EN_CURSO` con su número; `LIBRE` solo pasa a `EN_CURSO` (con el siguiente número); `EN_CURSO` a
 * `LIBRE` (liberada o autorizada) o a `BLOQUEADA` (sin avanzar), o se queda igual; `BLOQUEADA` no
 * sale. Un cambio de `version` no cuenta (lo fija la base).
 */
export function transicionDeSerieValida(antes: Serie, despues: Serie): boolean {
  if (
    antes.empresaId !== despues.empresaId ||
    antes.puntoDeVentaId !== despues.puntoDeVentaId ||
    antes.emisorId !== despues.emisorId ||
    antes.tipo !== despues.tipo
  ) {
    return false;
  }
  if (!serieEsConsistente(despues)) return false;
  switch (antes.estado) {
    case "LIBRE":
      // Se queda libre o pasa a en curso, sin tocar el último número.
      return despues.estado !== "BLOQUEADA" && despues.ultimoNumero === antes.ultimoNumero;
    case "EN_CURSO":
      if (despues.estado === "LIBRE") {
        // Liberada (sin avanzar) o cerrada como autorizada (avanza exactamente al número reservado).
        return (
          despues.ultimoNumero === antes.ultimoNumero ||
          despues.ultimoNumero === antes.numeroEnCurso
        );
      }
      if (despues.estado === "EN_CURSO") {
        return (
          despues.ultimoNumero === antes.ultimoNumero &&
          despues.solicitud === antes.solicitud &&
          despues.enCursoHasta.getTime() === antes.enCursoHasta.getTime()
        );
      }
      return despues.ultimoNumero === antes.ultimoNumero; // bloqueada: no avanza
    case "BLOQUEADA":
      return (
        despues.estado === "BLOQUEADA" &&
        despues.ultimoNumero === antes.ultimoNumero &&
        despues.motivoBloqueo === antes.motivoBloqueo
      );
  }
}

export type ErrorDeSecuencia = "NUMERO_DUPLICADO" | "NUMERO_SALTEADO";

/**
 * Verifica que los números autorizados (en cualquier orden) sean exactamente
 * `ultimoInicial + 1 … ultimoInicial + n`: sin repetidos y sin huecos. Devuelve el último número.
 * Sirve de auditoría de una serie y de oráculo de las pruebas de concurrencia.
 */
export function verificarSecuencia(
  ultimoInicial: bigint,
  autorizados: readonly bigint[],
): Resultado<bigint, ErrorDeSecuencia> {
  const ordenados = [...autorizados].sort((a, b) => Number(a - b));
  let ultimo = ultimoInicial;
  for (const numero of ordenados) {
    if (numero <= ultimo) return err("NUMERO_DUPLICADO");
    if (numero > ultimo + 1n) return err("NUMERO_SALTEADO");
    ultimo = numero;
  }
  return ok(ultimo);
}
