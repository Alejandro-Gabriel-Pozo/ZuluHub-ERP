import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import type { InvitacionId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ErrorDeRevocacion } from "../dominio/errores";
import { decidirRevocacion } from "../dominio/invitacion";
import { cargarEmpresas } from "./comun";
import type { DependenciasDeIdentidad } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

export type EntradaDeRevocarInvitacion = Readonly<{ invitacionId: InvitacionId }>;

export type SalidaDeRevocarInvitacion = Readonly<{
  /** `true`: ya estaba revocada; no se escribió nada. */
  yaEstabaRevocada: boolean;
}>;

export type ErrorAlRevocarInvitacion =
  ErrorDeRevocacion | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Motivo que queda guardado en la invitación y en la auditoría. */
const MOTIVO_DE_LA_REVOCACION = "REVOCADA_POR_LA_EMPRESA";

/**
 * Revocar una invitación de usuario pendiente (H6, B.2). Contexto OPERATIVO con persona. En una
 * transacción serializable: el guard (`usuarios.revocar_invitacion`), la empresa opera, y el dominio
 * decide (`decidirRevocacion`: no existe, es el alta del gerente, ya fue aceptada, ya estaba
 * revocada, o se revoca).
 *
 * Se revoca la pendiente vigente o vencida. Si la invitación incluye varias empresas se revoca
 * entera (R4, igual que al apagar). Revocar una ya revocada es ok y no escribe ni audita (la
 * repetición es inocua). Una invitación de otra empresa es indistinguible de una inexistente: la
 * política de lectura no la deja ver.
 *
 * Aceptar y revocar a la vez: las dos actualizan la misma fila condicionada a `PENDIENTE` y a su
 * versión, así que la serializable deja pasar una; la otra se repite, ve el resultado de la
 * ganadora y devuelve `INVITACION_ACEPTADA` (revocar) o `INVITACION_REVOCADA` (aceptar). Nunca
 * quedan las dos.
 */
export function crearRevocarInvitacion({ transacciones, reglas }: DependenciasDeIdentidad) {
  return async function revocarInvitacion(
    contexto: ContextoOperativo,
    entrada: EntradaDeRevocarInvitacion,
  ): Promise<Resultado<SalidaDeRevocarInvitacion, ErrorAlRevocarInvitacion>> {
    const { ahora, empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<SalidaDeRevocarInvitacion, ErrorDeRevocacion | MotivoDeRechazo | EmpresaNoOpera>
      > => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.revocarInvitacion.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const { estados } = await cargarEmpresas(tx, [empresaId]);
        const opera = comprobarQueOpera(empresaId, estados);
        if (!opera.ok) return opera;

        // Si la invitación no incluye a la empresa del contexto, la política de lectura no la deja ver.
        const invitacion = await tx.invitaciones.obtenerPorId(entrada.invitacionId);
        const decision = decidirRevocacion(invitacion);
        if (!decision.ok) return decision;
        if (decision.valor === "YA_REVOCADA" || invitacion === null) {
          return ok({ yaEstabaRevocada: true });
        }

        const revocada = await tx.invitaciones.revocar(
          invitacion.id,
          invitacion.version,
          ahora,
          MOTIVO_DE_LA_REVOCACION,
        );
        if (!revocada) return err("INVITACION_NO_ENCONTRADA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "INVITACION_REVOCADA",
          entidad: "invitacion",
          entidadId: invitacion.id,
          antes: { estado: "PENDIENTE", email: invitacion.email },
          despues: { estado: "REVOCADA", motivo: MOTIVO_DE_LA_REVOCACION },
        });
        return ok({ yaEstabaRevocada: false });
      },
    );
  };
}
