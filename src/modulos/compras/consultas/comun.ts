import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import { exigirAcciones } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type {
  DependenciasDeConsultasDeCompras,
  TxDeConsultasDeCompras,
} from "../casos-de-uso/contrato";

export type RDeConsulta<S> = Resultado<
  S,
  MotivoDeRechazo | ErrorDePersistencia | "CURSOR_INVALIDO" | "IDENTIFICADOR_INVALIDO"
>;

/**
 * Arma el `leer` de las consultas de compras: una transacción de solo lectura (`read committed`) que pide TODAS las acciones al guard dentro de ella (una
 * consulta que muestra costos pide `recepciones.ver` y `costos.ver`). Todos los archivos de consultas lo reciben y lo usan.
 */
export function crearLector(d: DependenciasDeConsultasDeCompras) {
  return <S>(
    contexto: ContextoOperativo,
    acciones: readonly [ClaveAccion, ...ClaveAccion[]],
    trabajo: (tx: TxDeConsultasDeCompras) => Promise<S>,
  ): Promise<RDeConsulta<S>> =>
    d.transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<RDeConsulta<S>> => {
        const permiso = await exigirAcciones(d.reglas, acciones, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        return ok(await trabajo(tx));
      },
    );
}

export type Lector = ReturnType<typeof crearLector>;
