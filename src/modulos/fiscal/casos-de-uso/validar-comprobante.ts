import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaDeNegocio } from "../../../primitivas/tiempo/fecha-de-negocio";
import type { ManejadorDeTrabajo, ResultadoDeManejador } from "../../../puertos/cola-de-trabajos";
import type { Dato } from "../../../puertos/sin-secretos";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type {
  DesenlaceDeAutorizacion,
  EstadoDeComprobanteArca,
  Mensaje,
  ResultadoDeAutorizacionArca,
} from "../dominio/estados-de-comprobante";
import {
  comprobanteId,
  intentoId,
  solicitudId,
  type ComprobanteId,
} from "../dominio/identificadores";
import { importesParaArca } from "../dominio/importes-para-arca";
import type {
  CambioDeComprobante,
  ComprobanteGuardado,
} from "../persistencia/repositorio-de-comprobantes";
import type { MensajeDeIntento } from "../persistencia/repositorio-de-intentos";
import type { ContextoDeSistema } from "./contrato";
import {
  contextoDeSistema,
  opcionesDe,
  type DependenciasDeFacturacion,
} from "./contrato-de-facturacion";
import type {
  ErrorDeEmision,
  PuntoDeVentaParaEmision,
  SolicitudDeAutorizacion,
} from "./emision-electronica";
import {
  autorizarConLimite,
  huellaDe,
  idDeIntento,
  ultimoAutorizadoConLimite,
} from "./llamadas-a-arca";
import {
  cerrarEnTx,
  reservarEnTx,
  type ErrorPropioAlCerrar,
  type ErrorPropioAlReservar,
} from "./numeracion-en-tx";

/**
 * Trabajo `fiscal.validar_comprobante` (spec H7 facturación §B.4.5): lleva un comprobante `PENDIENTE` a ARCA. Sin
 * guard (lo declara `DECLARACIONES_DE_FACTURACION`) y sin persona: el permiso se exigió al emitir.
 *
 *  1. TXa: si el comprobante no está `PENDIENTE`, termina sin hacer nada (repetir es seguro). Reserva el número
 *     (`reservarEnTx`, la solicitud es el comprobante): si la serie no existe, pregunta afuera el último
 *     autorizado y vuelve (dos fases, ADR-007); `SERIE_OCUPADA` no escribe y se reintenta; `SERIE_BLOQUEADA`
 *     deja el comprobante `PENDIENTE` (lo retoma la resincronización). Con número: `EN_VALIDACION` con la fecha
 *     del día civil de la empresa, y su auditoría.
 *  2. Afuera: `autorizar` con tiempo límite propio (un pedido que no vuelve es `INCIERTO`, nunca se reenvía).
 *  3. TXi: el intento (lo que respondió ARCA, sin secretos), ANTES de cerrar: si el cierre falla, el CAE queda.
 *  4. TXb: si el comprobante sigue `EN_VALIDACION` con ese número, cierra la serie (`cerrarEnTx`) y lo mueve
 *     según el desenlace (§B.2.2), con su auditoría. Si ya no (lo resolvió la reconciliación), no toca nada.
 *
 * Si el proceso muere entre 1 y 4, o TXb falla, queda `EN_VALIDACION` con la serie `EN_CURSO`: al vencer la
 * reserva lo levanta la reconciliación consultando. Un reintento del trabajo encuentra el comprobante fuera de
 * `PENDIENTE` y no reenvía: un pedido que pudo haber llegado NUNCA se vuelve a mandar.
 */

export type EntradaDeValidarComprobante = Readonly<{ comprobanteId: ComprobanteId }>;

export type SalidaDeValidarComprobante =
  /** El comprobante no estaba `PENDIENTE`: no se hizo nada. */
  | Readonly<{ tipo: "NADA_QUE_VALIDAR"; estado: EstadoDeComprobanteArca }>
  /** Otro comprobante tiene la serie: no se escribió nada, se reintenta. */
  | Readonly<{ tipo: "SERIE_OCUPADA" }>
  /** La serie está bloqueada: el comprobante sigue `PENDIENTE` hasta resincronizarla. */
  | Readonly<{ tipo: "SERIE_BLOQUEADA" }>
  /**
   * Se pidió la autorización. `cerrado`: TXb movió el comprobante (si es `false`, otro ya lo había resuelto).
   */
  | Readonly<{
      tipo: "ENVIADO";
      numero: bigint;
      desenlace: DesenlaceDeAutorizacion;
      cerrado: boolean;
    }>;

