import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { DependenciasDeIdentidad } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

export type EntradaDeRechazarTraspaso = Readonly<{ traspasoId: string }>;

export type SalidaDeRechazarTraspaso = Readonly<{ yaEstabaRechazado: boolean }>;

export type ErrorAlRechazarTraspaso = MotivoDeRechazo | "NO_IMPLEMENTADO" | ErrorDePersistencia;

/**
 * PENDIENTE (tramo T4 de H6): por ahora solo pasa por el guard (`rechazarTraspaso` exige su acción
 * antes de cualquier otra cosa) y devuelve `NO_IMPLEMENTADO` sin leer ni escribir nada. El tramo
 * T4 lo reemplaza por el caso de uso real.
 */
export function crearRechazarTraspaso({
  transacciones,
  reglas,
}: DependenciasDeIdentidad): (
  contexto: ContextoOperativo,
  entrada: EntradaDeRechazarTraspaso,
) => Promise<Resultado<SalidaDeRechazarTraspaso, ErrorAlRechazarTraspaso>> {
  // La entrada se ignora hasta que el tramo la use.
  return async function rechazarTraspaso(contexto) {
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<Resultado<SalidaDeRechazarTraspaso, MotivoDeRechazo | "NO_IMPLEMENTADO">> => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.rechazarTraspaso.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        return err("NO_IMPLEMENTADO");
      },
    );
  };
}
