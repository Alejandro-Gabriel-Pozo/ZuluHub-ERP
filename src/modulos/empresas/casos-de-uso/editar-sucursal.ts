import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { decidirEdicion, nombreDeSucursalValido, type ErrorDeSucursal } from "../dominio/sucursal";
import { cargarEstadosDeLaEmpresa } from "./comun";
import type { DependenciasDeEmpresas } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeEditarSucursal = Readonly<{
  sucursalId: SucursalId;
  /** La versión que la pantalla tenía al abrir la ficha (control de versión optimista). */
  versionEsperada: number;
  nombre: string;
}>;

export type SalidaDeEditarSucursal = Readonly<{
  /** La versión vigente después de la edición (o la actual, si el nombre ya era ese). */
  version: number;
}>;

type ErrorPropioAlEditarSucursal = Extract<
  ErrorDeSucursal,
  "NOMBRE_DE_SUCURSAL_INVALIDO" | "SUCURSAL_NO_ENCONTRADA" | "VERSION_DESACTUALIZADA"
>;

export type ErrorAlEditarSucursal =
  | ErrorPropioAlEditarSucursal
  | "SUCURSAL_DUPLICADA"
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso. */
const RESTRICCIONES_ADMITIDAS = ["SUCURSAL_DUPLICADA", "NOMBRE_DE_SUCURSAL_INVALIDO"] as const;

/**
 * Cambiar el nombre de una sucursal de la empresa del contexto (H6, §B.1). Contexto OPERATIVO con
 * persona. En una transacción serializable: el guard (`sucursales.editar`), la empresa opera, el
 * nombre es válido y el dominio decide (`decidirEdicion`):
 *
 *  - no existe en esta empresa → `SUCURSAL_NO_ENCONTRADA` (la de otra empresa tampoco se ve);
 *  - ya tiene ese nombre → ok sin escribir ni auditar (repetir una edición ya aplicada es
 *    idempotente, aunque la versión esperada haya quedado vieja);
 *  - la versión esperada no es la vigente → `VERSION_DESACTUALIZADA`;
 *  - si no, `UPDATE` condicionado a la versión y auditoría `SUCURSAL_EDITADA` con el antes y el
 *    después. Otra sucursal con ese nombre (sin distinguir mayúsculas) → `SUCURSAL_DUPLICADA`.
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

        const actual = await tx.sucursales.obtener(empresaId, entrada.sucursalId);
        const decision = decidirEdicion(actual, entrada.versionEsperada, nombre.valor);
        if (!decision.ok) return decision;
        if (actual === null)
          throw new Error("invariante rota: se decidió editar una sucursal nula");
        if (decision.valor === "SIN_CAMBIOS") return ok({ version: actual.version });

        const editada = await tx.sucursales.renombrar(actual.id, actual.version, nombre.valor);
        if (editada === null) return err("VERSION_DESACTUALIZADA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "SUCURSAL_EDITADA",
          entidad: "sucursal",
          entidadId: actual.id,
          antes: { nombre: actual.nombre },
          despues: { nombre: editada.nombre },
        });
        return ok({ version: editada.version });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
