import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { decidirArchivadoDeRol, type ErrorDeRolPropio } from "../dominio/rol-propio";
import type { DependenciasDeIdentidad } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { permisoYEmpresaQueOpera } from "./roles-comun";
import { traducirErrores } from "./traducir";

export type EntradaDeArchivarRol = Readonly<{ rolId: string }>;
export type SalidaDeArchivarRol = Readonly<{ yaEstabaArchivado: boolean }>;

type ErrorPropio = ErrorDeRolPropio | "EDICION_DESACTUALIZADA";

export type ErrorAlArchivarRol =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso (red de seguridad: antes decide el dominio; la base repite «sin personas activas»). */
const RESTRICCIONES_ADMITIDAS = ["ROL_CON_PERSONAS"] as const;

/**
 * Archivar un rol propio (H4b T4; un rol no se borra). Solo el gerente (`roles.archivar`). En una transacción serializable: guard, la empresa opera, el rol existe y NINGUNA persona
 * activa lo tiene (primero se las reasigna: `ROL_CON_PERSONAS`; la base lo repite con un disparador que además bloquea la carrera contra una asignación simultánea). Archivado ya: ok sin escribir ni
 * auditar. Escribe `UPDATE ... WHERE version = ...` y audita `ROL_ARCHIVADO` en la misma transacción.
 */
export function crearArchivarRol({ transacciones, reglas }: DependenciasDeIdentidad) {
  return async function archivarRol(
    contexto: ContextoOperativo,
    entrada: EntradaDeArchivarRol,
  ): Promise<Resultado<SalidaDeArchivarRol, ErrorAlArchivarRol>> {
    const { empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<SalidaDeArchivarRol, ErrorPropio | MotivoDeRechazo | EmpresaNoOpera>
      > => {
        const previo = await permisoYEmpresaQueOpera(
          tx,
          contexto,
          reglas,
          DECLARACIONES.archivarRol.accion,
        );
        if (!previo.ok) return previo;
        const rol = await tx.roles.obtener(empresaId, entrada.rolId);
        const decision = decidirArchivadoDeRol(
          rol,
          rol === null ? 0 : await tx.roles.personasActivas(empresaId, rol.id),
        );
        if (!decision.ok) return decision;
        if (decision.valor === "YA_ARCHIVADO") return ok({ yaEstabaArchivado: true });
        if (rol === null) throw new Error("invariante rota: el dominio dejó pasar un rol nulo");

        const escrito = await tx.roles.cambiarActivo(empresaId, rol.id, false, rol.version);
        if (!escrito) return err("EDICION_DESACTUALIZADA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "ROL_ARCHIVADO",
          entidad: "rol_de_empresa",
          entidadId: rol.id,
          antes: { activo: true },
          despues: { activo: false },
        });
        return ok({ yaEstabaArchivado: false });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
