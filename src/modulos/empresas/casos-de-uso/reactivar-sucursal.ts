import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { decidirReactivacion, type ErrorDeSucursal } from "../dominio/sucursal";
import { cargarEstadosDeLaEmpresa } from "./comun";
import type { DependenciasDeEmpresas } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

export type EntradaDeReactivarSucursal = Readonly<{ sucursalId: SucursalId }>;

export type SalidaDeReactivarSucursal = Readonly<{
  /** `true`: ya estaba activa; no se escribió nada. */
  yaEstabaActiva: boolean;
}>;

type ErrorPropioAlReactivarSucursal = Extract<ErrorDeSucursal, "SUCURSAL_NO_ENCONTRADA">;

export type ErrorAlReactivarSucursal =
  ErrorPropioAlReactivarSucursal | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/**
 * Reactivar una sucursal de la empresa del contexto (H6, §B.1). Solo el gerente
 * (`sucursales.reactivar`). Contexto OPERATIVO con persona. En una transacción serializable: el
 * guard, la empresa opera, y el dominio decide (`decidirReactivacion`: no existe, ya activa).
 *
 * Vuelve con el mismo nombre que conservó y con sus asignaciones como estaban. La auditoría
 * `SUCURSAL_REACTIVADA` va en la misma transacción. Reactivar dos veces es ok y no escribe ni audita
 * la segunda; dos reactivaciones simultáneas dejan una sola escritura.
 */
export function armarReactivarSucursal({ transacciones, reglas }: DependenciasDeEmpresas) {
  return async function reactivarSucursal(
    contexto: ContextoOperativo,
    entrada: EntradaDeReactivarSucursal,
  ): Promise<Resultado<SalidaDeReactivarSucursal, ErrorAlReactivarSucursal>> {
    const { empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeReactivarSucursal,
          ErrorPropioAlReactivarSucursal | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.reactivarSucursal.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const opera = comprobarQueOpera(empresaId, await cargarEstadosDeLaEmpresa(tx, empresaId));
        if (!opera.ok) return opera;

        const objetivo = await tx.sucursales.obtener(empresaId, entrada.sucursalId);
        const decision = decidirReactivacion(objetivo);
        if (!decision.ok) return decision;
        if (objetivo === null) {
          throw new Error("invariante rota: se decidió reactivar una sucursal nula");
        }
        if (decision.valor === "YA_ACTIVA") return ok({ yaEstabaActiva: true });

        const cambiada = await tx.sucursales.cambiarActiva(
          empresaId,
          objetivo.id,
          objetivo.version,
          true,
        );
        if (cambiada === null) return err("SUCURSAL_NO_ENCONTRADA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "SUCURSAL_REACTIVADA",
          entidad: "sucursal",
          entidadId: objetivo.id,
          antes: { nombre: objetivo.nombre, activa: false },
          despues: { nombre: cambiada.nombre, activa: true },
        });
        return ok({ yaEstabaActiva: false });
      },
    );
  };
}
