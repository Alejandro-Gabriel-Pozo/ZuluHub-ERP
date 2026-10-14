import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { TipoDeComprobante } from "../dominio/comprobante-emitido";
import type { Ambiente } from "../dominio/comprobante-nuevo";
import type { PuntoDeVentaId } from "../dominio/identificadores";
import {
  reconciliarSerie as reconciliarSerieDelDominio,
  type ErrorDeNumeracion,
  type ResolucionDeReconciliacion,
} from "../dominio/numeracion";
import { datosDeSerie, empresaOpera, entidadDeSerie, puntoDeVentaParaEmision } from "./comun";
import type { ContextoDeSistema, DependenciasDeNumeracion } from "./contrato";
import type { ErrorDeEmision, PuntoDeVentaParaEmision } from "./emision-electronica";

export type EntradaDeReconciliarSerie = Readonly<{
  puntoDeVentaId: PuntoDeVentaId;
  tipo: TipoDeComprobante;
  ambiente: Ambiente;
}>;

export type SalidaDeReconciliarSerie =
  /** La reserva vencida se resolvió según lo que informó el servicio de emisión. */
  | Readonly<{
      tipo: "RECONCILIADA";
      resolucion: ResolucionDeReconciliacion;
      /** Lo que informó el servicio de emisión (`FECompUltimoAutorizado`). */
      ultimoAutorizado: bigint;
    }>
  /** La serie no tiene una reserva que reconciliar (nunca la tuvo, o ya se resolvió): no se escribió nada. */
  | Readonly<{ tipo: "NADA_QUE_RECONCILIAR" }>;

type ErrorPropioAlReconciliar = "SERIE_NO_ENCONTRADA" | ErrorDeNumeracion;

export type ErrorAlReconciliarSerie =
  ErrorPropioAlReconciliar | EmpresaNoOpera | ErrorDeEmision | ErrorDePersistencia;

type Preparacion =
  | Readonly<{ tipo: "NADA" }>
  | Readonly<{
      tipo: "CONSULTAR";
      puntoDeVenta: PuntoDeVentaParaEmision;
      solicitud: string;
      numeroEnCurso: bigint;
    }>;

/**
 * Reconciliar la reserva vencida de una serie con lo que dice el servicio de emisión (H7, §B.8). Es
 * el trabajo de sistema que recupera lo que quedó colgado (autorizó y se cayó, incierto, el proceso
 * murió antes de cerrar). Contexto OPERATIVO sin persona (`ContextoDeSistema`): `sinGuard`.
 *
 * Decide solo con `ultimoAutorizado`: no sabe de quién es el comprobante que ARCA tiene en ese número
 * ni cuál es su CAE. Por eso, con la facturación, queda solo para una serie `EN_CURSO` SIN comprobante
 * (el recorrido de T6); la de un comprobante en vuelo se reconcilia consultando su número
 * (`reconciliarComprobante`, H7 facturación §B.3.7), y la base impide soltar una reserva a la que un
 * comprobante `EN_VALIDACION` o `INCIERTO` todavía se apoya (`comprobante_serie_sin_reserva`).
 *
 * Tres pasos, porque preguntarle al servicio es un efecto externo y NO puede ir adentro de una
 * transacción (ADR-007):
 *   1. Transacción: lee la serie. Si no está `EN_CURSO`, `NADA_QUE_RECONCILIAR` (repetir es un éxito);
 *      si la reserva no venció, `RESERVA_NO_VENCIDA`.
 *   2. Fuera de la transacción: `ultimoAutorizado` del servicio. Si no responde, el error sale tal
 *      cual y la serie sigue `EN_CURSO` (se reintenta).
 *   3. Transacción: vuelve a leer y, si la serie SIGUE con la MISMA reserva (misma solicitud y mismo
 *      número), aplica `reconciliarSerie` del dominio, guarda y audita en la misma transacción. Si
 *      mientras tanto otro la cerró, la liberó o ya reservó otro número, no toca nada
 *      (`NADA_QUE_RECONCILIAR`): lo que dijo el servicio era sobre la reserva anterior.
 *
 * Dos reconciliaciones a la vez no duplican nada: la segunda encuentra la serie ya resuelta.
 */
