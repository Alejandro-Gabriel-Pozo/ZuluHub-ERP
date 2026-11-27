import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { RolDeLaMembresia } from "../../../capacidades/permisos/roles";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { DependenciasDeConsultasDeIdentidad } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { comparar } from "./orden";

/** Un miembro tal como lo ve la pantalla «Usuarios» (ADR-005): objeto plano, sin texto de marca. */
export type MiembroDeLista = Readonly<{
  personaId: PersonaId;
  /** Hasta que la autenticación aporte el nombre, la lista muestra el email (D9). */
  email: string;
  rol: RolDeLaMembresia;
  /** El nombre del rol propio cuando `rol` es `PROPIO` (lo escribe el gerente); `null` con un rol base. */
  rolPropioNombre: string | null;
  /** El id del rol propio cuando `rol` es `PROPIO` (la ficha lo usa para preseleccionar el rol al reasignar); `null` con un rol base. */
  rolPropioId: string | null;
  /** `false`: la membresía está apagada (la persona sigue figurando). */
  activo: boolean;
  /** Las sucursales de la asignación efectiva: asignación activa Y sucursal activa. */
  sucursales: readonly SucursalId[];
}>;

export type ErrorAlListarMiembros = MotivoDeRechazo | ErrorDePersistencia;

/**
 * Los miembros de la empresa del contexto, activos o apagados (pantalla «Usuarios», H6 §B.5). Pide
 * `usuarios.ver` al guard dentro de su transacción (`read committed`, solo lectura) y devuelve una
 * sola empresa, ordenada por email y persona. Gerente y administrador ven a todos y todas las
 * sucursales (F1); el operador no tiene `usuarios.ver`. No exige que la empresa opere: una empresa
 * suspendida sigue viendo a su gente (los casos de uso sí lo exigen).
 */
export function armarListarMiembros({ transacciones, reglas }: DependenciasDeConsultasDeIdentidad) {
  return async function listarMiembros(
    contexto: ContextoOperativo,
  ): Promise<Resultado<readonly MiembroDeLista[], ErrorAlListarMiembros>> {
    const { empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<readonly MiembroDeLista[], MotivoDeRechazo>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.listarMiembros.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const miembros = await tx.membresias.listarConEmail(empresaId);
        const nombresDeRoles = new Map(
          (await tx.roles.listar(empresaId)).map((r) => [r.id, r.nombre] as const),
        );
        const asignaciones = await tx.asignaciones.activasDeLaEmpresa(empresaId);
        const activas = new Set((await tx.sucursales.listarActivas(empresaId)).map((s) => s.id));
        return ok(
          miembros
            .map(({ membresia, email }) => ({
              personaId: membresia.personaId,
              email,
              rol: membresia.rol,
              rolPropioId: membresia.rolPropioId,
              rolPropioNombre:
                membresia.rolPropioId === null
                  ? null
                  : (nombresDeRoles.get(membresia.rolPropioId) ?? null),
              activo: membresia.activo,
              sucursales: asignaciones
                .filter((a) => a.personaId === membresia.personaId && activas.has(a.sucursalId))
                .map((a) => a.sucursalId),
            }))
            .sort((a, b) => comparar(a.email, b.email) || comparar(a.personaId, b.personaId)),
        );
      },
    );
  };
}
