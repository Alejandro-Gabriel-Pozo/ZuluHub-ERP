import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { TipoDeComprobante } from "./comprobante-emitido";
import type { Ambiente } from "./comprobante-nuevo";
import type { EmisorId, PuntoDeVentaId, SolicitudId } from "./identificadores";

/**
 * Modelo de una serie de comprobantes (spec H7 §B.8): solo tipos, sin lógica. Aparte de `numeracion.ts` para
 * que las operaciones (`numeracion.ts`) y las reglas de validez (`numeracion-invariantes.ts`) dependan del
 * modelo y no una de la otra (la regla de arquitectura no admite ciclos). `numeracion.ts` los re-exporta.
 */
export type EstadoDeSerie = "LIBRE" | "EN_CURSO" | "BLOQUEADA";

export type IdentidadDeSerie = Readonly<{
  empresaId: EmpresaId;
  puntoDeVentaId: PuntoDeVentaId;
  /** Atado al punto de venta por clave compuesta: una serie no mezcla emisor y punto de venta. */
  emisorId: EmisorId;
  tipo: TipoDeComprobante;
  /**
   * Parte de la clave (0009): homologación y producción son otro ARCA y numeran por separado. Sin esto,
   * los números de prueba avanzarían la serie real y ARCA rechazaría el siguiente número verdadero por
   * fuera de secuencia (error 10016).
   */
  ambiente: Ambiente;
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
