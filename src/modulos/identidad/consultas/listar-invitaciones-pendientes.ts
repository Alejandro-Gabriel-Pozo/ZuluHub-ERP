import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { RolDeEmpresa } from "../../../capacidades/permisos/roles";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type {
  InvitacionId,
  PersonaId,
  SucursalId,
} from "../../../primitivas/identificadores/marca";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { DependenciasDeConsultasDeIdentidad } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { comparar } from "./orden";

/**
 * Una invitación pendiente tal como la ve la pantalla «Usuarios» (ADR-005). Nunca lleva el token ni
 * su hash. Las fechas van en ISO UTC; la pantalla las formatea con la zona de la empresa.
 */
export type InvitacionPendienteDeLaLista = Readonly<{
  invitacionId: InvitacionId;
  email: string;
  rol: RolDeEmpresa;
  /** Las sucursales a las que se invitó (alguna puede haberse desactivado después). */
  sucursales: readonly SucursalId[];
  emitidaEn: string;
  venceEn: string;
  /** `true`: llegó su vencimiento (`ahora >= venceEn`); sigue pendiente hasta que se revoque o reenvíe. */
  vencida: boolean;
  emitidaPor: PersonaId | null;
}>;

export type ErrorAlListarInvitacionesPendientes = MotivoDeRechazo | ErrorDePersistencia;

/**
 * Las invitaciones de usuario pendientes de la empresa del contexto, vigentes y vencidas (pantalla
 * «Usuarios», H6 §B.5). Pide `usuarios.ver` al guard dentro de su transacción (`read committed`,
 * solo lectura) y devuelve una sola empresa, ordenada por email e id. El rol y las sucursales son
 * los de ESTA empresa (una invitación puede incluir varias). No exige que la empresa opere.
 */
export function armarListarInvitacionesPendientes({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeIdentidad) {
  return async function listarInvitacionesPendientes(
    contexto: ContextoOperativo,
  ): Promise<
    Resultado<readonly InvitacionPendienteDeLaLista[], ErrorAlListarInvitacionesPendientes>
  > {
    const { ahora, empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<readonly InvitacionPendienteDeLaLista[], MotivoDeRechazo>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.listarInvitacionesPendientes.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const pendientes = await tx.invitaciones.pendientesDeLaEmpresa(empresaId);
        return ok(
          pendientes
            .map((i) => ({
              invitacionId: i.id,
              email: i.email,
              rol: i.rol,
              sucursales: i.sucursales,
              emitidaEn: i.emitidaEn.toISOString(),
              venceEn: i.venceEn.toISOString(),
              // Misma regla que `estadoDeInvitacion` del dominio (que una consulta no importa):
              // una prueba compara ambas en el instante exacto del vencimiento.
              vencida: ahora.getTime() >= i.venceEn.getTime(),
              emitidaPor: i.emitidaPor,
            }))
            .sort((a, b) => comparar(a.email, b.email) || comparar(a.invitacionId, b.invitacionId)),
        );
      },
    );
  };
}
