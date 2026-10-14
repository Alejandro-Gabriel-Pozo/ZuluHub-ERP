import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ManejadorDeTrabajo, ResultadoDeManejador } from "../../../puertos/cola-de-trabajos";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ResultadoDeConsulta } from "../dominio/estados-de-comprobante";
import { intentoId, solicitudId, type ComprobanteId } from "../dominio/identificadores";
import type { ErrorDeNumeracion } from "../dominio/numeracion";
import {
  reconciliarComprobante,
  type ContenidoEnVuelo,
  type Reconciliacion,
} from "../dominio/reconciliacion-de-comprobante";
import type {
  CambioDeComprobante,
  ComprobanteGuardado,
} from "../persistencia/repositorio-de-comprobantes";
import { datosDeSerie, empresaOpera, entidadDeSerie } from "./comun";
import type { ContextoDeSistema } from "./contrato";
import {
  contextoDeSistema,
  encolarValidacion,
  opcionesDe,
  type DependenciasDeFacturacion,
} from "./contrato-de-facturacion";
import type { PuntoDeVentaParaEmision } from "./emision-electronica";
import { consultarConLimite, idDeIntento, ultimoAutorizadoConLimite } from "./llamadas-a-arca";

/**
 * Trabajo `fiscal.reconciliar` (spec H7 facturación §B.4.7): barre los comprobantes de la empresa del trabajo
 * que quedaron en vuelo (`EN_VALIDACION` o `INCIERTO` con la reserva de su serie VENCIDA) y los resuelve
 * CONSULTANDO a ARCA su número (§B.3.7), nunca reenviando. Por cada uno:
 *
 *  1. Afuera: `consultar(numero reservado)` y, si ARCA no lo tiene, `ultimoAutorizado`; con tiempo límite.
 *  2. TXi: el intento de la consulta (la evidencia del CAE si después algo falla).
 *  3. TXr: si sigue en vuelo con el mismo número, `reconciliarComprobante` del dominio decide y se guarda serie,
 *     comprobante y auditoría juntos: autorizado por consulta (con el CAE de la consulta), liberado (vuelve a
 *     `PENDIENTE` y se reencola con el MISMO número disponible), en conflicto (otro sistema usó el número: serie
 *     `BLOQUEADA`) o desfase (serie `BLOQUEADA`, comprobante `PENDIENTE` hasta resincronizar). Una consulta que
 *     falló no cambia nada: se reintenta en la próxima corrida.
 *
 * Además reencola los `PENDIENTE` sin trabajo vivo de más de 10 minutos (los que agotaron sus intentos por una
 * serie ocupada). Que un comprobante falle no frena a los demás: su error queda en su entrada. Repetir la corrida
 * es seguro: lo resuelto no vuelve a aparecer y el reencolado no duplica un trabajo vivo.
 */

export type EntradaDeReconciliarComprobantes = Readonly<{ limite?: number }>;

export type ResolucionDeComprobante = Reconciliacion["resolucion"] | "NADA_QUE_RECONCILIAR";

export type ResultadoPorComprobante = Readonly<{
  comprobanteId: ComprobanteId;
  resultado: Resultado<ResolucionDeComprobante, ErrorDeNumeracion | ErrorDePersistencia>;
}>;

export type SalidaDeReconciliarComprobantes = Readonly<{
  comprobantes: readonly ResultadoPorComprobante[];
  /** Cuántos `PENDIENTE` huérfanos se volvieron a encolar. */
  reencolados: number;
}>;

export type ErrorAlReconciliarComprobantes = EmpresaNoOpera | ErrorDePersistencia;

/** Lo que la reconciliación compara de un comprobante guardado (los importes están en `importes`). */
function contenidoEnVuelo(c: ComprobanteGuardado): ContenidoEnVuelo {
  return {
    empresaId: c.empresaId,
    emisorId: c.emisorId,
    puntoDeVentaId: c.puntoDeVentaId,
    ambiente: c.ambiente,
    tipo: c.tipo,
    total: c.importes.total,
    desglose: c.desglose,
    asociado: c.asociado,
    receptor: c.receptor,
    emisor: { puntoDeVentaNumero: c.emisor.puntoDeVentaNumero },
  };
}

