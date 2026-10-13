import { importesIguales } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import {
  CODIGO_DE_MONEDA,
  CODIGO_DE_TIPO_DE_COMPROBANTE,
  CODIGO_DE_TIPO_DE_DOCUMENTO,
} from "./codigos-de-arca";
import { letraDeComprobante } from "./comprobante-emitido";
import type { ComprobanteNuevo } from "./comprobante-nuevo";
import type { DatosConsultados, ResultadoDeConsulta } from "./estados-de-comprobante";
import type { SolicitudId } from "./identificadores";
import { importesParaArca, type AlicuotaParaArca } from "./importes-para-arca";
import type {
  ErrorDeNumeracion,
  Serie,
  SerieBloqueada,
  SerieEnCurso,
  SerieLibre,
} from "./numeracion";
import { numeroDeDocumentoParaArca } from "./receptor";

/**
 * Reconciliación de un comprobante que quedó en vuelo (spec H7 facturación §B.3.7): decide con LO
 * QUE ARCA TIENE REGISTRADO de ese número (`FECompConsultar`) y no solo con «el último autorizado»,
 * porque este no dice de quién es el comprobante ni cuál es su CAE. Un `INCIERTO` nunca se
 * reenvía: se consulta.
 *
 * | Consulta del número reservado | Último autorizado | Serie                       | Comprobante  |
 * | ENCONTRADO y coincide         | —                 | LIBRE, ultimo_numero=numero | AUTORIZADO   |
 * | ENCONTRADO y no coincide      | —                 | BLOQUEADA (lo usó otro)     | CONFLICTO    |
 * | NO_ENCONTRADO                 | = ultimo_numero   | LIBRE sin avanzar           | PENDIENTE    |
 * | NO_ENCONTRADO                 | ≠ ultimo_numero   | BLOQUEADA (desfase)         | PENDIENTE    |
 * | CONSULTA_FALLIDA              | —                 | sin cambios                 | sin cambios  |
 *
 * Solo con la reserva VENCIDA (`ahora ≥ enCursoHasta`), para no cruzarse con un intento todavía vivo.
 */
export type ComprobanteEnVuelo = Readonly<{
  /** La solicitud que reservó el número: tiene que ser la de la serie. */
  solicitud: SolicitudId;
  numero: bigint;
  /** La fecha que se le informó a ARCA al reservar. */
  fecha: FechaCivil;
  contenido: ComprobanteNuevo;
}>;

export type Reconciliacion =
  | Readonly<{
      resolucion: "AUTORIZADO_POR_CONSULTA";
      serie: SerieLibre;
      numero: bigint;
      codigo: string;
      vence: FechaCivil;
    }>
  | Readonly<{ resolucion: "LIBERADO_POR_CONSULTA"; serie: SerieLibre }>
  | Readonly<{ resolucion: "CONFLICTO"; serie: SerieBloqueada }>
  | Readonly<{ resolucion: "DESFASE"; serie: SerieBloqueada }>
  | Readonly<{ resolucion: "SIN_CAMBIOS" }>;

/** Cada alícuota como texto comparable (código, base e IVA con su moneda), sin ambigüedad entre campos. */
function claveDeAlicuota(a: AlicuotaParaArca): string {
  return JSON.stringify([
    a.alicuota,
    a.base.moneda,
    String(a.base.unidades),
    a.iva.moneda,
    String(a.iva.unidades),
  ]);
}

/** Las mismas alícuotas con los mismos importes, sin importar el orden ni los repetidos de más. */
function alicuotasIguales(a: readonly AlicuotaParaArca[], b: readonly AlicuotaParaArca[]): boolean {
  return a.map(claveDeAlicuota).sort().join(";") === b.map(claveDeAlicuota).sort().join(";");
}

function asociadoIgual(
  nuestro: ComprobanteNuevo["asociado"],
  suyo: DatosConsultados["asociado"],
): boolean {
  if (nuestro === null || suyo === null) return nuestro === suyo;
  return (
    CODIGO_DE_TIPO_DE_COMPROBANTE[nuestro.tipo] === suyo.tipoDeComprobante &&
    nuestro.puntoDeVenta === suyo.puntoDeVenta &&
    nuestro.numero === suyo.numero &&
    nuestro.cuit === suyo.cuit &&
    nuestro.fecha === suyo.fecha
  );
}

/**
 * ¿Es el comprobante registrado en ARCA el nuestro? Compara tipo, punto de venta, número, fecha,
 * documento del receptor, `ImpTotal` y moneda; si la letra discrimina IVA (A y B), también
 * `ImpNeto`, `ImpIVA` y cada alícuota; en las notas, el asociado. Los importes se comparan como
 * enteros de centavos y las fechas como fechas civiles: ya vienen normalizadas.
 */
