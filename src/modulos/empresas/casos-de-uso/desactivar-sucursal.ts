import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { decidirDesactivacion, type ErrorDeSucursal } from "../dominio/sucursal";
import { cargarEstadosDeLaEmpresa } from "./comun";
import type { DependenciasDeEmpresas } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

export type EntradaDeDesactivarSucursal = Readonly<{ sucursalId: SucursalId }>;

export type SalidaDeDesactivarSucursal = Readonly<{
  /** `true`: ya estaba inactiva; no se escribió nada. */
  yaEstabaInactiva: boolean;
}>;

type ErrorPropioAlDesactivarSucursal = Extract<
  ErrorDeSucursal,
  "SUCURSAL_NO_ENCONTRADA" | "ULTIMA_SUCURSAL_ACTIVA"
>;

export type ErrorAlDesactivarSucursal =
  ErrorPropioAlDesactivarSucursal | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/**
 * Desactivar una sucursal de la empresa del contexto (H6, §B.1). Solo el gerente
 * (`sucursales.desactivar`). Contexto OPERATIVO con persona. En una transacción serializable: el
 * guard, la empresa opera, y el dominio decide (`decidirDesactivacion`: no existe, ya inactiva, es
 * la última activa).
 *
 * Nada se borra: la sucursal queda `activa = false` y conserva su nombre; sus asignaciones no se
 * tocan (la asignación efectiva es "asignación activa y sucursal activa"), así que al reactivarla la
 * gente vuelve como estaba. La auditoría `SUCURSAL_DESACTIVADA` va en la misma transacción. Desactivar
 * dos veces es ok y no escribe ni audita la segunda.
 *
 * Las dos últimas activas desactivadas a la vez: ambas transacciones leen a las dos y escriben filas
 * distintas (sesgo de escritura); la serializable aborta una y su reintento ve a la otra ya
 * inactiva, así que devuelve `ULTIMA_SUCURSAL_ACTIVA`.
 */
export function armarDesactivarSucursal({ transacciones, reglas }: DependenciasDeEmpresas) {
  return async function desactivarSucursal(
    contexto: ContextoOperativo,
    entrada: EntradaDeDesactivarSucursal,
  ): Promise<Resultado<SalidaDeDesactivarSucursal, ErrorAlDesactivarSucursal>> {
    const { empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeDesactivarSucursal,
          ErrorPropioAlDesactivarSucursal | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.desactivarSucursal.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const opera = comprobarQueOpera(empresaId, await cargarEstadosDeLaEmpresa(tx, empresaId));
        if (!opera.ok) return opera;

        const objetivo = await tx.sucursales.obtener(empresaId, entrada.sucursalId);
        const activas = await tx.sucursales.listarActivas(empresaId);
        const decision = decidirDesactivacion(objetivo, activas);
        if (!decision.ok) return decision;
        if (objetivo === null) {
          throw new Error("invariante rota: se decidió desactivar una sucursal nula");
        }
        if (decision.valor === "YA_INACTIVA") return ok({ yaEstabaInactiva: true });

        const cambiada = await tx.sucursales.cambiarActiva(
          empresaId,
          objetivo.id,
          objetivo.version,
          false,
        );
        if (cambiada === null) return err("SUCURSAL_NO_ENCONTRADA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "SUCURSAL_DESACTIVADA",
          entidad: "sucursal",
          entidadId: objetivo.id,
          antes: { nombre: objetivo.nombre, activa: true },
          despues: { nombre: cambiada.nombre, activa: false },
        });
        return ok({ yaEstabaInactiva: false });
      },
    );
  };
}
