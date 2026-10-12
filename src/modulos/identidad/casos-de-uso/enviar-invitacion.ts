import type { ContextoOperativo } from "../../../contexto/contexto";
import { estadoEfectivo } from "../../../contexto/estados";
import { invitacionId, type EmpresaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ManejadorDeTrabajo, ResultadoDeManejador } from "../../../puertos/cola-de-trabajos";
import type { Correo } from "../../../puertos/correo";
import type { Tokens } from "../../../puertos/tokens";
import type { Transacciones } from "../../../puertos/transacciones";
import {
  armarEnlaceDeInvitacion,
  armarMensajeDeInvitacion,
  decidirEnvioDeInvitacion,
  type MotivoDeOmision,
} from "../dominio/envio";
import { claveDeEnvioDeInvitacion, type TxDeIdentidad } from "./contrato";

/**
 * Efecto del trabajo `enviar_invitacion` (ADR-007), lo que encolan `invitarUsuario` y
 * `reenviarInvitacion` con datos `{ invitacionId }` y la clave `invitacion:<id>:envio`.
 *
 * Corre con el contexto OPERATIVO "de sistema" (sin persona) de la empresa DEL TRABAJO: la base solo
 * deja ver la invitación si pertenece a esa empresa, así que un trabajo que apunta a una invitación
 * ajena no la encuentra y falla sin enviar nada. El rol de trabajos, que toma y marca la cola, no lee
 * invitaciones: eso lo hace este manejador con el rol de la aplicación.
 *
 * Tres pasos, porque el mail es un efecto externo y NO puede ir adentro de una transacción (el
 * contrato de persistencia repite el trabajo completo ante un conflicto serializable):
 *   1. Transacción: lee la invitación y la empresa y decide (`decidirEnvioDeInvitacion`). Si no hay
 *      que enviar (revocada, reemplazada, aceptada, vencida, empresa que no opera) deja constancia en
 *      la auditoría y el trabajo termina `HECHO` sin enviar.
 *   2. Fuera de la transacción: arma el enlace con `tokens.derivar(id)` y envía con la clave de
 *      idempotencia `invitacion:<id>:envio`. Repetir el trabajo no duplica el mail.
 *   3. Transacción: deja constancia del envío en la auditoría.
 *
 * El token y el enlace NUNCA se guardan: ni en `datos`, ni en el error del trabajo, ni en la
 * auditoría, ni en los mensajes de error de este manejador.
 *
 * Límites conocidos:
 *  - Entre el paso 1 y el 2 la invitación puede revocarse: el mail sale igual y el enlace falla al
 *    aceptarse (`INVITACION_REVOCADA`). Es inherente a no enviar dentro de la transacción.
 *  - Si el proceso muere entre el 2 y el cierre del trabajo, se repite: el proveedor no reenvía si
 *    admite la clave (Resend la recuerda 24 horas) y la auditoría puede quedar con dos constancias.
 *  - La auditoría de la aplicación exige una empresa operable (`empresa_operable`): en el alta del
 *    gerente (empresa en `PROVISIONING`) el envío se hace pero no se audita con este rol.
 */
export type TxDeEnvioDeInvitacion = Pick<
  TxDeIdentidad,
  "invitaciones" | "empresas" | "tenants" | "auditoria"
>;

