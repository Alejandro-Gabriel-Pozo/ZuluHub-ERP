import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { PlantillaDeOrigen } from "../persistencia/repositorios";
import type { DependenciasDeConsultasDeIdentidad } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/** Un rol propio tal como lo ve la pantalla de roles (T6): objeto plano, sin texto de marca. */
export type RolParaLaLista = Readonly<{
  rolId: string;
  nombre: string;
  plantillaOrigen: PlantillaDeOrigen | null;
  /** `false`: archivado (no se asigna ni otorga acciones). */
  activo: boolean;
  /** Cuántas personas ACTIVAS lo tienen (archivar exige que sea 0). */
  personasActivas: number;
  /** La `version` de la fila (control optimista de la edición). */
  version: number;
  /** El número de la versión de acciones vigente. */
  numeroDeVersion: number;
  /** Las acciones de la versión vigente, ordenadas. */
  acciones: readonly string[];
}>;

export type ErrorAlListarRoles = MotivoDeRechazo | ErrorDePersistencia;

/**
 * Los roles propios de la empresa del contexto, activos y archivados (H4b T4), ordenados por nombre. Solo el gerente (`roles.ver`). Una transacción de solo lectura, sin exigir que la
 * empresa opere (una empresa suspendida sigue viendo sus roles). Devuelve una sola empresa: la RLS y el filtro por empresa lo garantizan.
 */
export function armarListarRoles({ transacciones, reglas }: DependenciasDeConsultasDeIdentidad) {
  return async function listarRoles(
    contexto: ContextoOperativo,
  ): Promise<Resultado<readonly RolParaLaLista[], ErrorAlListarRoles>> {
    const { empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<readonly RolParaLaLista[], MotivoDeRechazo>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.listarRoles.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const roles = await tx.roles.listar(empresaId);
        return ok(
          roles.map((r) => ({
            rolId: r.id,
            nombre: r.nombre,
            plantillaOrigen: r.plantillaOrigen,
            activo: r.activo,
            personasActivas: r.personasActivas,
            version: r.version,
            numeroDeVersion: r.numeroDeVersion,
            acciones: [...r.acciones].sort(),
          })),
        );
      },
    );
  };
}
