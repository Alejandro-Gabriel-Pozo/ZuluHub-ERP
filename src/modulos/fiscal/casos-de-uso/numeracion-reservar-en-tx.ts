import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { TipoDeComprobante } from "../dominio/comprobante-emitido";
import type { Ambiente } from "../dominio/comprobante-nuevo";
import type { PuntoDeVentaId, SolicitudId } from "../dominio/identificadores";
import {
  OPCIONES_DE_NUMERACION,
  iniciarSerie,
  reservarNumero,
  type ErrorDeNumeracion,
  type OpcionesDeNumeracion,
} from "../dominio/numeracion";
import { datosDeSerie, empresaOpera, entidadDeSerie, puntoDeVentaParaEmision } from "./comun";
import type { TxDeNumeracion } from "./contrato";
import type { PuntoDeVentaParaEmision } from "./emision-electronica";

/**
 * Reservar el próximo número de una serie: primera parte del cuerpo transaccional de la numeración (spec H7
 * facturación §B.2.3, punto 1), SIN guard. Las otras partes viven en `numeracion-cerrar-en-tx.ts` y
 * `numeracion-resincronizar-en-tx.ts`; `numeracion-en-tx.ts` las junta en una sola puerta. Previene: dos copias
 * de la lógica de reserva que se desvíen (un número duplicado o con hueco).
 *
 * Reglas de quien llama: ya abrió la transacción (SERIALIZABLE) y ya autorizó la acción.
 */

export type EntradaDeReservarNumero = Readonly<{
  puntoDeVentaId: PuntoDeVentaId;
  tipo: TipoDeComprobante;
  /**
   * El ambiente de la serie: el del comprobante. Tiene que ser el que el punto de venta tiene hoy; si
   * cambió, `AMBIENTE_DISTINTO_DEL_PUNTO_DE_VENTA` y no se toca ninguna serie (un comprobante de
   * homologación nunca avanza la serie de producción).
   */
  ambiente: Ambiente;
  /** La identidad del pedido (la proforma): repetir con la misma devuelve el mismo número. */
  solicitud: SolicitudId;
}>;

export type SalidaDeReservarNumero = Readonly<{
  /** El número reservado para la solicitud. */
  numero: bigint;
  /** Lo que el servicio de emisión necesita para autorizarlo. */
  puntoDeVenta: PuntoDeVentaParaEmision;
  /** `true`: la misma solicitud ya lo había reservado; no se escribió nada. */
  yaReservada: boolean;
}>;

export type ErrorPropioAlReservar =
  | "PUNTO_DE_VENTA_NO_ENCONTRADO"
  | "PUNTO_DE_VENTA_INACTIVO"
  | "EMISOR_INACTIVO"
  | "AMBIENTE_DISTINTO_DEL_PUNTO_DE_VENTA"
  | ErrorDeNumeracion;

export type PasoDeReserva =
  | Readonly<{ tipo: "RESERVADO"; salida: SalidaDeReservarNumero }>
  /** La serie no existe todavía: hay que preguntarle al servicio cuál es su último número. */
  | Readonly<{ tipo: "FALTA_LA_SERIE"; puntoDeVenta: PuntoDeVentaParaEmision }>;

/**
 * Reservar el próximo número de una serie para una solicitud. Dentro de la transacción de quien
 * llama: la empresa opera, el punto de venta existe y es del ambiente pedido, y entonces el dominio
 * decide (`reservarNumero`):
 *
 *  - serie `LIBRE` → `EN_CURSO` con `ultimoNumero + 1`, auditoría `NUMERO_DE_COMPROBANTE_RESERVADO`
 *    en la misma transacción; solo si el punto de venta y su emisor están activos;
 *  - la misma solicitud ya tenía la reserva → el mismo número, sin escribir (`yaReservada`);
 *  - otra solicitud la tiene → `SERIE_OCUPADA` (se reintenta luego); `BLOQUEADA` → `SERIE_BLOQUEADA`.
 *
 * La serie de un (punto de venta, tipo, ambiente) nace con el último número que informa el servicio
 * de emisión. Preguntárselo es un efecto externo y va FUERA de la transacción (ADR-007): esta función
 * devuelve `FALTA_LA_SERIE` y quien llama pregunta y vuelve con `ultimoDelServicio`. `crear` es
 * idempotente y no pisa una serie existente.
 */
