import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { EntradaDeJornada } from "../comun";
import type { EstadoConsultado } from "../estados";
import { prepararConsulta, type ErrorDeConsulta } from "./comun";
import type { DependenciasDeConsultasDeCierre, TxDeConsultasDeCierre } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type EntradaDeEstadoDeJornada = EntradaDeJornada;

/** El estado de la jornada con las marcas de quién y cuándo (sin datos de otros módulos). */
export type EstadoDeLaJornada = Readonly<{
  estado: EstadoConsultado;
  auditoriaIniciadaEn: Date | null;
  auditoriaIniciadaPor: string | null;
  cerradaEn: Date | null;
  cerradaPor: string | null;
  observacion: string | null;
}>;

export type ErrorAlPedirElEstadoDeJornada = ErrorDeConsulta | ErrorDePersistencia;

/**
 * El estado de una jornada (e3b §3.3). Pide `jornadas.ver` al guard dentro de su transacción (`read committed`, solo lectura) y valida
 * el alcance de sucursal. `SIN_ACTIVIDAD`: nadie registró nada ese día, la jornada todavía no existe.
 */
export function armarEstadoDeJornada<TAportes>({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeCierre<TAportes>) {
  return async function estadoDeJornada(
    contexto: ContextoOperativo,
    entrada: EntradaDeEstadoDeJornada,
  ): Promise<Resultado<EstadoDeLaJornada, ErrorAlPedirElEstadoDeJornada>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx: TxDeConsultasDeCierre): Promise<Resultado<EstadoDeLaJornada, ErrorDeConsulta>> => {
        const previo = await prepararConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.estadoDeJornada.accion,
          entrada,
        );
        if (!previo.ok) return previo;
        const jornada = await tx.jornadas.obtener(previo.valor.clave);
        if (jornada === null) {
          return ok({
            estado: "SIN_ACTIVIDAD",
            auditoriaIniciadaEn: null,
            auditoriaIniciadaPor: null,
            cerradaEn: null,
            cerradaPor: null,
            observacion: null,
          });
        }
        return ok({
          estado: jornada.estado,
          auditoriaIniciadaEn: jornada.auditoriaIniciadaEn,
          auditoriaIniciadaPor: jornada.auditoriaIniciadaPor,
          cerradaEn: jornada.cerradaEn,
          cerradaPor: jornada.cerradaPor,
          observacion: jornada.observacion,
        });
      },
    );
  };
}
