import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import type { InvitacionId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ErrorDeInvitacion } from "../dominio/errores";
import { decidirReenvio } from "../dominio/invitacion";
import { cargarEmpresas } from "./comun";
import {
  TRABAJO_ENVIAR_INVITACION,
  claveDeEnvioDeInvitacion,
  type DependenciasDeIdentidad,
} from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeReenviarInvitacion = Readonly<{ invitacionId: InvitacionId }>;

export type SalidaDeReenviarInvitacion = Readonly<{
  /** La invitación vigente: la nueva, o la que ya había reemplazado a la de origen. */
  invitacionId: InvitacionId;
  /** `true`: la de origen ya había sido reemplazada; se devuelve esa y no se escribe nada. */
  yaEstabaReenviada: boolean;
}>;

export type ErrorAlReenviarInvitacion =
  ErrorDeInvitacion | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso. */
const RESTRICCIONES_ADMITIDAS = ["INVITACION_NO_PENDIENTE"] as const;

/**
 * Reenviar una invitación de usuario (diseño §6.3, R4). Contexto OPERATIVO con persona. En una
 * transacción serializable: el guard (`usuarios.reenviar_invitacion`), la empresa opera, la invitación incluye a la empresa,
 * y entonces el dominio decide (`decidirReenvio`):
 *
 *  - la de origen ya fue reemplazada → se devuelve la reemplazante (`yaEstabaReenviada: true`);
 *  - si no, la de origen pasa a `REVOCADA`, nace otra con OTRO id y OTRO token (plazo completo), se
 *    anota `reemplazada_por`, se encola el envío de la nueva y se audita.
 *
 * La de origen se revoca antes de crear la nueva: sigue ocupando el índice de "una pendiente por
 * empresa y email". `emitir()` se llama fuera de la transacción (reintento con el mismo id).
 *
 * Límite conocido: el contexto operativo ve de una invitación solo la parte de SU empresa. La nueva
 * invitación cubre solo esa empresa; en H3 las invitaciones nacen de a una empresa (`invitarUsuario`).
 */
export function crearReenviarInvitacion({
  transacciones,
  tokens,
  reglas,
}: DependenciasDeIdentidad) {
  return async function reenviarInvitacion(
    contexto: ContextoOperativo,
    entrada: EntradaDeReenviarInvitacion,
  ): Promise<Resultado<SalidaDeReenviarInvitacion, ErrorAlReenviarInvitacion>> {
    const emitido = tokens.emitir();
    const { ahora, empresaId } = contexto;

    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<SalidaDeReenviarInvitacion, ErrorDeInvitacion | MotivoDeRechazo | EmpresaNoOpera>
      > => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.reenviarInvitacion.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const { estados } = await cargarEmpresas(tx, [empresaId]);
        const opera = comprobarQueOpera(empresaId, estados);
        if (!opera.ok) return opera;

        // Si la invitación no incluye a la empresa del contexto, la política de lectura no la deja ver.
        const origen = await tx.invitaciones.obtenerPorId(entrada.invitacionId);
        if (origen === null) return err("INVITACION_NO_ENCONTRADA");

        const decision = decidirReenvio(origen, ahora, {
          id: emitido.invitacionId,
          tokenHash: emitido.tokenHash,
          emitidaPor: contexto.personaId,
        });
        if (!decision.ok) return decision;
        if (decision.valor.tipo === "YA_REENVIADA") {
          return ok({ invitacionId: decision.valor.nueva, yaEstabaReenviada: true });
        }

        const { nueva } = decision.valor;
        if (!(await tx.invitaciones.revocar(origen.id, origen.version, ahora, "REENVIADA"))) {
          return err("INVITACION_NO_PENDIENTE");
        }
        await tx.invitaciones.crear(nueva);
        await tx.invitaciones.vincularReemplazo(origen.id, nueva.id);
        await tx.trabajos.encolar({
          empresaId,
          tipo: TRABAJO_ENVIAR_INVITACION,
          datos: { invitacionId: nueva.id },
          claveDeIdempotencia: claveDeEnvioDeInvitacion(nueva.id),
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "INVITACION_REENVIADA",
          entidad: "invitacion",
          entidadId: nueva.id,
          antes: { invitacionId: origen.id, estado: "PENDIENTE" },
          despues: {
            estado: "PENDIENTE",
            email: nueva.email,
            venceEn: nueva.venceEn.toISOString(),
            reemplazaA: origen.id,
          },
        });
        return ok({ invitacionId: nueva.id, yaEstabaReenviada: false });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
