import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { Dato } from "../../../puertos/sin-secretos";
import { intentoId, solicitudId, type ComprobanteId } from "../dominio/identificadores";
import type { Mensaje, ResultadoDeAutorizacionArca } from "../dominio/estados-de-comprobante";
import { importesParaArca } from "../dominio/importes-para-arca";
import type {
  CambioDeComprobante,
  ComprobanteGuardado,
} from "../persistencia/repositorio-de-comprobantes";
import type { MensajeDeIntento } from "../persistencia/repositorio-de-intentos";
import type { ContextoDeSistema } from "./contrato";
import type {
  ErrorDeEmision,
  PuntoDeVentaParaEmision,
  SolicitudDeAutorizacion,
} from "./emision-electronica";
import { idDeIntento } from "./llamadas-a-arca";

/**
 * Piezas puras del trabajo `fiscal.validar_comprobante` (sin transacción ni efectos): armar el pedido a ARCA,
 * los mensajes del intento, el cambio y la auditoría del comprobante según el desenlace y el intento de la
 * consulta del último autorizado. Viven aparte de `validar-comprobante.ts` para que el flujo transaccional
 * quede legible; no cambian ni el orden ni lo que se audita.
 */

/** Lo que `FECAESolicitar` necesita de un comprobante ya `EN_VALIDACION` (con su número y su fecha). */
export function solicitudDe(
  c: ComprobanteGuardado,
  puntoDeVenta: PuntoDeVentaParaEmision,
): SolicitudDeAutorizacion {
  if (c.numeroReservado === null || c.fechaEmision === null) {
    throw new RangeError("solo un comprobante con número reservado se pide a ARCA");
  }
  return {
    puntoDeVenta,
    tipo: c.tipo,
    numero: c.numeroReservado,
    solicitud: solicitudId(c.id),
    fecha: c.fechaEmision,
    concepto: c.concepto,
    servicio: c.servicio,
    receptor: { documento: c.receptor.documento, condicionIva: c.receptor.condicionIva },
    importes: importesParaArca({ tipo: c.tipo, total: c.importes.total, desglose: c.desglose }),
    asociado:
      c.asociado === null
        ? null
        : {
            tipo: c.asociado.tipo,
            puntoDeVenta: c.asociado.puntoDeVenta,
            numero: c.asociado.numero,
            cuit: c.asociado.cuit,
            fecha: c.asociado.fecha,
          },
  };
}

/** Los mensajes de ARCA tal como se guardan en el intento (crudos: código y texto). */
export function mensajesDeAutorizacion(r: ResultadoDeAutorizacionArca): MensajeDeIntento[] {
  const como = (clase: MensajeDeIntento["clase"]) => (m: Mensaje) => ({ clase, ...m });
  switch (r.tipo) {
    case "AUTORIZADO":
      return r.observaciones.map(como("OBSERVACION"));
    case "RECHAZADO":
      return [...r.errores.map(como("ERROR")), ...r.observaciones.map(como("OBSERVACION"))];
    case "INCIERTO":
    case "NO_ENVIADO":
      return [];
  }
}

const codigos = (mensajes: readonly Mensaje[]): number[] => mensajes.map((m) => m.codigo);

/** El cambio del comprobante y su auditoría según el desenlace (§B.2.2); sin textos de ARCA ni del receptor. */
export function cierreDelComprobante(
  r: ResultadoDeAutorizacionArca,
  ahora: Date,
): Readonly<{ cambio: CambioDeComprobante; accion: string; datos: Record<string, Dato> }> {
  switch (r.tipo) {
    case "AUTORIZADO":
      return {
        cambio: {
          a: "AUTORIZADO",
          cae: r.codigo,
          caeVence: r.vence,
          autorizadoEn: ahora,
          resueltoPor: "RESPUESTA",
        },
        accion: "COMPROBANTE_AUTORIZADO",
        datos: { cae: r.codigo, caeVence: r.vence, observaciones: codigos(r.observaciones) },
      };
    case "RECHAZADO":
      return {
        cambio: { a: "RECHAZADO" },
        accion: "COMPROBANTE_RECHAZADO",
        datos: { errores: codigos(r.errores), observaciones: codigos(r.observaciones) },
      };
    case "INCIERTO":
      return { cambio: { a: "INCIERTO" }, accion: "COMPROBANTE_INCIERTO", datos: {} };
    case "NO_ENVIADO":
      return { cambio: { a: "PENDIENTE" }, accion: "COMPROBANTE_NO_ENVIADO", datos: {} };
  }
}

/** Lo que respondió ARCA al último autorizado tras un 10016, y cuándo empezó y terminó la llamada. */
export type ConsultaDelUltimo = Readonly<{
  ultimo: Resultado<bigint, ErrorDeEmision>;
  iniciadoEn: Date;
  terminadoEn: Date;
}>;

/**
 * El intento que deja la consulta del último autorizado (`ULTIMO_AUTORIZADO`): `RESPONDIDO` con el número que
 * informó ARCA en `numero`, o `CONSULTA_FALLIDA` sin él. Su id sale de lo que lo identifica, así que repetir la
 * transacción no lo duplica.
 */
export function intentoDelUltimo(
  empresaId: ContextoDeSistema["empresaId"],
  comprobante: ComprobanteId,
  reservado: bigint,
  { ultimo, iniciadoEn, terminadoEn }: ConsultaDelUltimo,
) {
  return {
    id: intentoId(idDeIntento(comprobante, "ULTIMO_AUTORIZADO", reservado, iniciadoEn)),
    empresaId,
    comprobanteId: comprobante,
    operacion: "ULTIMO_AUTORIZADO" as const,
    numero: ultimo.ok ? ultimo.valor : null,
    desenlace: ultimo.ok ? ("RESPONDIDO" as const) : ("CONSULTA_FALLIDA" as const),
    mensajes: [],
    respuesta: null,
    huellaDelPedido: null,
    iniciadoEn,
    duracionEnMs: Math.max(0, terminadoEn.getTime() - iniciadoEn.getTime()),
  };
}
