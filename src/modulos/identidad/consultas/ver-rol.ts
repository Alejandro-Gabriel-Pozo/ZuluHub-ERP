import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { DependenciasDeConsultasDeIdentidad } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import type { RolParaLaLista } from "./listar-roles";

export type ErrorAlVerRol = MotivoDeRechazo | ErrorDePersistencia;

/**
 * Un rol propio de la empresa del contexto por su id (H4b T4), o `null` si no hay (o es de otra empresa: la consulta filtra por la empresa del contexto y la RLS también). Solo el gerente
 * (`roles.ver`). Solo lectura.
 */
export function armarVerRol({ transacciones, reglas }: DependenciasDeConsultasDeIdentidad) {
  return async function verRol(
    contexto: ContextoOperativo,
    entrada: Readonly<{ rolId: string }>,
  ): Promise<Resultado<RolParaLaLista | null, ErrorAlVerRol>> {
    const { empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<RolParaLaLista | null, MotivoDeRechazo>> => {
        const permiso = await exigirAccion(reglas, DECLARACIONES_DE_CONSULTAS.verRol.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const rol = await tx.roles.obtener(empresaId, entrada.rolId);
        if (rol === null) return ok(null);
        return ok({
          rolId: rol.id,
          nombre: rol.nombre,
          plantillaOrigen: rol.plantillaOrigen,
          activo: rol.activo,
          personasActivas: await tx.roles.personasActivas(empresaId, rol.id),
          version: rol.version,
          numeroDeVersion: rol.numeroDeVersion,
          acciones: [...rol.acciones].sort(),
        });
      },
    );
  };
}