export function armarReconciliarSerie({ transacciones, emision }: DependenciasDeNumeracion) {
  return async function reconciliarSerie(
    contexto: ContextoDeSistema,
    entrada: EntradaDeReconciliarSerie,
  ): Promise<Resultado<SalidaDeReconciliarSerie, ErrorAlReconciliarSerie>> {
    if (contexto.personaId !== null) {
      throw new RangeError(
        "reconciliarSerie es un trabajo de sistema: el contexto no lleva persona",
      );
    }
    const { empresaId, ahora } = contexto;

    const preparacion = await transacciones.ejecutar(
      { contexto, soloLectura: true },
      async (tx): Promise<Resultado<Preparacion, ErrorPropioAlReconciliar | EmpresaNoOpera>> => {
        const opera = await empresaOpera(tx, empresaId);
        if (!opera.ok) return opera;
        const serie = await tx.series.obtener(
          empresaId,
          entrada.puntoDeVentaId,
          entrada.tipo,
          entrada.ambiente,
        );
        if (serie === null) return err("SERIE_NO_ENCONTRADA");
        if (serie.estado !== "EN_CURSO") return ok({ tipo: "NADA" });
        // Sondeo: con el último número ya guardado el dominio siempre acepta, salvo que la reserva
        // no haya vencido, que es lo único que se quiere saber antes de preguntarle al servicio.
        const sondeo = reconciliarSerieDelDominio(serie, serie.ultimoNumero, ahora);
        if (!sondeo.ok) return sondeo;
        const datos = await puntoDeVentaParaEmision(tx, empresaId, entrada.puntoDeVentaId);
        if (datos === null) throw new Error("la serie existe pero su punto de venta no es visible");
        return ok({
          tipo: "CONSULTAR",
          puntoDeVenta: datos.paraEmision,
          solicitud: serie.solicitud,
          numeroEnCurso: serie.numeroEnCurso,
        });
      },
    );
    if (!preparacion.ok) return preparacion;
    if (preparacion.valor.tipo === "NADA") return ok({ tipo: "NADA_QUE_RECONCILIAR" });
    const { puntoDeVenta, solicitud, numeroEnCurso } = preparacion.valor;

    const consulta = await emision.ultimoAutorizado(puntoDeVenta, entrada.tipo);
    if (!consulta.ok) return consulta;
    const ultimoAutorizado = consulta.valor;

    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<SalidaDeReconciliarSerie, ErrorPropioAlReconciliar | EmpresaNoOpera>
      > => {
        const opera = await empresaOpera(tx, empresaId);
        if (!opera.ok) return opera;
        const serie = await tx.series.obtener(
          empresaId,
          entrada.puntoDeVentaId,
          entrada.tipo,
          entrada.ambiente,
        );
        if (serie === null) return err("SERIE_NO_ENCONTRADA");
        if (
          serie.estado !== "EN_CURSO" ||
          serie.solicitud !== solicitud ||
          serie.numeroEnCurso !== numeroEnCurso
        ) {
          return ok({ tipo: "NADA_QUE_RECONCILIAR" });
        }
        const reconciliacion = reconciliarSerieDelDominio(serie, ultimoAutorizado, ahora);
        if (!reconciliacion.ok) return reconciliacion;
        const { resolucion } = reconciliacion.valor;
        const guardada = await tx.series.guardar(reconciliacion.valor.serie);
        if (guardada === null) throw new Error("la serie cambió dentro de la transacción");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: null,
          accion:
            resolucion === "BLOQUEADA"
              ? "SERIE_DE_COMPROBANTES_BLOQUEADA"
              : "SERIE_DE_COMPROBANTES_RECONCILIADA",
          entidad: "serie_comprobante",
          entidadId: entidadDeSerie(entrada.puntoDeVentaId, entrada.tipo, entrada.ambiente),
          antes: datosDeSerie(serie),
          despues: {
            ...datosDeSerie(guardada),
            resolucion,
            solicitud,
            ultimoAutorizadoPorElServicio: ultimoAutorizado.toString(),
          },
        });
        return ok({ tipo: "RECONCILIADA", resolucion, ultimoAutorizado });
      },
    );
  };
}