export type ErrorAlValidarComprobante =
  | "COMPROBANTE_NO_ENCONTRADO"
  | Exclude<ErrorPropioAlReservar, "SERIE_OCUPADA" | "SERIE_BLOQUEADA">
  | ErrorPropioAlCerrar
  | EmpresaNoOpera
  | ErrorDeEmision
  | ErrorDePersistencia;

type Toma =
  | Readonly<{ tipo: "NADA"; estado: EstadoDeComprobanteArca }>
  | Readonly<{ tipo: "OCUPADA" | "BLOQUEADA" }>
  | Readonly<{
      tipo: "FALTA_LA_SERIE";
      puntoDeVenta: PuntoDeVentaParaEmision;
      comprobante: ComprobanteGuardado;
    }>
  | Readonly<{
      tipo: "RESERVADO";
      comprobante: ComprobanteGuardado;
      puntoDeVenta: PuntoDeVentaParaEmision;
    }>;

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
function cierreDelComprobante(
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

export function armarValidarComprobante(dependencias: DependenciasDeFacturacion) {
  const { transacciones, emision, reloj } = dependencias;
  const opciones = opcionesDe(dependencias);

  return async function validarComprobante(
    contexto: ContextoDeSistema,
    entrada: EntradaDeValidarComprobante,
  ): Promise<Resultado<SalidaDeValidarComprobante, ErrorAlValidarComprobante>> {
    if (contexto.personaId !== null) {
      throw new RangeError(
        "validarComprobante es un trabajo de sistema: el contexto no lleva persona",
      );
    }
    const { empresaId } = contexto;

    // 1. TXa: tomar el comprobante y reservar su número.
    const tomar = (ultimoDelServicio: bigint | null) =>
      transacciones.ejecutar(
        { contexto },
        async (
          tx,
        ): Promise<
          Resultado<
            Toma,
            | "COMPROBANTE_NO_ENCONTRADO"
            | Exclude<ErrorPropioAlReservar, "SERIE_OCUPADA" | "SERIE_BLOQUEADA">
            | EmpresaNoOpera
          >
        > => {
          const c = await tx.comprobantes.obtener(empresaId, entrada.comprobanteId);
          if (c === null) return err("COMPROBANTE_NO_ENCONTRADO");
          if (c.estado !== "PENDIENTE") return ok({ tipo: "NADA", estado: c.estado });
          const reserva = await reservarEnTx(
            tx,
            contexto,
            {
              puntoDeVentaId: c.puntoDeVentaId,
              tipo: c.tipo,
              ambiente: c.ambiente,
              solicitud: solicitudId(c.id),
            },
            ultimoDelServicio,
            opciones.numeracion,
          );
          if (!reserva.ok) {
            if (reserva.error === "SERIE_OCUPADA") return ok({ tipo: "OCUPADA" });
            if (reserva.error === "SERIE_BLOQUEADA") return ok({ tipo: "BLOQUEADA" });
            return err(reserva.error);
          }
          if (reserva.valor.tipo === "FALTA_LA_SERIE") {
            return ok({
              tipo: "FALTA_LA_SERIE",
              puntoDeVenta: reserva.valor.puntoDeVenta,
              comprobante: c,
            });
          }
          const { numero, puntoDeVenta } = reserva.valor.salida;
          // `reservarEnTx` ya comprobó que la empresa opera: es visible.
          const empresa = await tx.empresas.obtener(empresaId);
          if (empresa === null) throw new Error(`la empresa ${empresaId} no es visible`);
          // La fecha del comprobante es el día civil de la empresa AL RESERVAR (§B.3.6).
          const fecha = fechaDeNegocio(contexto.ahora, empresa.zonaHoraria, "00:00");
          if (!fecha.ok) throw new RangeError(`no hay fecha del comprobante: ${fecha.error}`);
          const movido = await tx.comprobantes.transicionar(empresaId, c.id, c.version, {
            a: "EN_VALIDACION",
            numeroReservado: numero,
            fechaEmision: fecha.valor,
          });
          if (movido === null) throw new Error("el comprobante cambió dentro de la transacción");
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: null,
            accion: "COMPROBANTE_EN_VALIDACION",
            entidad: "comprobante",
            entidadId: c.id,
            antes: { estado: c.estado },
            despues: {
              estado: movido.estado,
              numero: numero.toString(),
              fecha: fecha.valor,
              envio: movido.envios,
            },
          });
          return ok({ tipo: "RESERVADO", comprobante: movido, puntoDeVenta });
        },
      );

    let toma = await tomar(null);
    if (toma.ok && toma.valor.tipo === "FALTA_LA_SERIE") {
      // La serie no existe: se pregunta FUERA de la transacción y se vuelve con el número (dos fases, T6).
      const { comprobante, puntoDeVenta } = toma.valor;
      const servicio = emision.para(empresaId, comprobante.emisorId, comprobante.ambiente);
      const ultimo = await ultimoAutorizadoConLimite(
        servicio,
        puntoDeVenta,
        comprobante.tipo,
        opciones.tiempos,
      );
      if (!ultimo.ok) return ultimo;
      toma = await tomar(ultimo.valor);
    }
    if (!toma.ok) return toma;
    const tomado = toma.valor;
    switch (tomado.tipo) {
      case "NADA":
        return ok({ tipo: "NADA_QUE_VALIDAR", estado: tomado.estado });
      case "OCUPADA":
        return ok({ tipo: "SERIE_OCUPADA" });
      case "BLOQUEADA":
        return ok({ tipo: "SERIE_BLOQUEADA" });
      case "FALTA_LA_SERIE":
        throw new Error("la serie sigue sin existir después de crearla");
      case "RESERVADO":
        break;
    }
    const { comprobante, puntoDeVenta } = tomado;
    const solicitud = solicitudDe(comprobante, puntoDeVenta);
    const numero = solicitud.numero;

    // 2. Afuera: pedir la autorización, con tiempo límite propio.
    const servicio = emision.para(empresaId, comprobante.emisorId, comprobante.ambiente);
    const iniciadoEn = reloj.ahora();
    const resultado = await autorizarConLimite(servicio, solicitud, opciones.tiempos);
    const terminadoEn = reloj.ahora();

    // 3. TXi: el intento, antes de cerrar. Si no se pudo guardar, igual se intenta cerrar: el CAE queda en el
    //    comprobante, y si tampoco se cierra lo recupera la reconciliación consultando.
    const contextoDelCierre: ContextoDeSistema = {
      ...contextoDeSistema(empresaId, terminadoEn),
      personaId: null,
    };
    await transacciones.ejecutar({ contexto: contextoDelCierre }, async (tx) =>
      ok(
        await tx.intentos.registrar({
          id: intentoId(idDeIntento(comprobante.id, "AUTORIZAR", numero, iniciadoEn)),
          empresaId,
          comprobanteId: comprobante.id,
          operacion: "AUTORIZAR",
          numero,
          desenlace: resultado.tipo,
          mensajes: mensajesDeAutorizacion(resultado),
          respuesta: null,
          huellaDelPedido: huellaDe(solicitud),
          iniciadoEn,
          duracionEnMs: Math.max(0, terminadoEn.getTime() - iniciadoEn.getTime()),
        }),
      ),
    );

    // 4. TXb: cerrar la serie y mover el comprobante, si sigue siendo el que se envió.
    const cierre = await transacciones.ejecutar(
      { contexto: contextoDelCierre },
      async (tx): Promise<Resultado<boolean, ErrorPropioAlCerrar | EmpresaNoOpera>> => {
        const actual = await tx.comprobantes.obtener(empresaId, comprobante.id);
        if (
          actual === null ||
          actual.estado !== "EN_VALIDACION" ||
          actual.numeroReservado !== numero
        ) {
          return ok(false);
        }
        const serie = await cerrarEnTx(tx, contextoDelCierre, {
          puntoDeVentaId: actual.puntoDeVentaId,
          tipo: actual.tipo,
          ambiente: actual.ambiente,
          solicitud: solicitud.solicitud,
          numero,
          resultado,
        });
        if (!serie.ok) return serie;
        const { cambio, accion, datos } = cierreDelComprobante(resultado, terminadoEn);
        const movido = await tx.comprobantes.transicionar(
          empresaId,
          actual.id,
          actual.version,
          cambio,
        );
        if (movido === null) throw new Error("el comprobante cambió dentro de la transacción");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: null,
          accion,
          entidad: "comprobante",
          entidadId: actual.id,
          antes: { estado: actual.estado, numero: numero.toString() },
          despues: { estado: movido.estado, ...datos },
        });
        return ok(true);
      },
    );
    if (!cierre.ok) return cierre;
    return ok({ tipo: "ENVIADO", numero, desenlace: resultado.tipo, cerrado: cierre.valor });
  };
}

