import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { InvitacionId } from "../../../primitivas/identificadores/marca";
import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { DependenciasDeIdentidad } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

export type EntradaDeRevocarInvitacion = Readonly<{ invitacionId: InvitacionId }>;

export type SalidaDeRevocarInvitacion = Readonly<{
  /** `true`: ya estaba revocada; no se escribió nada. */
  yaEstabaRevocada: boolean;
}>;

export type ErrorAlRevocarInvitacion = MotivoDeRechazo | "NO_IMPLEMENTADO" | ErrorDePersistencia;

/**
 * PENDIENTE (tramo T3a de H6): por ahora solo pasa por el guard (`revocarInvitacion` exige su acción
 * antes de cualquier otra cosa) y devuelve `NO_IMPLEMENTADO` sin leer ni escribir nada. El tramo
 * T3a lo reemplaza por el caso de uso real.
 */
export function crearRevocarInvitacion({
  transacciones,
  reglas,
}: DependenciasDeIdentidad): (
  contexto: ContextoOperativo,
  entrada: EntradaDeRevocarInvitacion,
) => Promise<Resultado<SalidaDeRevocarInvitacion, ErrorAlRevocarInvitacion>> {
  // La entrada se ignora hasta que el tramo la use.
  return async function revocarInvitacion(contexto) {
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<Resultado<SalidaDeRevocarInvitacion, MotivoDeRechazo | "NO_IMPLEMENTADO">> => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.revocarInvitacion.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        return err("NO_IMPLEMENTADO");
      },
    );
  };
}
