import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  decidirEdicion,
  horaDeCorteValida,
  nombreDeSucursalValido,
  type ErrorDeSucursal,
} from "../dominio/sucursal";
import { cargarEstadosDeLaEmpresa } from "./comun";
import type { DependenciasDeEmpresas } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeEditarSucursal = Readonly<{
  sucursalId: SucursalId;
  /** La versión que la pantalla tenía al abrir la ficha (control de versión optimista). */
  versionEsperada: number;
  nombre: string;
  /**
   * `HH:MM` (de 00:00 a 23:59): desde cuándo rige la jornada de la sucursal (conciliación §3.2).
   * Omitida, no se toca. Cambiarla vale para lo que se registre después: nada pasado se refecha.
   */
  horaDeCorte?: string | undefined;
}>;

export type SalidaDeEditarSucursal = Readonly<{
  /** La versión vigente después de la edición (o la actual, si el nombre ya era ese). */
  version: number;
}>;

type ErrorPropioAlEditarSucursal = Extract<
  ErrorDeSucursal,
  | "NOMBRE_DE_SUCURSAL_INVALIDO"
  | "HORA_DE_CORTE_INVALIDA"
  | "SUCURSAL_NO_ENCONTRADA"
  | "VERSION_DESACTUALIZADA"
>;

export type ErrorAlEditarSucursal =
  | ErrorPropioAlEditarSucursal
  | "SUCURSAL_DUPLICADA"
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso. */
const RESTRICCIONES_ADMITIDAS = [
  "SUCURSAL_DUPLICADA",
  "NOMBRE_DE_SUCURSAL_INVALIDO",
  "HORA_DE_CORTE_INVALIDA",
] as const;

/**
 * Cambiar el nombre y, si se pide, la hora de corte de la jornada de una sucursal de la empresa del
 * contexto (H6, §B.1; caja §B.4). Contexto OPERATIVO con persona. En una transacción serializable: el
 * guard (`sucursales.editar`), la empresa opera, el nombre y la hora de corte son válidos y el dominio
 * decide (`decidirEdicion`):
 *
 *  - no existe en esta empresa → `SUCURSAL_NO_ENCONTRADA` (la de otra empresa tampoco se ve);
 *  - ya tiene ese nombre y esa hora de corte (o no se pidió una) → ok sin escribir ni auditar (repetir
 *    una edición ya aplicada es idempotente, aunque la versión esperada haya quedado vieja);
 *  - la versión esperada no es la vigente → `VERSION_DESACTUALIZADA`;
 *  - si no, `UPDATE` condicionado a la versión y auditoría `SUCURSAL_EDITADA` con el antes y el
 *    después de lo que cambió. Otra sucursal con ese nombre (sin distinguir mayúsculas) →
 *    `SUCURSAL_DUPLICADA`.
 *
 * Dos ediciones simultáneas con la misma versión: gana una; la otra, tras el reintento serializable,
 * ve la versión nueva y da `VERSION_DESACTUALIZADA`.
 */
export function armarEditarSucursal({ transacciones, reglas }: DependenciasDeEmpresas) {
  return async function editarSucursal(
    contexto: ContextoOperativo,
    entrada: EntradaDeEditarSucursal,
  ): Promise<Resultado<SalidaDeEditarSucursal, ErrorAlEditarSucursal>> {
    const { empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeEditarSucursal,
          ErrorPropioAlEditarSucursal | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.editarSucursal.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const opera = comprobarQueOpera(empresaId, await cargarEstadosDeLaEmpresa(tx, empresaId));
        if (!opera.ok) return opera;
        const nombre = nombreDeSucursalValido(entrada.nombre);
        if (!nombre.ok) return nombre;
        const horaDeCorte =
          entrada.horaDeCorte === undefined ? null : horaDeCorteValida(entrada.horaDeCorte);
        if (horaDeCorte !== null && !horaDeCorte.ok) return horaDeCorte;
        const nuevaHora = horaDeCorte === null ? undefined : horaDeCorte.valor;

        const actual = await tx.sucursales.obtener(empresaId, entrada.sucursalId);
        const decision = decidirEdicion(actual, entrada.versionEsperada, nombre.valor, nuevaHora);
        if (!decision.ok) return decision;
        if (actual === null)
          throw new Error("invariante rota: se decidió editar una sucursal nula");
        if (decision.valor === "SIN_CAMBIOS") return ok({ version: actual.version });

        // Solo lo que cambia entra al UPDATE y a la auditoría (el antes y el después de cada campo).
        const cambiaNombre = nombre.valor !== actual.nombre;
        const cambiaHora = nuevaHora !== undefined && nuevaHora !== actual.horaDeCorte;
        const editada = await tx.sucursales.editar(actual.id, actual.version, {
          ...(cambiaNombre ? { nombre: nombre.valor } : {}),
          ...(cambiaHora ? { horaDeCorte: nuevaHora } : {}),
        });
        if (editada === null) return err("VERSION_DESACTUALIZADA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "SUCURSAL_EDITADA",
          entidad: "sucursal",
          entidadId: actual.id,
          antes: {
            ...(cambiaNombre ? { nombre: actual.nombre } : {}),
            ...(cambiaHora ? { horaDeCorte: actual.horaDeCorte } : {}),
          },
          despues: {
            ...(cambiaNombre ? { nombre: editada.nombre } : {}),
            ...(cambiaHora ? { horaDeCorte: editada.horaDeCorte } : {}),
          },
        });
        return ok({ version: editada.version });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
