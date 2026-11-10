import type { Importe } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ClaseDeMovimiento, EstadoDeSesion } from "../estados";
import type { ReferenciaOpaca } from "./identidad-del-cobro";
import { negarImporte } from "./importes";
import { CLASES_ANULABLES } from "./movimiento";
import { motivoObligatorio } from "./texto";

/**
 * Anular un movimiento de caja (e3 §3.2). Se anula con un registro nuevo (el espejo exacto: mismo medio, misma cuenta, importe opuesto,
 * motivo obligatorio), nunca se borra. Solo un movimiento de una sesión `ABIERTA`; nunca el fondo, una anulación ni un cobro (todo
 * cobro de E3 tiene origen). El operador anula SOLO lo que cargó él; gerente y administrador, cualquiera. Puro: sin reloj ni azar.
 */
type BaseDeMovimiento = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  importe: Importe;
  registradoPor: string;
}>;

/** Un cobro siempre trae su origen; ninguna otra clase lo tiene. */
export type MovimientoAnulable =
  | (BaseDeMovimiento & Readonly<{ clase: "COBRO"; origen: ReferenciaOpaca }>)
  | (BaseDeMovimiento & Readonly<{ clase: Exclude<ClaseDeMovimiento, "COBRO"> }>);

export type EntradaDeAnulacion = Readonly<{
  movimiento: MovimientoAnulable;
  /** Ya existe una anulación de este movimiento. */
  yaAnulado: boolean;
  sesion: EstadoDeSesion;
  actor: Readonly<{
    /** La persona del contexto firmado, nunca un dato de la pantalla. */
    personaId: string;
    /** `movimientos_caja.anular_de_otros` (gerente y administrador). */
    puedeAnularDeOtros: boolean;
  }>;
}>;

export type ErrorDeAnulacion =
  | "MOVIMIENTO_NO_ANULABLE"
  | "MOVIMIENTO_YA_ANULADO"
  | "SESION_EN_CIERRE"
  | "SESION_CERRADA"
  | "MOVIMIENTO_DE_OTRA_PERSONA"
  | "MOTIVO_INVALIDO"
  | Readonly<{ codigo: "MOVIMIENTO_CON_ORIGEN"; origenTipo: string; origenId: string }>;

type Impedimento = Exclude<ErrorDeAnulacion, "MOTIVO_INVALIDO">;

/** Lo primero que impide anular, en este orden: lo estructural, lo ya hecho, el estado de la sesión y de quién es. */
function impedimentoDeAnulacion(entrada: EntradaDeAnulacion): Impedimento | null {
  const { movimiento, actor } = entrada;
  if (movimiento.clase === "COBRO") {
    return {
      codigo: "MOVIMIENTO_CON_ORIGEN",
      origenTipo: movimiento.origen.tipo,
      origenId: movimiento.origen.id,
    };
  }
  if (!CLASES_ANULABLES.includes(movimiento.clase)) return "MOVIMIENTO_NO_ANULABLE";
  if (entrada.yaAnulado) return "MOVIMIENTO_YA_ANULADO";
  if (entrada.sesion === "EN_CIERRE") return "SESION_EN_CIERRE";
  if (entrada.sesion === "CERRADA") return "SESION_CERRADA";
  if (!actor.puedeAnularDeOtros && movimiento.registradoPor !== actor.personaId) {
    return "MOVIMIENTO_DE_OTRA_PERSONA";
  }
  return null;
}

export type MotivoNoAnulable =
  "CON_ORIGEN" | "DE_OTRA_PERSONA" | "SESION_NO_ABIERTA" | "NO_ANULABLE";

const MOTIVO_POR_IMPEDIMENTO: Readonly<Record<Exclude<Impedimento, object>, MotivoNoAnulable>> = {
  MOVIMIENTO_NO_ANULABLE: "NO_ANULABLE",
  MOVIMIENTO_YA_ANULADO: "NO_ANULABLE",
  SESION_EN_CIERRE: "SESION_NO_ABIERTA",
  SESION_CERRADA: "SESION_NO_ABIERTA",
  MOVIMIENTO_DE_OTRA_PERSONA: "DE_OTRA_PERSONA",
};

/**
 * Por qué NO se puede anular (`null` = se puede): lo que devuelve la consulta de movimientos como `motivoNoAnulable`, calculado en el
 * servidor con LA MISMA regla que la anulación. La pantalla no decide. Previene un botón «Anular» habilitado en un cobro (defecto
 * medido en el prototipo) o una regla distinta entre lo que se muestra y lo que se hace.
 */
export function motivoNoAnulable(entrada: EntradaDeAnulacion): MotivoNoAnulable | null {
  const impedimento = impedimentoDeAnulacion(entrada);
  if (impedimento === null) return null;
  return typeof impedimento === "object" ? "CON_ORIGEN" : MOTIVO_POR_IMPEDIMENTO[impedimento];
}

/** El movimiento nuevo que anula al original: mismo medio y cuenta, importe opuesto, con el motivo. */
export type EspejoDeAnulacion = Readonly<{
  clase: "ANULACION";
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  importe: Importe;
  motivo: string;
}>;

export function decidirAnulacion(
  entrada: EntradaDeAnulacion & Readonly<{ motivo: string | null | undefined }>,
): Resultado<EspejoDeAnulacion, ErrorDeAnulacion> {
  const { movimiento } = entrada;
  const impedimento = impedimentoDeAnulacion(entrada);
  if (impedimento !== null) return err(impedimento);
  const motivo = motivoObligatorio(entrada.motivo);
  if (!motivo.ok) return motivo;
  return ok({
    clase: "ANULACION",
    medioDePagoId: movimiento.medioDePagoId,
    cuentaDeCobroId: movimiento.cuentaDeCobroId,
    importe: negarImporte(movimiento.importe),
    motivo: motivo.valor,
  });
}