export async function reservarEnTx(
  tx: TxDeNumeracion,
  contexto: ContextoOperativo,
  entrada: EntradaDeReservarNumero,
  ultimoDelServicio: bigint | null,
  opciones: OpcionesDeNumeracion = OPCIONES_DE_NUMERACION,
): Promise<Resultado<PasoDeReserva, ErrorPropioAlReservar | EmpresaNoOpera>> {
  const { empresaId } = contexto;
  const opera = await empresaOpera(tx, empresaId);
  if (!opera.ok) return opera;
  const datos = await puntoDeVentaParaEmision(tx, empresaId, entrada.puntoDeVentaId);
  if (datos === null) return err("PUNTO_DE_VENTA_NO_ENCONTRADO");
  if (datos.pv.ambiente !== entrada.ambiente) return err("AMBIENTE_DISTINTO_DEL_PUNTO_DE_VENTA");
  const entidad = entidadDeSerie(entrada.puntoDeVentaId, entrada.tipo, entrada.ambiente);
  // Solo un punto de venta activo, con su emisor activo, reserva un número NUEVO.
  const puedeReservarNuevo = (): Resultado<null, "PUNTO_DE_VENTA_INACTIVO" | "EMISOR_INACTIVO"> =>
    datos.pv.estado !== "ACTIVO"
      ? err("PUNTO_DE_VENTA_INACTIVO")
      : datos.emisor.activo
        ? ok(null)
        : err("EMISOR_INACTIVO");

  let serie = await tx.series.obtener(
    empresaId,
    entrada.puntoDeVentaId,
    entrada.tipo,
    entrada.ambiente,
  );
  if (serie === null) {
    const puede = puedeReservarNuevo();
    if (!puede.ok) return puede;
    if (ultimoDelServicio === null) {
      return ok({ tipo: "FALTA_LA_SERIE", puntoDeVenta: datos.paraEmision });
    }
    const nueva = iniciarSerie(
      {
        empresaId,
        puntoDeVentaId: entrada.puntoDeVentaId,
        emisorId: datos.pv.emisorId,
        ambiente: entrada.ambiente,
        tipo: entrada.tipo,
      },
      ultimoDelServicio,
    );
    if (!nueva.ok) return nueva;
    const alta = await tx.series.crear(nueva.valor);
    serie = alta.valor;
    if (alta.creado) {
      await tx.auditoria.registrar({
        empresaId,
        actorPersonaId: contexto.personaId,
        accion: "SERIE_DE_COMPROBANTES_CREADA",
        entidad: "serie_comprobante",
        entidadId: entidad,
        despues: datosDeSerie(alta.valor),
      });
    }
  }

  const reserva = reservarNumero(serie, entrada.solicitud, contexto.ahora, opciones);
  if (!reserva.ok) return reserva;
  if (reserva.valor.tipo === "YA_RESERVADA") {
    return ok({
      tipo: "RESERVADO",
      salida: { numero: reserva.valor.numero, puntoDeVenta: datos.paraEmision, yaReservada: true },
    });
  }
  const puede = puedeReservarNuevo();
  if (!puede.ok) return puede;
  const guardada = await tx.series.guardar(reserva.valor.serie);
  // En SERIALIZABLE nadie pudo cambiar la fila después de leerla (esa carrera termina en un
  // conflicto de serialización y la transacción se repite): que no se guarde es un defecto.
  if (guardada === null) throw new Error("la serie cambió dentro de la transacción");
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: contexto.personaId,
    accion: "NUMERO_DE_COMPROBANTE_RESERVADO",
    entidad: "serie_comprobante",
    entidadId: entidad,
    antes: datosDeSerie(serie),
    despues: datosDeSerie(guardada),
  });
  return ok({
    tipo: "RESERVADO",
    salida: { numero: reserva.valor.numero, puntoDeVenta: datos.paraEmision, yaReservada: false },
  });
}
