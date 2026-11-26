import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  decidirAsignacionDeRol,
  type DestinoDeRol,
  type ErrorDeAsignacionDeRol,
} from "../dominio/asignacion-de-rol";
import type { DependenciasDeIdentidad } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { permisoYEmpresaQueOpera } from "./roles-comun";
import { traducirErrores } from "./traducir";

export type EntradaDeAsignarRol = Readonly<{ personaId: PersonaId; destino: DestinoDeRol }>;

export type SalidaDeAsignarRol = Readonly<{
  /** `false`: la persona ya tenía ese rol; no se escribió nada. */
  cambio: boolean;
}>;

export type ErrorAlAsignarRol =
  ErrorDeAsignacionDeRol | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato (red de seguridad: antes decide el dominio). */
const RESTRICCIONES_ADMITIDAS = ["MEMBRESIA_NO_ENCONTRADA"] as const;

/**
 * Asignar un rol a una persona de la empresa del contexto (H4b T4b-2): uno de los dos base (administrador u operador) o un rol propio ACTIVO. Solo el gerente
 * (`usuarios.asignar_rol`); al gerente no se lo toca. En una transacción serializable: guard, la empresa opera, el dominio decide, se escribe con la versión leída y se audita
 * `ROL_ASIGNADO` con el antes y el después. Una persona apagada también se reasigna (sigue apagada: reactivar es solo por invitación). Asignar el rol que ya tiene no escribe ni
 * audita. Rige desde la operación siguiente de esa persona (el conjunto se lee en cada transacción). Asignar a la vez que se archiva el rol: la base los ordena (el que llega
 * segundo relee el estado confirmado y se rechaza con `ROL_ARCHIVADO`).
 */
export function crearAsignarRol({ transacciones, reglas }: DependenciasDeIdentidad) {
  return async function asignarRol(
    contexto: ContextoOperativo,
    entrada: EntradaDeAsignarRol,
  ): Promise<Resultado<SalidaDeAsignarRol, ErrorAlAsignarRol>> {
    const { empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<SalidaDeAsignarRol, ErrorDeAsignacionDeRol | MotivoDeRechazo | EmpresaNoOpera>
      > => {
        const previo = await permisoYEmpresaQueOpera(
          tx,
          contexto,
          reglas,
          DECLARACIONES.asignarRol.accion,
        );
        if (!previo.ok) return previo;
        const objetivo = await tx.membresias.obtener(empresaId, entrada.personaId);
        const rolPropio =
          entrada.destino.tipo === "PROPIO"
            ? await tx.roles.obtener(empresaId, entrada.destino.rolId)
            : null;
        const decision = decidirAsignacionDeRol({
          objetivo,
          destino: entrada.destino,
          rolPropio,
        });
        if (!decision.ok) return decision;
        if (decision.valor === "YA_TENIA_ESE_ROL") return ok({ cambio: false });
        if (objetivo === null) throw new Error("invariante rota: el dominio dejó pasar un nulo");

        const destino =
          entrada.destino.tipo === "BASE"
            ? ({ rol: entrada.destino.rol, rolPropioId: null } as const)
            : ({ rol: "PROPIO", rolPropioId: entrada.destino.rolId } as const);
        if (
          !(await tx.membresias.asignarRol(
            empresaId,
            objetivo.personaId,
            objetivo.version,
            destino,
          ))
        ) {
          return err("MEMBRESIA_NO_ENCONTRADA");
        }
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "ROL_ASIGNADO",
          entidad: "membresia",
          entidadId: objetivo.personaId,
          antes: { rol: objetivo.rol, rolPropioId: objetivo.rolPropioId },
          despues: { rol: destino.rol, rolPropioId: destino.rolPropioId },
        });
        return ok({ cambio: true });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
