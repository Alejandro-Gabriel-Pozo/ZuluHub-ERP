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
  OPCIONES_DE_NUMERACION,
  cerrarSerie,
  iniciarSerie,
  reservarNumero,
  resincronizarSerie,
  type ErrorDeNumeracion,
  type ErrorDeResincronizacion,
  type OpcionesDeNumeracion,
} from "../dominio/numeracion";
import { datosDeSerie, empresaOpera, entidadDeSerie, puntoDeVentaParaEmision } from "./comun";
import type { TxDeNumeracion } from "./contrato";
import type { PuntoDeVentaParaEmision } from "./emision-electronica";

/**
 * El cuerpo transaccional de la numeración (spec H7 facturación §B.2.3, punto 1), SIN guard. Lo
 * llaman los casos de uso de T6 (`reservarNumeroDeComprobante`, `cerrarReservaDeNumero`), que exigen
 * el permiso de la persona antes, y el trabajo de validación del facturador, que corre sin persona
 * (ADR-007) dentro de su propia transacción. Previene: dos copias de la lógica de reserva que se
 * desvíen (un número duplicado o con hueco).
 *
 * Reglas de quien llama: ya abrió la transacción (SERIALIZABLE) y ya autorizó la acción. Estas
 * funciones NO se exportan por `publico.ts`: exponerlas sería exponer la numeración sin guard.
 */

// ---------------------------------------------------------------------------------------------
// Reservar
// ---------------------------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------------------------
// Cerrar
// ---------------------------------------------------------------------------------------------

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
// Resincronizar (salida de BLOQUEADA)
// ---------------------------------------------------------------------------------------------

export type EntradaDeResincronizarSerie = Readonly<{
  puntoDeVentaId: PuntoDeVentaId;
  tipo: TipoDeComprobante;
  ambiente: Ambiente;
  /** El último número que la persona vio en la pantalla y confirmó. */
  ultimoVistoEnArca: bigint;
  /** El último número que ARCA informa ahora (`ultimoAutorizado`, consultado FUERA de la transacción). */
  ultimoDeArca: bigint;
  /** Por qué se resincroniza: queda en la auditoría. */
  motivo: string;
}>;

export type SalidaDeResincronizarSerie = Readonly<{ ultimoNumero: bigint }>;

export type ErrorPropioAlResincronizar = "SERIE_NO_ENCONTRADA" | ErrorDeResincronizacion;

/**
 * Sacar una serie de `BLOQUEADA` (spec H7 facturación §B.4.6, QF1): `BLOQUEADA → LIBRE` con el último
 * número de ARCA, nunca hacia atrás (`resincronizarSerie` del dominio decide). Los números entre el
 * viejo y el nuevo los emitió otro sistema: no son huecos de ZuluHub y la auditoría
 * `SERIE_RESINCRONIZADA` los explica (antes, después y motivo), en la misma transacción.
 *
 * Es solo el cuerpo transaccional: el permiso (`series.resincronizar`), la consulta a ARCA fuera de
 * la transacción y el reencolado de los comprobantes `PENDIENTE` de la serie son del caso de uso que
 * la llame. Repetirla encuentra la serie ya `LIBRE` y da `SERIE_NO_BLOQUEADA`, sin escribir nada.
 */
export async function resincronizarEnTx(
  tx: TxDeNumeracion,
  contexto: ContextoOperativo,
  entrada: EntradaDeResincronizarSerie,
): Promise<Resultado<SalidaDeResincronizarSerie, ErrorPropioAlResincronizar | EmpresaNoOpera>> {
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
  const libre = resincronizarSerie(serie, entrada.ultimoVistoEnArca, entrada.ultimoDeArca);
  if (!libre.ok) return libre;
  const guardada = await tx.series.guardar(libre.valor);
  if (guardada === null) throw new Error("la serie cambió dentro de la transacción");
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: contexto.personaId,
    accion: "SERIE_RESINCRONIZADA",
    entidad: "serie_comprobante",
    entidadId: entidadDeSerie(entrada.puntoDeVentaId, entrada.tipo, entrada.ambiente),
    antes: datosDeSerie(serie),
    despues: {
      ...datosDeSerie(guardada),
      ultimoVistoEnArca: entrada.ultimoVistoEnArca.toString(),
      motivo: entrada.motivo,
    },
  });
  return ok({ ultimoNumero: guardada.ultimoNumero });
}