export function coincideConLoRegistrado(
  enVuelo: ComprobanteEnVuelo,
  registrado: DatosConsultados,
): boolean {
  const { contenido } = enVuelo;
  const esperado = importesParaArca(contenido);
  const basicos =
    registrado.tipoDeComprobante === CODIGO_DE_TIPO_DE_COMPROBANTE[contenido.tipo] &&
    registrado.puntoDeVenta === contenido.emisor.puntoDeVentaNumero &&
    registrado.numero === enVuelo.numero &&
    registrado.fecha === enVuelo.fecha &&
    registrado.tipoDeDocumento === CODIGO_DE_TIPO_DE_DOCUMENTO[contenido.receptor.documento.tipo] &&
    registrado.numeroDeDocumento === numeroDeDocumentoParaArca(contenido.receptor.documento) &&
    registrado.moneda === CODIGO_DE_MONEDA[esperado.total.moneda] &&
    importesIguales(registrado.total, esperado.total) &&
    asociadoIgual(contenido.asociado, registrado.asociado);
  if (!basicos) return false;
  if (letraDeComprobante(contenido.tipo) === "C") return true;
  return (
    importesIguales(registrado.neto, esperado.neto) &&
    importesIguales(registrado.iva, esperado.iva) &&
    alicuotasIguales(registrado.alicuotas, esperado.alicuotas)
  );
}

/**
 * Las dos series que produce la reconciliación. Repiten lo que `numeracion.ts` hace en privado
 * (`libreDesde` y el bloqueo de `reconciliarSerie`); pendiente de exportarlo desde ahí al integrar.
 */
function libre(serie: SerieEnCurso, ultimoNumero: bigint): SerieLibre {
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

function bloqueada(serie: SerieEnCurso, motivoBloqueo: string): SerieBloqueada {
  return {
    empresaId: serie.empresaId,
    puntoDeVentaId: serie.puntoDeVentaId,
    emisorId: serie.emisorId,
    tipo: serie.tipo,
    version: serie.version,
    estado: "BLOQUEADA",
    ultimoNumero: serie.ultimoNumero,
    motivoBloqueo,
  };
}

/**
 * Reconcilia `enVuelo` (un comprobante `EN_VALIDACION` o `INCIERTO`) contra la consulta de su número
 * y el último autorizado que informa ARCA. Errores: `SERIE_NO_EN_CURSO`; `SOLICITUD_NO_VIGENTE`
 * (la serie no la reservó este comprobante); `NUMERO_INVALIDO` (el número no es el de la reserva);
 * `RESERVA_NO_VENCIDA`.
 */
export function reconciliarComprobante(
  serie: Serie,
  enVuelo: ComprobanteEnVuelo,
  consulta: ResultadoDeConsulta,
  ultimoAutorizado: bigint,
  ahora: Date,
): Resultado<Reconciliacion, ErrorDeNumeracion> {
  if (serie.estado !== "EN_CURSO") return err("SERIE_NO_EN_CURSO");
  if (
    serie.solicitud !== enVuelo.solicitud ||
    serie.empresaId !== enVuelo.contenido.empresaId ||
    serie.puntoDeVentaId !== enVuelo.contenido.puntoDeVentaId ||
    serie.emisorId !== enVuelo.contenido.emisorId ||
    serie.tipo !== enVuelo.contenido.tipo
  ) {
    return err("SOLICITUD_NO_VIGENTE");
  }
  if (serie.numeroEnCurso !== enVuelo.numero) return err("NUMERO_INVALIDO");
  if (ahora.getTime() < serie.enCursoHasta.getTime()) return err("RESERVA_NO_VENCIDA");

  if (consulta.tipo === "CONSULTA_FALLIDA") return ok({ resolucion: "SIN_CAMBIOS" });

  if (consulta.tipo === "ENCONTRADO") {
    if (!coincideConLoRegistrado(enVuelo, consulta.datos)) {
      return ok({
        resolucion: "CONFLICTO",
        serie: bloqueada(serie, `el número ${serie.numeroEnCurso} lo usó otro comprobante en ARCA`),
      });
    }
    return ok({
      resolucion: "AUTORIZADO_POR_CONSULTA",
      serie: libre(serie, serie.numeroEnCurso),
      numero: serie.numeroEnCurso,
      codigo: consulta.codigo,
      vence: consulta.vence,
    });
  }

  if (ultimoAutorizado !== serie.ultimoNumero) {
    return ok({
      resolucion: "DESFASE",
      serie: bloqueada(
        serie,
        `desfase con ARCA: informa ${ultimoAutorizado} como último autorizado y el número ${serie.numeroEnCurso} no existe; se esperaba ${serie.ultimoNumero}`,
      ),
    });
  }
  return ok({ resolucion: "LIBERADO_POR_CONSULTA", serie: libre(serie, serie.ultimoNumero) });
}
