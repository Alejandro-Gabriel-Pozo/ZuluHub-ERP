import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { DependenciasDeConsultasDeIdentidad } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/** Lo que el gerente puede asignar hoy: los dos roles base y los roles propios ACTIVOS (el archivado no se ofrece). */
export type RolesAsignables = Readonly<{
  base: readonly ("ADMINISTRADOR" | "OPERADOR")[];
  propios: readonly Readonly<{ rolId: string; nombre: string }>[];
}>;

export type ErrorAlListarRolesAsignables = MotivoDeRechazo | ErrorDePersistencia;

/** Los roles que se pueden asignar a una persona de la empresa del contexto (H4b T4b-2). Solo el gerente (`usuarios.asignar_rol`). Solo lectura. */
export function armarRolesAsignables({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeIdentidad) {
  return async function rolesAsignables(
    contexto: ContextoOperativo,
  ): Promise<Resultado<RolesAsignables, ErrorAlListarRolesAsignables>> {
    const { empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<RolesAsignables, MotivoDeRechazo>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.rolesAsignables.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const roles = await tx.roles.listar(empresaId);
        return ok({
          base: ["ADMINISTRADOR", "OPERADOR"],
          propios: roles.filter((r) => r.activo).map((r) => ({ rolId: r.id, nombre: r.nombre })),
        });
      },
    );
  };
}
