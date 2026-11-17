import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Dato } from "../../../puertos/sin-secretos";
import type { TipoDeComprobante } from "../dominio/comprobante-emitido";
import type { Ambiente } from "../dominio/comprobante-nuevo";
import type {
  DesenlaceDeAutorizacion,
  Mensaje,
  ResultadoDeAutorizacionArca,
} from "../dominio/estados-de-comprobante";
import type { PuntoDeVentaId, SolicitudId } from "../dominio/identificadores";
import {
  cerrarSerie,
  cerrarSerieFueraDeSecuencia,
  type ErrorDeNumeracion,
  type ResolucionFueraDeSecuencia,
} from "../dominio/numeracion";
import { datosDeSerie, empresaOpera, entidadDeSerie } from "./comun";
import type { TxDeNumeracion } from "./contrato";

/**
 * Cerrar la reserva de un número (con el resultado de la autorización, o tras un rechazo fuera de secuencia
 * 10016): segunda parte del cuerpo transaccional de la numeración, SIN guard. Juntas porque comparten qué se
 * audita del resultado (`datosDelResultado`, `ACCION_DE_CIERRE`): una sola regla en un solo lugar.
 *
 * Reglas de quien llama: ya abrió la transacción (SERIALIZABLE) y ya autorizó la acción.
 */

export type EntradaDeCerrarReserva = Readonly<{
  puntoDeVentaId: PuntoDeVentaId;
  tipo: TipoDeComprobante;
  /**
   * El ambiente de la serie, el del comprobante: se dice siempre, no se deduce del punto de venta, para
   * que repetir un cierre después de un cambio de ambiente siga mirando la serie que se cerró.
   */
  ambiente: Ambiente;
  solicitud: SolicitudId;
  /** El número que devolvió la reserva. */
  numero: bigint;
  /** Cómo terminó la autorización en el servicio de emisión. */
  resultado: ResultadoDeAutorizacionArca;
}>;

export type SalidaDeCerrarReserva = Readonly<{
  desenlace: DesenlaceDeAutorizacion;
  numero: bigint;
  /** `true`: la reserva ya no estaba y nada había que cerrar (una repetición); no se escribió nada. */
  yaCerrada: boolean;
}>;

export type ErrorPropioAlCerrar = "SERIE_NO_ENCONTRADA" | ErrorDeNumeracion;

/** Solo los códigos de ARCA: los textos pueden llevar datos de la persona y la auditoría no los guarda. */
const codigosDe = (mensajes: readonly Mensaje[]): number[] => mensajes.map((m) => m.codigo);

/** Lo que se audita del resultado de la autorización (el código de autorización no es un secreto). */
function datosDelResultado(resultado: ResultadoDeAutorizacionArca): Record<string, Dato> {
  switch (resultado.tipo) {
    case "AUTORIZADO":
      return {
        codigoDeAutorizacion: resultado.codigo,
        vence: resultado.vence,
        fecha: resultado.fecha,
        observaciones: codigosDe(resultado.observaciones),
      };
    case "RECHAZADO":
      return {
        errores: codigosDe(resultado.errores),
        observaciones: codigosDe(resultado.observaciones),
      };
    case "INCIERTO":
    case "NO_ENVIADO":
      return {};
  }
}

/** La auditoría de la serie según el desenlace; el incierto no escribe nada y no figura. */
const ACCION_DE_CIERRE = {
  AUTORIZADO: "NUMERO_DE_COMPROBANTE_AUTORIZADO",
  RECHAZADO: "NUMERO_DE_COMPROBANTE_RECHAZADO",
  NO_ENVIADO: "NUMERO_DE_COMPROBANTE_LIBERADO",
} as const;

