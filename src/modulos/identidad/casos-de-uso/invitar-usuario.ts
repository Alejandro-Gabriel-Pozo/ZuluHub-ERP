import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { InvitacionId, SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { emailDesdeTexto } from "../dominio/email";
import type { EmpresaNoOpera, ErrorDeInvitacion } from "../dominio/errores";
import {
  decidirInvitacionDeUsuario,
  nuevaInvitacion,
  type RolDeEmpresa,
} from "../dominio/invitacion";
import { cargarEmpresas, comprobarQueOpera, exigirAccion } from "./comun";
import {
  TRABAJO_ENVIAR_INVITACION,
  claveDeEnvioDeInvitacion,
  type DependenciasDeIdentidad,
} from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeInvitarUsuario = Readonly<{
  email: string;
  rol: RolDeEmpresa;
  sucursales: readonly SucursalId[];
}>;

export type SalidaDeInvitarUsuario = Readonly<{
  invitacionId: InvitacionId;
  /** `true`: ya había una invitación pendiente y vigente para ese email; se devuelve esa. */
  yaExistia: boolean;
}>;

export type ErrorAlInvitarUsuario =
  | ErrorDeInvitacion
  | MotivoDeRechazo
  | EmpresaNoOpera
  | "SUCURSAL_NO_ES_DE_LA_EMPRESA"
  | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso. */
const RESTRICCIONES_ADMITIDAS = [
  "SUCURSAL_NO_ES_DE_LA_EMPRESA",
  "ROL_NO_INVITABLE",
  "EMPRESA_REPETIDA",
  "EMAIL_INVALIDO",
] as const;

/**
 * Invitar a un usuario a la empresa del contexto (diseño §6.3). Contexto OPERATIVO con persona. En
 * una transacción serializable: el guard (la acción `usuarios.invitar` la puede el rol del actor,
 * leído en la misma transacción), la empresa opera, y entonces
 *
 *  - ya es miembro activo → `YA_ES_MIEMBRO`;
 *  - ya hay una pendiente vigente para ese email → se devuelve esa (`yaExistia: true`), sin escribir;
 *  - hay una pendiente VENCIDA → se revoca (queda `reemplazada_por`) y nace otra;
 *  - si no, nace la invitación (7 días) con sus empresas y sucursales, el trabajo `enviar_invitacion`
 *    (datos `{invitacionId}`, sin el token) y la auditoría.
 *
 * `emitir()` usa azar: se llama FUERA de la transacción, así un reintento serializable reutiliza el
 * mismo id y el mismo token.
 */
export function crearInvitarUsuario({ transacciones, tokens, reglas }: DependenciasDeIdentidad) {
  return async function invitarUsuario(
    contexto: ContextoOperativo,
    entrada: EntradaDeInvitarUsuario,
  ): Promise<Resultado<SalidaDeInvitarUsuario, ErrorAlInvitarUsuario>> {
    const email = emailDesdeTexto(entrada.email);
    if (!email.ok) return err(email.error);
    const emitido = tokens.emitir();
    const { ahora, empresaId } = contexto;
    // Sin repetidas: la clave de `invitacion_sucursal` las rechazaría como error de la base.
    const sucursales = [...new Set(entrada.sucursales)];

    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<SalidaDeInvitarUsuario, ErrorDeInvitacion | MotivoDeRechazo | EmpresaNoOpera>
      > => {
        const permiso = await exigirAccion(
          tx,
          contexto,
          reglas,
          DECLARACIONES.invitarUsuario.accion,
        );
        if (!permiso.ok) return permiso;
        const { empresas, estados } = await cargarEmpresas(tx, [empresaId]);
        const opera = comprobarQueOpera(empresaId, estados);
        if (!opera.ok) return opera;
        const empresa = empresas.get(empresaId);
        if (empresa === undefined) throw new Error(`falta la empresa ${empresaId}`);

        const nueva = nuevaInvitacion(
          {
            id: emitido.invitacionId,
            tokenHash: emitido.tokenHash,
            tenantId: empresa.tenantId,
            tipo: "USUARIO",
            email: email.valor,
            empresas: [{ empresaId, rol: entrada.rol, sucursales }],
            emitidaPor: contexto.personaId,
          },
          ahora,
        );
        if (!nueva.ok) return nueva;

        // El contexto operativo solo ve a las personas de su empresa: quien no es miembro no aparece.
        const persona = await tx.personas.buscarPorEmail(email.valor);
        const membresia =
          persona === null ? null : await tx.membresias.obtener(empresaId, persona.id);
        const [pendiente = null] = await tx.invitaciones.pendientesDeEmail(empresaId, email.valor);

        const decision = decidirInvitacionDeUsuario({
          ahora,
          esMiembroActivo: membresia?.activo === true,
          pendiente,
        });
        if (!decision.ok) return decision;
        if (decision.valor.tipo === "YA_EXISTE") {
          return ok({ invitacionId: decision.valor.invitacion, yaExistia: true });
        }

        // La vencida se revoca ANTES de crear la nueva: sigue ocupando el índice de "una pendiente
        // por empresa y email".
        if (decision.valor.tipo === "REEMPLAZAR_VENCIDA" && pendiente !== null) {
          const revocada = await tx.invitaciones.revocar(
            pendiente.id,
            pendiente.version,
            ahora,
            "VENCIDA: reemplazada por una invitación nueva",
          );
          if (!revocada) return err("INVITACION_NO_PENDIENTE");
        }
        await tx.invitaciones.crear(nueva.valor);
        if (decision.valor.tipo === "REEMPLAZAR_VENCIDA") {
          await tx.invitaciones.vincularReemplazo(decision.valor.vencida, nueva.valor.id);
        }
        await tx.trabajos.encolar({
          empresaId,
          tipo: TRABAJO_ENVIAR_INVITACION,
          datos: { invitacionId: nueva.valor.id },
          claveDeIdempotencia: claveDeEnvioDeInvitacion(nueva.valor.id),
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "INVITACION_EMITIDA",
          entidad: "invitacion",
          entidadId: nueva.valor.id,
          despues: {
            email: email.valor,
            rol: entrada.rol,
            sucursales,
            venceEn: nueva.valor.venceEn.toISOString(),
            reemplazaA:
              decision.valor.tipo === "REEMPLAZAR_VENCIDA" ? decision.valor.vencida : null,
          },
        });
        return ok({ invitacionId: nueva.valor.id, yaExistia: false });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
