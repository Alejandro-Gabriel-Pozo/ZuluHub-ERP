import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { accionesDeCaso } from "../../../capacidades/permisos/declaracion";
import { autorizar, traducir } from "./comun";
import type { DependenciasDeClientes } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import type { ErrorDeClientes } from "./errores";
import { editarParteDentro, type EntradaDeEditarParte, type SalidaDeEditarParte } from "./partes";
import { cambiarRolesDentro, type SalidaDeCambiarRolesDeParte } from "./roles-y-vinculos";

type R<S> = Resultado<S, ErrorDeClientes>;

/** Los datos y el conjunto FINAL de roles activos, juntos. */
export type EntradaDeEditarParteConRoles = EntradaDeEditarParte &
  Readonly<{ roles: readonly string[] }>;
export type SalidaDeEditarParteConRoles = Readonly<{
  datos: SalidaDeEditarParte;
  roles: SalidaDeCambiarRolesDeParte;
}>;

/**
 * Editar los datos y los roles de una parte en UNA transacción (todo o nada): la pantalla de edición guarda las dos cosas con un solo botón. Guard `partes.editar` Y
 * `partes.cambiar_roles` (las dos, o no empieza). La parte se bloquea una vez: dos ediciones a la vez se serializan (gana una; la otra ve la versión nueva y falla entera con
 * `VERSION_DESACTUALIZADA`, sin tocar los roles). Si los datos se rechazan (documento ya usado, dato inválido, versión vieja), los roles no cambian; si los roles se rechazan,
 * los datos tampoco. Repetición (`SIN_CAMBIOS`): lo pedido ya es lo guardado (datos y roles) devuelve lo vigente sin escribir ni auditar, aunque la versión esperada sea vieja.
 */
export function armarEditarParteConRoles(dependencias: DependenciasDeClientes) {
  return async function editarParteConRoles(
    contexto: ContextoOperativo,
    entrada: EntradaDeEditarParteConRoles,
  ): Promise<R<SalidaDeEditarParteConRoles>> {
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeEditarParteConRoles>> => {
        const permiso = await autorizar(
          tx,
          contexto,
          dependencias.reglas,
          accionesDeCaso(DECLARACIONES.editarParteConRoles),
        );
        if (!permiso.ok) return permiso;
        const datos = await editarParteDentro(tx, contexto, entrada);
        if (!datos.ok) return err(datos.error);
        const roles = await cambiarRolesDentro(tx, contexto, {
          parteId: entrada.parteId,
          roles: entrada.roles,
        });
        if (!roles.ok) return err(roles.error);
        return ok({ datos: datos.valor, roles: roles.valor });
      },
    );
    return traducir(resultado);
  };
}