/** El comprobante según la resolución: el cambio y su auditoría (§B.2.2). */
function cambioPorResolucion(
  r: Exclude<Reconciliacion, { resolucion: "SIN_CAMBIOS" }>,
  ahora: Date,
): Readonly<{ cambio: CambioDeComprobante; accion: string }> {
  switch (r.resolucion) {
    case "AUTORIZADO_POR_CONSULTA":
      return {
        cambio: {
          a: "AUTORIZADO",
          cae: r.codigo,
          caeVence: r.vence,
          autorizadoEn: ahora,
          resueltoPor: "RECONCILIACION",
        },
        accion: "COMPROBANTE_AUTORIZADO",
      };
    case "LIBERADO_POR_CONSULTA":
    case "DESFASE":
      return { cambio: { a: "PENDIENTE" }, accion: "COMPROBANTE_LIBERADO_POR_CONSULTA" };
    case "CONFLICTO":
      return { cambio: { a: "CONFLICTO" }, accion: "COMPROBANTE_EN_CONFLICTO" };
  }
}

export function armarReconciliarComprobantes(dependencias: DependenciasDeFacturacion) {
  const { transacciones, emision, reloj } = dependencias;
  const opciones = opcionesDe(dependencias);

  /** Un comprobante en vuelo: consultar afuera, guardar el intento y resolver. */
  async function reconciliarUno(
    empresaId: ContextoDeSistema["empresaId"],
    c: ComprobanteGuardado,
  ): Promise<ResultadoPorComprobante["resultado"]> {
    const numero = c.numeroReservado;
    const fecha = c.fechaEmision;
    // `enVueloVencidos` solo devuelve comprobantes en vuelo, que siempre tienen número y fecha.
    if (numero === null || fecha === null) throw new Error("un comprobante en vuelo sin número");
    const servicio = emision.para(empresaId, c.emisorId, c.ambiente);
    const pv: PuntoDeVentaParaEmision = {
      cuit: c.emisor.cuit,
      numero: c.emisor.puntoDeVentaNumero,
    };

    const iniciadoEn = reloj.ahora();
    const consulta: ResultadoDeConsulta = await consultarConLimite(
      servicio,
      pv,
      c.tipo,
      numero,
      opciones.tiempos,
    );
    const terminadoEn = reloj.ahora();
    let ultimo: bigint | null = null;
    if (consulta.tipo === "NO_ENCONTRADO") {
      const u = await ultimoAutorizadoConLimite(servicio, pv, c.tipo, opciones.tiempos);
      // Sin el último autorizado no se puede distinguir «liberar» de «desfase»: no se toca nada.
      if (!u.ok) return ok("SIN_CAMBIOS");
      ultimo = u.valor;
    }
    const contexto: ContextoDeSistema = {
      ...contextoDeSistema(empresaId, reloj.ahora()),
      personaId: null,
    };

    await transacciones.ejecutar({ contexto }, async (tx) =>
      ok(
        await tx.intentos.registrar({
          id: intentoId(idDeIntento(c.id, "CONSULTAR", numero, iniciadoEn)),
          empresaId,
          comprobanteId: c.id,
          operacion: "CONSULTAR",
          numero,
          desenlace: consulta.tipo,
          mensajes: [],
          respuesta: null,
          huellaDelPedido: null,
          iniciadoEn,
          duracionEnMs: Math.max(0, terminadoEn.getTime() - iniciadoEn.getTime()),
        }),
      ),
    );

    return transacciones.ejecutar(
      { contexto },
      async (tx): Promise<Resultado<ResolucionDeComprobante, ErrorDeNumeracion>> => {
        const actual = await tx.comprobantes.obtener(empresaId, c.id);
        if (
          actual === null ||
          (actual.estado !== "EN_VALIDACION" && actual.estado !== "INCIERTO") ||
          actual.numeroReservado !== numero
        ) {
          return ok("NADA_QUE_RECONCILIAR");
        }
        const serie = await tx.series.obtener(empresaId, c.puntoDeVentaId, c.tipo, c.ambiente);
        if (serie === null) throw new Error("un comprobante en vuelo sin su serie");
        const decision = reconciliarComprobante(
          serie,
          { solicitud: solicitudId(actual.id), numero, fecha, contenido: contenidoEnVuelo(actual) },
          consulta,
          ultimo ?? serie.ultimoNumero,
          contexto.ahora,
        );
        if (!decision.ok) return decision;
        const r = decision.valor;
        if (r.resolucion === "SIN_CAMBIOS") return ok("SIN_CAMBIOS");

        const guardada = await tx.series.guardar(r.serie);
        if (guardada === null) throw new Error("la serie cambió dentro de la transacción");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: null,
          accion:
            r.resolucion === "CONFLICTO" || r.resolucion === "DESFASE"
              ? "SERIE_BLOQUEADA"
              : "SERIE_DE_COMPROBANTES_RECONCILIADA",
          entidad: "serie_comprobante",
          entidadId: entidadDeSerie(c.puntoDeVentaId, c.tipo, c.ambiente),
          antes: datosDeSerie(serie),
          despues: {
            ...datosDeSerie(guardada),
            resolucion: r.resolucion,
            comprobante: c.id,
            ultimoAutorizadoPorElServicio: ultimo?.toString() ?? null,
          },
        });
        const { cambio, accion } = cambioPorResolucion(r, contexto.ahora);
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
          despues: {
            estado: movido.estado,
            resolucion: r.resolucion,
            ...(r.resolucion === "AUTORIZADO_POR_CONSULTA"
              ? { cae: r.codigo, caeVence: r.vence }
              : {}),
          },
        });
        // Liberado: ARCA no lo tiene y la serie quedó libre; se vuelve a validar (sale con el mismo número).
        if (r.resolucion === "LIBERADO_POR_CONSULTA") {
          await encolarValidacion(tx, empresaId, actual.id);
        }
        return ok(r.resolucion);
      },
    );
  }

  return async function reconciliarComprobantes(
    contexto: ContextoDeSistema,
    entrada: EntradaDeReconciliarComprobantes = {},
  ): Promise<Resultado<SalidaDeReconciliarComprobantes, ErrorAlReconciliarComprobantes>> {
    if (contexto.personaId !== null) {
      throw new RangeError(
        "reconciliarComprobantes es un trabajo de sistema: el contexto no lleva persona",
      );
    }
    const limite = entrada.limite ?? opciones.limitePorCorrida;
    if (!Number.isSafeInteger(limite) || limite <= 0) {
      throw new RangeError("el límite de comprobantes por corrida debe ser un entero positivo");
    }
    const { empresaId, ahora } = contexto;

    const enVuelo = await transacciones.ejecutar(
      { contexto, soloLectura: true },
      async (tx): Promise<Resultado<ComprobanteGuardado[], EmpresaNoOpera>> => {
        const opera = await empresaOpera(tx, empresaId);
        if (!opera.ok) return err(opera.error);
        return ok(await tx.comprobantes.enVueloVencidos(empresaId, ahora, limite));
      },
    );
    if (!enVuelo.ok) return enVuelo;

    const comprobantes: ResultadoPorComprobante[] = [];
    for (const c of enVuelo.valor) {
      comprobantes.push({ comprobanteId: c.id, resultado: await reconciliarUno(empresaId, c) });
    }

    // Los PENDIENTE huérfanos: sin trabajo vivo y más viejos que el plazo.
    const huerfanos = await transacciones.ejecutar({ contexto }, async (tx) => {
      const ids = await tx.comprobantes.pendientes(
        empresaId,
        { creadosAntesDe: new Date(ahora.getTime() - opciones.pendienteHuerfanoEnMs) },
        limite,
      );
      let reencolados = 0;
      for (const id of ids) {
        if (await encolarValidacion(tx, empresaId, id)) reencolados += 1;
      }
      return ok(reencolados);
    });
    if (!huerfanos.ok) return huerfanos;
    return ok({ comprobantes, reencolados: huerfanos.valor });
  };
}

