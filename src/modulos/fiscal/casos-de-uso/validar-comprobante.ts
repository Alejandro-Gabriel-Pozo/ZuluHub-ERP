import type { EmpresaNoOpera } from "../../../contexto/estados";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ManejadorDeTrabajo, ResultadoDeManejador } from "../../../puertos/cola-de-trabajos";
import type { Dato } from "../../../puertos/sin-secretos";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type {
  DesenlaceDeAutorizacion,
  EstadoDeComprobanteArca,
} from "../dominio/estados-de-comprobante";
import { comprobanteId, intentoId, type ComprobanteId } from "../dominio/identificadores";
import { esFueraDeSecuencia } from "../dominio/numeracion";
import type { ContextoDeSistema } from "./contrato";
import {
  contextoDeSistema,
  opcionesDe,
  type DependenciasDeFacturacion,
} from "./contrato-de-facturacion";
import type { ErrorDeEmision } from "./emision-electronica";
import {
  autorizarConLimite,
  huellaDe,
  idDeIntento,
  ultimoAutorizadoConLimite,
} from "./llamadas-a-arca";
import {
  cerrarEnTx,
  cerrarFueraDeSecuenciaEnTx,
  type ErrorPropioAlCerrar,
  type ErrorPropioAlReservar,
} from "./numeracion-en-tx";
import {
  cierreDelComprobante,
  intentoDelUltimo,
  mensajesDeAutorizacion,
  solicitudDe,
  type ConsultaDelUltimo,
} from "./validar-comprobante-piezas";
import { tomarYReservar } from "./validar-comprobante-toma";

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
 *  3b. Solo ante un rechazo 10016 (numeración fuera de secuencia; tabla de §B.5.4): afuera, `ultimoAutorizado`
 *     con tiempo límite. Nunca adentro de una transacción (ADR-007).
 *  4. TXb: si el comprobante sigue `EN_VALIDACION` con ese número, cierra la serie (`cerrarEnTx`) y lo mueve
 *     según el desenlace (§B.2.2), con su auditoría. Si ya no (lo resolvió la reconciliación), no toca nada.
 *     Un 10016 queda `RECHAZADO` (terminal, sin CAE: el número nunca se usó) y la serie se decide en ESA misma
 *     transacción con lo que ARCA informó (`cerrarFueraDeSecuenciaEnTx`): en el último número de la serie,
 *     `LIBRE` como cualquier rechazo; en otro, o sin respuesta, `BLOQUEADA` por desfase hasta que el gerente la
 *     resincronice (QF1). Sin eso, con otro sistema usando el punto de venta cada comprobante nuevo sería un
 *     10016 más, uno por uno y para siempre. El intento de la consulta (`ULTIMO_AUTORIZADO`) va en la misma TXb.
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
      /** Solo presente (`true`) si un rechazo 10016 dejó la serie `BLOQUEADA` por desfase con ARCA. */
      serieBloqueada?: true;
    }>;

export type ErrorAlValidarComprobante =
  | "COMPROBANTE_NO_ENCONTRADO"
  | Exclude<ErrorPropioAlReservar, "SERIE_OCUPADA" | "SERIE_BLOQUEADA">
  | ErrorPropioAlCerrar
  | EmpresaNoOpera
  | ErrorDeEmision
  | ErrorDePersistencia;

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
      tomarYReservar(transacciones, contexto, entrada, opciones, ultimoDelServicio);

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

    // 3b. Un 10016 (numeración fuera de secuencia): afuera, el último autorizado de ARCA, para decidir si es un
    //     rechazo suelto o un desfase (otro sistema usó el punto de venta). Si no responde, `ultimo` es un error
    //     y la serie NO se libera (queda bloqueada hasta resincronizarla): liberarla sería apostar a que no hay desfase.
    const fueraDeSecuencia = esFueraDeSecuencia(resultado);
    let consultaDelUltimo: ConsultaDelUltimo | null = null;
    if (fueraDeSecuencia) {
      const desde = reloj.ahora();
      const ultimo = await ultimoAutorizadoConLimite(
        servicio,
        puntoDeVenta,
        comprobante.tipo,
        opciones.tiempos,
      );
      consultaDelUltimo = { ultimo, iniciadoEn: desde, terminadoEn: reloj.ahora() };
    }

    // 4. TXb: cerrar la serie y mover el comprobante, si sigue siendo el que se envió.
    const cierre = await transacciones.ejecutar(
      { contexto: contextoDelCierre },
      async (
        tx,
      ): Promise<
        Resultado<
          Readonly<{ cerrado: boolean; serieBloqueada: boolean }>,
          ErrorPropioAlCerrar | EmpresaNoOpera
        >
      > => {
        // La evidencia de la consulta va primero (es idempotente): queda aunque otro haya resuelto el comprobante.
        if (consultaDelUltimo !== null) {
          await tx.intentos.registrar(
            intentoDelUltimo(empresaId, comprobante.id, numero, consultaDelUltimo),
          );
        }
        const actual = await tx.comprobantes.obtener(empresaId, comprobante.id);
        if (
          actual === null ||
          actual.estado !== "EN_VALIDACION" ||
          actual.numeroReservado !== numero
        ) {
          return ok({ cerrado: false, serieBloqueada: false });
        }
        const entradaDeSerie = {
          puntoDeVentaId: actual.puntoDeVentaId,
          tipo: actual.tipo,
          ambiente: actual.ambiente,
          solicitud: solicitud.solicitud,
          numero,
          resultado,
        };
        let serieBloqueada = false;
        let datosDelUltimo: Record<string, Dato> = {};
        if (consultaDelUltimo !== null) {
          const ultimoDeArca = consultaDelUltimo.ultimo.ok ? consultaDelUltimo.ultimo.valor : null;
          const serie = await cerrarFueraDeSecuenciaEnTx(tx, contextoDelCierre, {
            ...entradaDeSerie,
            ultimoDeArca,
          });
          if (!serie.ok) return serie;
          serieBloqueada = serie.valor.resolucion === "BLOQUEADA";
          datosDelUltimo = {
            ultimoAutorizadoPorElServicio: ultimoDeArca?.toString() ?? null,
            serie: serie.valor.resolucion,
          };
        } else {
          const serie = await cerrarEnTx(tx, contextoDelCierre, entradaDeSerie);
          if (!serie.ok) return serie;
        }
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
          despues: { estado: movido.estado, ...datos, ...datosDelUltimo },
        });
        return ok({ cerrado: true, serieBloqueada });
      },
    );
    if (!cierre.ok) return cierre;
    return ok({
      tipo: "ENVIADO",
      numero,
      desenlace: resultado.tipo,
      cerrado: cierre.valor.cerrado,
      ...(cierre.valor.serieBloqueada ? { serieBloqueada: true as const } : {}),
    });
  };
}

/**
 * El manejador del trabajo `fiscal.validar_comprobante` (datos `{ comprobanteId }`). Corre con el contexto de
 * sistema de la empresa DEL TRABAJO: un trabajo que apunta a un comprobante ajeno no lo encuentra (RLS).
 *  - Terminó (se envió, ya no estaba pendiente, la serie está bloqueada): `HECHO`, con una nota si no envió o si
 *    el envío dejó la serie bloqueada (rechazo 10016 con ARCA en otro número).
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
          if (r.valor.desenlace === "NO_ENVIADO") {
            return { tipo: "ERROR", error: "NO_ENVIADO: el pedido no salió", definitivo: false };
          }
          return r.valor.serieBloqueada === true
            ? { tipo: "HECHO", nota: "SERIE_BLOQUEADA: rechazo 10016, espera la resincronización" }
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
