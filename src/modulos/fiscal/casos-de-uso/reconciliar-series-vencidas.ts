import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { TipoDeComprobante } from "../dominio/comprobante-emitido";
import type { PuntoDeVentaId } from "../dominio/identificadores";
import { empresaOpera } from "./comun";
import type { ContextoDeSistema, DependenciasDeNumeracion } from "./contrato";
import type {
  ErrorAlReconciliarSerie,
  SalidaDeReconciliarSerie,
  armarReconciliarSerie,
} from "./reconciliar-serie";

/** Cuántas series reconcilia una corrida si no se pide otra cosa. */
export const LIMITE_DE_SERIES_POR_CORRIDA = 50;

export type EntradaDeReconciliarSeriesVencidas = Readonly<{ limite?: number }>;

export type ResultadoPorSerie = Readonly<{
  puntoDeVentaId: PuntoDeVentaId;
  tipo: TipoDeComprobante;
  resultado: Resultado<SalidaDeReconciliarSerie, ErrorAlReconciliarSerie>;
}>;

export type SalidaDeReconciliarSeriesVencidas = Readonly<{
  /** Una entrada por serie vencida, de la más vieja a la más nueva. */
  series: readonly ResultadoPorSerie[];
  /** `true`: había más que el límite; una corrida siguiente sigue con el resto. */
  hayMas: boolean;
}>;

export type ErrorAlReconciliarSeriesVencidas = EmpresaNoOpera | ErrorDePersistencia;

/**
 * Reconciliar todas las reservas vencidas de la empresa del trabajo (H7, §B.8): lista las series
 * `EN_CURSO` cuyo plazo pasó y reconcilia cada una con `reconciliarSerie`, una por una (cada una en
 * sus propias transacciones: el servicio se consulta fuera de ellas). Que una serie falle (el
 * servicio no responde, está bloqueada) no frena a las demás: su error queda en su entrada. Repetir
 * la corrida es seguro: lo ya resuelto no vuelve a aparecer.
 */
export function armarReconciliarSeriesVencidas(
  { transacciones }: DependenciasDeNumeracion,
  reconciliarSerie: ReturnType<typeof armarReconciliarSerie>,
) {
  return async function reconciliarSeriesVencidas(
    contexto: ContextoDeSistema,
    entrada: EntradaDeReconciliarSeriesVencidas = {},
  ): Promise<Resultado<SalidaDeReconciliarSeriesVencidas, ErrorAlReconciliarSeriesVencidas>> {
    if (contexto.personaId !== null) {
      throw new RangeError(
        "reconciliarSeriesVencidas es un trabajo de sistema: el contexto no lleva persona",
      );
    }
    const limite = entrada.limite ?? LIMITE_DE_SERIES_POR_CORRIDA;
    if (!Number.isSafeInteger(limite) || limite <= 0) {
      throw new RangeError("el límite de series por corrida debe ser un entero positivo");
    }
    const { empresaId, ahora } = contexto;
    const vencidas = await transacciones.ejecutar({ contexto, soloLectura: true }, async (tx) => {
      const opera = await empresaOpera(tx, empresaId);
      if (!opera.ok) return err(opera.error);
      return ok(await tx.series.enCursoVencidas(empresaId, ahora, limite));
    });
    if (!vencidas.ok) return vencidas;

    const series: ResultadoPorSerie[] = [];
    for (const serie of vencidas.valor) {
      series.push({
        puntoDeVentaId: serie.puntoDeVentaId,
        tipo: serie.tipo,
        resultado: await reconciliarSerie(contexto, {
          puntoDeVentaId: serie.puntoDeVentaId,
          tipo: serie.tipo,
        }),
      });
    }
    return ok({ series, hayMas: vencidas.valor.length === limite });
  };
}