/**
 * El manejador del trabajo `fiscal.validar_comprobante` (datos `{ comprobanteId }`). Corre con el contexto de
 * sistema de la empresa DEL TRABAJO: un trabajo que apunta a un comprobante ajeno no lo encuentra (RLS).
 *  - Terminó (se envió, ya no estaba pendiente, la serie está bloqueada): `HECHO`, con una nota si no envió.
 *  - Serie ocupada, el pedido no salió, el servicio o la base no respondieron: error que se reintenta.
 *  - Lo que reintentar no arregla (no existe, el punto de venta o el emisor ya no están activos, la empresa
 *    no opera, falta la credencial): error definitivo; el comprobante queda `PENDIENTE` y se puede descartar o
 *    reintentar.
 */
export function crearManejadorDeValidarComprobante(
  dependencias: DependenciasDeFacturacion,
): ManejadorDeTrabajo {
  const validarComprobante = armarValidarComprobante(dependencias);
  return async (trabajo, ahora): Promise<ResultadoDeManejador> => {
    const id = trabajo.datos["comprobanteId"];
    if (typeof id !== "string" || !UUID.test(id)) {
      return {
        tipo: "ERROR",
        error: "los datos del trabajo no traen un comprobanteId válido",
        definitivo: true,
      };
    }
    if (trabajo.empresaId === null) {
      return { tipo: "ERROR", error: "el trabajo no tiene empresa", definitivo: true };
    }
    const contexto: ContextoDeSistema = {
      ...contextoDeSistema(trabajo.empresaId, ahora),
      personaId: null,
    };
    const r = await validarComprobante(contexto, { comprobanteId: comprobanteId(id) });
    if (r.ok) {
      switch (r.valor.tipo) {
        case "NADA_QUE_VALIDAR":
          return { tipo: "HECHO", nota: `NADA_QUE_VALIDAR: ${r.valor.estado}` };
        case "SERIE_BLOQUEADA":
          return { tipo: "HECHO", nota: "SERIE_BLOQUEADA: espera la resincronización" };
        case "SERIE_OCUPADA":
          return { tipo: "ERROR", error: "SERIE_OCUPADA", definitivo: false };
        case "ENVIADO":
          return r.valor.desenlace === "NO_ENVIADO"
            ? { tipo: "ERROR", error: "NO_ENVIADO: el pedido no salió", definitivo: false }
            : { tipo: "HECHO" };
      }
    }
    const error = r.error;
    if (typeof error === "string") {
      return { tipo: "ERROR", error, definitivo: true };
    }
    if ("codigo" in error && error.codigo === "EMPRESA_NO_OPERA") {
      return { tipo: "ERROR", error: `${error.codigo}: ${error.motivo}`, definitivo: true };
    }
    if ("codigo" in error) {
      return {
        tipo: "ERROR",
        error: `emisión: ${error.codigo}`,
        definitivo:
          error.codigo === "SIN_CREDENCIAL" ||
          error.codigo === "AUTORIZACION_DEL_SERVICIO_FALTANTE",
      };
    }
    return { tipo: "ERROR", error: `persistencia: ${error.tipo}`, definitivo: false };
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