/**
 * El manejador del trabajo `fiscal.reconciliar` (sin datos: la empresa es la del trabajo). Terminó la corrida:
 * `HECHO` con el resumen (cuántos por resolución); la empresa no opera: definitivo; la base falló: se reintenta.
 */
export function crearManejadorDeReconciliar(
  dependencias: DependenciasDeFacturacion,
): ManejadorDeTrabajo {
  const reconciliar = armarReconciliarComprobantes(dependencias);
  return async (trabajo, ahora): Promise<ResultadoDeManejador> => {
    if (trabajo.empresaId === null) {
      return { tipo: "ERROR", error: "el trabajo no tiene empresa", definitivo: true };
    }
    const r = await reconciliar({
      ...contextoDeSistema(trabajo.empresaId, ahora),
      personaId: null,
    });
    if (!r.ok) {
      return "codigo" in r.error
        ? { tipo: "ERROR", error: `${r.error.codigo}: ${r.error.motivo}`, definitivo: true }
        : { tipo: "ERROR", error: `persistencia: ${r.error.tipo}`, definitivo: false };
    }
    const cuenta = new Map<string, number>();
    for (const { resultado } of r.valor.comprobantes) {
      const clave = resultado.ok
        ? resultado.valor
        : typeof resultado.error === "string"
          ? resultado.error
          : resultado.error.tipo;
      cuenta.set(clave, (cuenta.get(clave) ?? 0) + 1);
    }
    const resumen = [...cuenta.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([clave, n]) => `${clave}=${n}`);
    return { tipo: "HECHO", nota: [...resumen, `REENCOLADOS=${r.valor.reencolados}`].join(" ") };
  };
}
