import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { DependenciasDeIdentidad } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

export type EntradaDeAsignarSucursales = Readonly<{
  personaId: PersonaId;
  /** El conjunto FINAL de sucursales asignadas, no una lista de cambios. */
  sucursales: readonly SucursalId[];
}>;

export type SalidaDeAsignarSucursales = Readonly<{
  agregadas: readonly SucursalId[];
  reactivadas: readonly SucursalId[];
  quitadas: readonly SucursalId[];
}>;

export type ErrorAlAsignarSucursales = MotivoDeRechazo | "NO_IMPLEMENTADO" | ErrorDePersistencia;

/**
 * PENDIENTE (tramo T3b de H6): por ahora solo pasa por el guard (`asignarSucursales` exige su acción
 * antes de cualquier otra cosa) y devuelve `NO_IMPLEMENTADO` sin leer ni escribir nada. El tramo
 * T3b lo reemplaza por el caso de uso real.
 */
export function crearAsignarSucursales({
  transacciones,
  reglas,
}: DependenciasDeIdentidad): (
  contexto: ContextoOperativo,
  entrada: EntradaDeAsignarSucursales,
) => Promise<Resultado<SalidaDeAsignarSucursales, ErrorAlAsignarSucursales>> {
  // La entrada se ignora hasta que el tramo la use.
  return async function asignarSucursales(contexto) {
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<Resultado<SalidaDeAsignarSucursales, MotivoDeRechazo | "NO_IMPLEMENTADO">> => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.asignarSucursales.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        return err("NO_IMPLEMENTADO");
      },
    );
  };
}
