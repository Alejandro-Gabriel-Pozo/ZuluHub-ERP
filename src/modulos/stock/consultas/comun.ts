import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { AlcanceDeSucursales } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type {
  DependenciasDeConsultasDeStock,
  TxDeConsultasDeStock,
} from "../casos-de-uso/contrato";
import type { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type RDeConsulta<S> = Resultado<S, MotivoDeRechazo | ErrorDePersistencia>;

type AccionDeConsulta =
  (typeof DECLARACIONES_DE_CONSULTAS)[keyof typeof DECLARACIONES_DE_CONSULTAS]["accion"];

/**
 * Arma el `leer` de las consultas de stock: una transacción de solo lectura (`read committed`) que pide la acción al guard dentro de ella y le
 * da al trabajo el alcance de sucursales del actor (el operador solo ve las suyas). Todos los archivos de consultas lo reciben y lo usan.
 */
export function crearLector(d: DependenciasDeConsultasDeStock) {
  return <S>(
    contexto: ContextoOperativo,
    accion: AccionDeConsulta,
    trabajo: (tx: TxDeConsultasDeStock, alcance: AlcanceDeSucursales) => Promise<S>,
  ): Promise<RDeConsulta<S>> =>
    d.transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<RDeConsulta<S>> => {
        const permiso = await exigirAccion(d.reglas, accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        return ok(await trabajo(tx, await tx.autorizacion.sucursalesDelActor(contexto)));
      },
    );
}

export type Lector = ReturnType<typeof crearLector>;