export type DependenciasDeEnvioDeInvitacion = Readonly<{
  transacciones: Transacciones<TxDeEnvioDeInvitacion>;
  tokens: Pick<Tokens, "derivar">;
  correo: Correo;
  /** Origen público de la aplicación, ya validado (`ZULUHUB_URL_BASE`). */
  urlBase: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Preparacion =
  | Readonly<{ tipo: "OMITIDA"; motivo: MotivoDeOmision }>
  | Readonly<{
      tipo: "ENVIAR";
      email: string;
      razonSocial: string;
      /** La auditoría de la aplicación solo admite empresas operables. */
      auditar: boolean;
    }>;

const falloDefinitivo = (error: string): ResultadoDeManejador => ({
  tipo: "ERROR",
  error,
  definitivo: true,
});

const falloReintentable = (error: string): ResultadoDeManejador => ({
  tipo: "ERROR",
  error,
  definitivo: false,
});

export function crearManejadorDeEnviarInvitacion({
  transacciones,
  tokens,
  correo,
  urlBase,
}: DependenciasDeEnvioDeInvitacion): ManejadorDeTrabajo {
  return async (trabajo, ahora) => {
    const idCrudo = trabajo.datos["invitacionId"];
    if (typeof idCrudo !== "string" || !UUID.test(idCrudo)) {
      return falloDefinitivo("los datos del trabajo no traen una invitacionId válida");
    }
    if (trabajo.empresaId === null) {
      return falloDefinitivo("el trabajo no tiene empresa: no se sabe con qué contexto ejecutarlo");
    }
    const id = invitacionId(idCrudo);
    const empresaId: EmpresaId = trabajo.empresaId;
    const contexto: ContextoOperativo = { tipo: "OPERATIVO", empresaId, personaId: null, ahora };

    // 1. Decidir (y, si no se envía, dejar constancia), todo en una transacción.
    const preparacion = await transacciones.ejecutar(
      { contexto },
      async (tx): Promise<Resultado<Preparacion, "NO_ENCONTRADA">> => {
        const invitacion = await tx.invitaciones.obtenerPorId(id);
        if (invitacion === null) return err("NO_ENCONTRADA");
        const empresa = await tx.empresas.obtener(empresaId);
        if (empresa === null)
          throw new Error(`la empresa ${empresaId} no es visible para el contexto`);
        const tenant = await tx.tenants.obtener(empresa.tenantId);
        if (tenant === null) throw new Error(`el tenant de la empresa ${empresaId} no es visible`);

        const auditar = estadoEfectivo(tenant.estado, empresa.estado) === "OPERA";
        const decision = decidirEnvioDeInvitacion(invitacion, {
          ahora,
          empresa: empresa.estado,
          tenant: tenant.estado,
        });
        if (decision.tipo === "OMITIR") {
          if (auditar) {
            await tx.auditoria.registrar({
              empresaId,
              actorPersonaId: null,
              accion: "INVITACION_ENVIO_OMITIDO",
              entidad: "invitacion",
              entidadId: id,
              despues: { motivo: decision.motivo },
            });
          }
          return ok({ tipo: "OMITIDA", motivo: decision.motivo });
        }
        return ok({
          tipo: "ENVIAR",
          email: invitacion.email,
          razonSocial: empresa.razonSocial,
          auditar,
        });
      },
    );
    if (!preparacion.ok) {
      return preparacion.error === "NO_ENCONTRADA"
        ? falloDefinitivo("la invitación no existe para la empresa del trabajo")
        : falloReintentable(`persistencia: ${preparacion.error.tipo}`);
    }
    const decidido = preparacion.valor;
    if (decidido.tipo === "OMITIDA") return { tipo: "HECHO", nota: `OMITIDO: ${decidido.motivo}` };

    // 2. Enviar, fuera de toda transacción, con la clave de idempotencia del envío.
    const enlace = armarEnlaceDeInvitacion(urlBase, tokens.derivar(id));
    const mensaje = armarMensajeDeInvitacion(decidido.razonSocial, enlace);
    const envio = await correo.enviar(
      { para: decidido.email, asunto: mensaje.asunto, texto: mensaje.texto },
      claveDeEnvioDeInvitacion(id),
    );
    if (envio.tipo === "FALLO") {
      return { tipo: "ERROR", error: `correo: ${envio.motivo}`, definitivo: envio.definitivo };
    }

    // 3. Dejar constancia del envío (sin el token ni el enlace).
    if (decidido.auditar) {
      const constancia = await transacciones.ejecutar({ contexto }, async (tx) => {
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: null,
          accion: "INVITACION_ENVIADA",
          entidad: "invitacion",
          entidadId: id,
          despues: { email: decidido.email, proveedor: envio.idDelProveedor },
        });
        return ok(null);
      });
      // El mail ya salió: al reintentar, la clave de idempotencia evita el duplicado.
      if (!constancia.ok) {
        return falloReintentable(
          `el mail salió pero no se pudo auditar (${constancia.error.tipo})`,
        );
      }
    }
    return { tipo: "HECHO" };
  };
}
