import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { DependenciasDeIdentidad } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

export type EntradaDeProponerTraspaso = Readonly<{ entrantePersonaId: PersonaId }>;

export type SalidaDeProponerTraspaso = Readonly<{ traspasoId: string; yaExistia: boolean }>;

export type ErrorAlProponerTraspaso = MotivoDeRechazo | "NO_IMPLEMENTADO" | ErrorDePersistencia;

/**
 * PENDIENTE (tramo T4 de H6): por ahora solo pasa por el guard (`proponerTraspaso` exige su acción
 * antes de cualquier otra cosa) y devuelve `NO_IMPLEMENTADO` sin leer ni escribir nada. El tramo
 * T4 lo reemplaza por el caso de uso real.
 */
export function crearProponerTraspaso({
  transacciones,
  reglas,
}: DependenciasDeIdentidad): (
  contexto: ContextoOperativo,
  entrada: EntradaDeProponerTraspaso,
) => Promise<Resultado<SalidaDeProponerTraspaso, ErrorAlProponerTraspaso>> {
  // La entrada se ignora hasta que el tramo la use.
  return async function proponerTraspaso(contexto) {
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<Resultado<SalidaDeProponerTraspaso, MotivoDeRechazo | "NO_IMPLEMENTADO">> => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.proponerTraspaso.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        return err("NO_IMPLEMENTADO");
      },
    );
  };
}
