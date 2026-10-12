import { exigirAccion } from "../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../capacidades/permisos/guard";
import type { ContextoDeGrupo } from "../contexto/contexto";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../puertos/transacciones";
import type { DependenciasDeConsultasDeGrupo } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS_DE_GRUPO } from "./declaraciones";
import { armarVistaDeGrupo, type VistaDeGrupo } from "./vista-de-grupo";

export type ErrorAlListarEmpresasDelGrupo = MotivoDeRechazo | ErrorDePersistencia;

/** El grupo no tiene módulos activables: el único, `grupo`, es obligatorio y no se guarda por empresa. */
const SIN_MODULOS_ACTIVADOS: readonly string[] = [];

/**
 * Las empresas del grupo del tenant del contexto (pantalla «Vista de grupo», H6 §B.5). Contexto de
 * GRUPO: entra con el rol de base `zuluhub_grupo` (solo lectura), nunca con el de la aplicación. En una
 * sola transacción (`read committed`):
 *
 *  1. el guard (`grupo.ver_empresas`) con el rol leído dentro de la transacción, antes de leer nada;
 *  2. el tenant y sus empresas, ordenadas por razón social e id (las políticas de la base limitan a las
 *     del tenant del contexto, y solo si la persona es propietaria activa);
 *  3. el registro del acceso con `empresa_id` vacío («consultó la lista»), en la misma transacción.
 *
 * Es la excepción declarada a «una consulta no escribe» (ADR-005, R3): la transacción NO es de solo
 * lectura porque inserta ese único registro, y lo hace ANTES de devolver los datos: si la base rechaza
 * el registro (por ejemplo, porque apagaron al propietario a mitad de la consulta) no se entrega nada.
 * Cada llamada deja exactamente un registro; si la transacción se repite por un conflicto, el registro
 * de la que se revierte se revierte con ella. Un rechazo del guard no lee ni registra nada. Si apagan
 * al propietario entre el guard y la lectura del tenant, el resultado es `SIN_PERMISO` y no se registra
 * nada.
 *
 * Con el tenant suspendido devuelve igual la lista y los estados (`estadoEfectivo` lo informa).
 */
export function armarListarEmpresasDelGrupo({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeGrupo) {
  return async function listarEmpresasDelGrupo(
    contexto: ContextoDeGrupo,
  ): Promise<Resultado<VistaDeGrupo, ErrorAlListarEmpresasDelGrupo>> {
    const { tenantId } = contexto;
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed" },
      async (tx): Promise<Resultado<VistaDeGrupo, MotivoDeRechazo>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS_DE_GRUPO.listarEmpresasDelGrupo.accion,
          async () => ({
            ...(await tx.autorizacion.delPropietario(contexto)),
            modulosActivados: SIN_MODULOS_ACTIVADOS,
          }),
        );
        if (!permiso.ok) return permiso;
        const tenant = await tx.tenants.obtener(tenantId);
        // Con el guard aprobado la política de lectura deja ver el tenant propio. Si no lo ve es que
        // apagaron al propietario entre el guard y esta lectura (el tenant no puede faltar: la
        // membresía lo referencia): es lo mismo que no ser propietario, no una falla.
        if (tenant === null) return err("SIN_PERMISO");
        const empresas = await tx.empresas.listarDelTenant(tenantId);
        await tx.accesos.registrar({ empresaId: null });
        return ok(armarVistaDeGrupo(tenant, empresas));
      },
    );
  };
}
