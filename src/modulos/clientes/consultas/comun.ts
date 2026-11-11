import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type {
  DependenciasDeConsultasDeClientes,
  TxDeConsultasDeClientes,
} from "../casos-de-uso/contrato";
import type { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type RDeConsulta<S> = Resultado<
  S,
  MotivoDeRechazo | ErrorDePersistencia | "CURSOR_INVALIDO"
>;

type AccionDeConsulta =
  (typeof DECLARACIONES_DE_CONSULTAS)[keyof typeof DECLARACIONES_DE_CONSULTAS]["accion"];

/**
 * Arma el `leer` de las consultas del directorio: una transacción de solo lectura (`read committed`) que pide la acción al guard dentro de ella. Todos los
 * archivos de consultas lo reciben y lo usan.
 */
export function crearLector(d: DependenciasDeConsultasDeClientes) {
  return <S>(
    contexto: ContextoOperativo,
    accion: AccionDeConsulta,
    trabajo: (tx: TxDeConsultasDeClientes) => Promise<S>,
  ): Promise<RDeConsulta<S>> =>
    d.transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<RDeConsulta<S>> => {
        const permiso = await exigirAccion(d.reglas, accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        return ok(await trabajo(tx));
      },
    );
}

export type Lector = ReturnType<typeof crearLector>;
