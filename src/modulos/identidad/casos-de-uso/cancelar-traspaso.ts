import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { DependenciasDeIdentidad } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

export type EntradaDeCancelarTraspaso = Readonly<Record<string, never>>;

export type SalidaDeCancelarTraspaso = Readonly<{ yaNoHabia: boolean }>;

export type ErrorAlCancelarTraspaso = MotivoDeRechazo | "NO_IMPLEMENTADO" | ErrorDePersistencia;

/**
 * PENDIENTE (tramo T4 de H6): por ahora solo pasa por el guard (`cancelarTraspaso` exige su acción
 * antes de cualquier otra cosa) y devuelve `NO_IMPLEMENTADO` sin leer ni escribir nada. El tramo
 * T4 lo reemplaza por el caso de uso real.
 */
export function crearCancelarTraspaso({
  transacciones,
  reglas,
}: DependenciasDeIdentidad): (
  contexto: ContextoOperativo,
  entrada: EntradaDeCancelarTraspaso,
) => Promise<Resultado<SalidaDeCancelarTraspaso, ErrorAlCancelarTraspaso>> {
  // La entrada se ignora hasta que el tramo la use.
  return async function cancelarTraspaso(contexto) {
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<Resultado<SalidaDeCancelarTraspaso, MotivoDeRechazo | "NO_IMPLEMENTADO">> => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.cancelarTraspaso.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        return err("NO_IMPLEMENTADO");
      },
    );
  };
}