/**
 * Cerrar la reserva con el resultado de la autorización. Dentro de la transacción de quien llama: la
 * empresa opera y el dominio decide (`cerrarSerie`):
 *
 *  - autorizado → `ultimoNumero` pasa a ser el número y la serie queda `LIBRE`;
 *  - rechazado → `LIBRE` sin avanzar (no hay hueco: ese número nunca se usó);
 *  - no enviado → ídem: el pedido seguro no salió, el número se libera y se reintenta;
 *  - incierto → sigue `EN_CURSO` y NO se escribe nada (la reconciliación la resuelve).
 *
 * La auditoría va en la misma transacción que el cambio de la serie.
 *
 * Idempotente: cerrar dos veces lo mismo da el mismo éxito, sin avanzar dos veces. Si la serie ya no
 * tiene esta reserva (`yaCerrada`):
 *  - autorizado: es un éxito solo si el último número ya alcanzó a este (alguien lo cerró);
 *  - rechazado, no enviado o incierto: no hay nada que liberar, salvo que el último número ya haya
 *    pasado por este (el servicio dijo que no y la serie dice que sí: `SOLICITUD_NO_VIGENTE`).
 * Un `numero` que no es el de la reserva es `NUMERO_INVALIDO` (un defecto de quien llama).
 */
export async function cerrarEnTx(
  tx: TxDeNumeracion,
  contexto: ContextoOperativo,
  entrada: EntradaDeCerrarReserva,
): Promise<Resultado<SalidaDeCerrarReserva, ErrorPropioAlCerrar | EmpresaNoOpera>> {
  const { empresaId } = contexto;
  const desenlace = entrada.resultado.tipo;
  const opera = await empresaOpera(tx, empresaId);
  if (!opera.ok) return opera;

  const serie = await tx.series.obtener(
    empresaId,
    entrada.puntoDeVentaId,
    entrada.tipo,
    entrada.ambiente,
  );
  if (serie === null) return err("SERIE_NO_ENCONTRADA");

  const laTiene = serie.estado === "EN_CURSO" && serie.solicitud === entrada.solicitud;
  if (!laTiene) {
    // Una repetición: la reserva ya se cerró (o se reconcilió).
    const alcanzado = serie.ultimoNumero >= entrada.numero;
    if (desenlace === "AUTORIZADO" ? !alcanzado : alcanzado) {
      return err("SOLICITUD_NO_VIGENTE");
    }
    return ok({ desenlace, numero: entrada.numero, yaCerrada: true });
  }
  if (serie.numeroEnCurso !== entrada.numero) return err("NUMERO_INVALIDO");

  const cierre = cerrarSerie(serie, entrada.solicitud, desenlace);
  if (!cierre.ok) return cierre;
  if (desenlace === "INCIERTO") {
    return ok({ desenlace, numero: entrada.numero, yaCerrada: false });
  }
  const guardada = await tx.series.guardar(cierre.valor.serie);
  if (guardada === null) throw new Error("la serie cambió dentro de la transacción");
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: contexto.personaId,
    accion: ACCION_DE_CIERRE[desenlace],
    entidad: "serie_comprobante",
    entidadId: entidadDeSerie(entrada.puntoDeVentaId, entrada.tipo, entrada.ambiente),
    antes: datosDeSerie(serie),
    despues: {
      ...datosDeSerie(guardada),
      numero: entrada.numero.toString(),
      solicitud: entrada.solicitud,
      ...datosDelResultado(entrada.resultado),
    },
  });
  return ok({ desenlace, numero: entrada.numero, yaCerrada: false });
}

// ---------------------------------------------------------------------------------------------
// Cerrar un rechazo fuera de secuencia (10016)
// ---------------------------------------------------------------------------------------------

export type EntradaDeCerrarFueraDeSecuencia = Readonly<{
  puntoDeVentaId: PuntoDeVentaId;
  tipo: TipoDeComprobante;
  ambiente: Ambiente;
  solicitud: SolicitudId;
  /** El número que ARCA rechazó por fuera de secuencia: el de la reserva. */
  numero: bigint;
  /** El rechazo tal como lo dio ARCA (con el 10016): se audita por sus códigos. */
  resultado: ResultadoDeAutorizacionArca;
  /** El último autorizado que informó ARCA (consultado FUERA de la transacción); `null` si no respondió. */
  ultimoDeArca: bigint | null;
}>;

export type SalidaDeCerrarFueraDeSecuencia = Readonly<{ resolucion: ResolucionFueraDeSecuencia }>;

/**
 * Cerrar la reserva de un número que ARCA rechazó por fuera de secuencia (spec H7 facturación §B.5.4, tabla
 * de la respuesta 10016). Dentro de la transacción de quien llama, que ya movió (o va a mover) el comprobante a
 * `RECHAZADO` en ESTA misma transacción: la empresa opera y el dominio decide (`cerrarSerieFueraDeSecuencia`):
 *
 *  - ARCA en el último número de la serie → `LIBRE` sin avanzar, auditoría `NUMERO_DE_COMPROBANTE_RECHAZADO`
 *    (igual que cualquier rechazo);
 *  - ARCA en otro número, o sin respuesta → `BLOQUEADA` sin avanzar con el motivo de desfase, auditoría
 *    `SERIE_BLOQUEADA` con lo que informó ARCA (como la reconciliación). La destraba el gerente.
 *
 * La serie tiene que seguir `EN_CURSO` con esta solicitud y este número: lo garantiza el comprobante
 * `EN_VALIDACION` que la usa (la base no deja soltar esa reserva sin resolverlo), así que otra cosa es un
 * defecto de quien llama (`SOLICITUD_NO_VIGENTE`, `NUMERO_INVALIDO`) y no se escribe nada. Repetirla no existe:
 * quien llama solo la invoca desde `EN_VALIDACION`, y después el comprobante ya no lo está.
 */
export async function cerrarFueraDeSecuenciaEnTx(
  tx: TxDeNumeracion,
  contexto: ContextoOperativo,
  entrada: EntradaDeCerrarFueraDeSecuencia,
): Promise<Resultado<SalidaDeCerrarFueraDeSecuencia, ErrorPropioAlCerrar | EmpresaNoOpera>> {
  const { empresaId } = contexto;
  const opera = await empresaOpera(tx, empresaId);
  if (!opera.ok) return opera;

  const serie = await tx.series.obtener(
    empresaId,
    entrada.puntoDeVentaId,
    entrada.tipo,
    entrada.ambiente,
  );
  if (serie === null) return err("SERIE_NO_ENCONTRADA");
  const cierre = cerrarSerieFueraDeSecuencia(serie, entrada.solicitud, entrada.ultimoDeArca);
  if (!cierre.ok) return cierre;
  // El dominio ya comprobó que la serie es `EN_CURSO` por esta solicitud: falta que sea por este número.
  if (serie.estado === "EN_CURSO" && serie.numeroEnCurso !== entrada.numero) {
    return err("NUMERO_INVALIDO");
  }
  const guardada = await tx.series.guardar(cierre.valor.serie);
  if (guardada === null) throw new Error("la serie cambió dentro de la transacción");
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: contexto.personaId,
    accion:
      cierre.valor.resolucion === "BLOQUEADA" ? "SERIE_BLOQUEADA" : ACCION_DE_CIERRE.RECHAZADO,
    entidad: "serie_comprobante",
    entidadId: entidadDeSerie(entrada.puntoDeVentaId, entrada.tipo, entrada.ambiente),
    antes: datosDeSerie(serie),
    despues: {
      ...datosDeSerie(guardada),
      numero: entrada.numero.toString(),
      solicitud: entrada.solicitud,
      ...datosDelResultado(entrada.resultado),
      resolucion: cierre.valor.resolucion,
      ultimoAutorizadoPorElServicio: entrada.ultimoDeArca?.toString() ?? null,
    },
  });
  return ok({ resolucion: cierre.valor.resolucion });
}
