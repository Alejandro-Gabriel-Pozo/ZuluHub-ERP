import type { ContextoDePlataforma } from "../../contexto/contexto";
import type { RepositorioDeEmpresas } from "../../modulos/empresas/publico";
import {
  TRABAJO_ENVIAR_INVITACION,
  claveDeEnvioDeInvitacion,
  decidirReenvioDeAlta,
  emailDesdeTexto,
  type Email,
  type ErrorDeReenvioDeAlta,
  type RepositorioDeInvitaciones,
} from "../../modulos/identidad/publico";
import {
  empresaId as aEmpresaId,
  type EmpresaId,
  type InvitacionId,
} from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { AdminsDePlataforma } from "../../puertos/admins-de-plataforma";
import type { Tokens } from "../../puertos/tokens";
import type { Trabajos } from "../../puertos/trabajos";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import {
  MOTIVO_DE_REVOCACION_POR_PLATAFORMA,
  MOTIVO_DE_REVOCACION_POR_REENVIO,
  decidirRevocacionDelAlta,
  type ErrorDeRevocacionDelAlta,
} from "../dominio/alta";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import {
  ejecutarCasoDePlataforma,
  type DependenciasDeCasoDePlataforma,
  type ErrorComunDeCasoDePlataforma,
  type TxDeCasoDePlataforma,
} from "./caso-de-plataforma";

/**
 * Reenviar y revocar la invitación del alta del gerente (H5 §B.5.4). Los dos los pueden hacer ADMIN y
 * SOPORTE (`altas.reenviar_invitacion`, `altas.revocar_invitacion`): son lo que soporte necesita para
 * destrabar a un cliente al que no le llegó el mail. Ninguno toca nada de la empresa fuera de su
 * invitación: la empresa sigue en `PROVISIONING` (la cancela otro caso, o el barrido a las 72 horas).
 */

export const OPERACION_REENVIAR_INVITACION_DEL_ALTA = "altas.reenviar_invitacion";
export const OPERACION_REVOCAR_INVITACION_DEL_ALTA = "altas.revocar_invitacion";

export const DECLARACION_DE_REENVIAR_INVITACION_DEL_ALTA = {
  accion: "altas.reenviar_invitacion",
} as const satisfies DeclaracionDeAccionDePlataforma;

export const DECLARACION_DE_REVOCAR_INVITACION_DEL_ALTA = {
  accion: "altas.revocar_invitacion",
} as const satisfies DeclaracionDeAccionDePlataforma;

// ---- reenviar -----------------------------------------------------------------------------------------

export type TxDeReenvioDelAlta = TxDeCasoDePlataforma &
  Readonly<{
    empresas: RepositorioDeEmpresas;
    invitaciones: RepositorioDeInvitaciones;
    /** Encola el envío de la invitación nueva: el mail lo manda el procesador de la cola, no esta transacción. */
    trabajos: Trabajos;
    admins: AdminsDePlataforma;
  }>;

export type DependenciasDeReenvioDelAlta = DependenciasDeCasoDePlataforma<TxDeReenvioDelAlta> &
  Readonly<{
    /** Emite la invitación nueva (id, token y hash); usa azar, así que se llama FUERA de la transacción. */
    tokens: Pick<Tokens, "emitir">;
  }>;

export type EntradaDeReenviarInvitacionDelAlta = Readonly<{
  /** Identifica el pedido: repetirlo con la misma clave devuelve lo mismo SIN mandar otro mail. */
  claveDeIdempotencia: string;
  empresaId: string;
  /** Otro email para el gerente (el dueño corrige uno mal cargado); sin él, se reenvía al mismo. */
  emailNuevo?: string | undefined;
}>;

export type SalidaDeReenviarInvitacionDelAlta = Readonly<{
  empresaId: EmpresaId;
  /** La invitación vigente: la nueva, o la que ya había reemplazado a la última. */
  invitacionId: InvitacionId;
  /** `true`: no se escribió nada porque ya estaba reenviada (o se repitió la clave). */
  yaEstabaReenviada: boolean;
}>;

export type ErrorAlReenviarInvitacionDelAlta =
  | ErrorComunDeCasoDePlataforma
  | ErrorDeReenvioDeAlta
  | ErrorDeRevocacionDelAlta
  | "ID_INVALIDO"
  | "EMPRESA_NO_ENCONTRADA"
  | "VERSION_DESACTUALIZADA";

type ReenvioValidado = Readonly<{ empresa: EmpresaId; email: Email | null }>;

/**
 * Reenviar la invitación del alta (H5 §B.5.4). La última invitación del alta se revoca (si seguía pendiente,
 * vigente o vencida) ANTES de crear la nueva, que ocupa su lugar en el índice de «una sola pendiente por
 * alta»; la nueva lleva otro id y otro token, el plazo completo (24 h) y, si se pide, otro email (no el de
 * un administrador de plataforma). Una última revocada sin reemplazo también se reenvía: es la salida de
 * «revocar sin reenviar». Todo o nada; repetir la clave devuelve la invitación que ya se creó.
 */
export function armarReenviarInvitacionDelAlta(dependencias: DependenciasDeReenvioDelAlta) {
  const { tokens } = dependencias;
  return async function reenviarInvitacionDelAlta(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeReenviarInvitacionDelAlta,
  ): Promise<Resultado<SalidaDeReenviarInvitacionDelAlta, ErrorAlReenviarInvitacionDelAlta>> {
    // Azar FUERA de la transacción: un reintento serializable la repite entera con la misma invitación.
    const emitida = tokens.emitir();
    return ejecutarCasoDePlataforma<
      TxDeReenvioDelAlta,
      SalidaDeReenviarInvitacionDelAlta,
      ReenvioValidado,
      Exclude<ErrorAlReenviarInvitacionDelAlta, ErrorComunDeCasoDePlataforma>
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_REENVIAR_INVITACION_DEL_ALTA.accion,
      operacion: OPERACION_REENVIAR_INVITACION_DEL_ALTA,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => {
        const id = uuidDesdeTexto(entrada.empresaId);
        if (!id.ok) return id;
        const email = entrada.emailNuevo === undefined ? null : emailDesdeTexto(entrada.emailNuevo);
        if (email !== null && !email.ok) return email;
        return ok({
          entrada: { empresaId: id.valor, emailNuevo: email === null ? null : email.valor },
          valor: { empresa: aEmpresaId(id.valor), email: email === null ? null : email.valor },
        });
      },
      trabajar: async (tx, { empresa: id, email }) => {
        const empresa = await tx.empresas.obtener(id);
        if (empresa === null) return err("EMPRESA_NO_ENCONTRADA");
        const ultima = await tx.invitaciones.obtenerAltaVigente(id);
        if (ultima === null) return err("ALTA_SIN_INVITACION");

        const decision = decidirReenvioDeAlta(empresa, ultima, contexto.ahora, {
          id: emitida.invitacionId,
          tokenHash: emitida.tokenHash,
          email,
          emailEsDeAdminDePlataforma: await tx.admins.esEmailDeAdminActivo(email ?? ultima.email),
        });
        if (!decision.ok) return decision;
        if (decision.valor.tipo === "YA_REENVIADA") {
          return ok({
            salida: { empresaId: id, invitacionId: decision.valor.nueva, yaEstabaReenviada: true },
            constancias: [],
          });
        }

        const { nueva, revocar } = decision.valor;
        // La anterior se revoca antes de crear la nueva: sigue ocupando el índice de una pendiente por alta.
        if (revocar !== null) {
          const revocada = await tx.invitaciones.revocar(
            revocar,
            ultima.version,
            contexto.ahora,
            MOTIVO_DE_REVOCACION_POR_REENVIO,
          );
          if (!revocada) return err("VERSION_DESACTUALIZADA");
        }
        await tx.invitaciones.crear(nueva);
        await tx.invitaciones.vincularReemplazo(ultima.id, nueva.id);
        await tx.trabajos.encolar({
          empresaId: id,
          tipo: TRABAJO_ENVIAR_INVITACION,
          datos: { invitacionId: nueva.id },
          claveDeIdempotencia: claveDeEnvioDeInvitacion(nueva.id),
        });
        return ok({
          salida: { empresaId: id, invitacionId: nueva.id, yaEstabaReenviada: false },
          constancias: [
            {
              accion: "ALTA_INVITACION_REENVIADA",
              entidad: "invitacion",
              entidadId: nueva.id,
              antes: { invitacionId: ultima.id, estado: ultima.estado, email: ultima.email },
              despues: {
                empresaId: id,
                invitacionId: nueva.id,
                estado: "PENDIENTE",
                email: nueva.email,
                venceEn: nueva.venceEn.toISOString(),
              },
            },
          ],
        });
      },
      comoRepeticion: (guardado) => ({ ...guardado, yaEstabaReenviada: true }),
    });
  };
}

// ---- revocar ------------------------------------------------------------------------------------------

export type TxDeRevocacionDelAlta = TxDeCasoDePlataforma &
  Readonly<{
    empresas: RepositorioDeEmpresas;
    invitaciones: RepositorioDeInvitaciones;
  }>;

export type EntradaDeRevocarInvitacionDelAlta = Readonly<{
  claveDeIdempotencia: string;
  empresaId: string;
}>;

export type SalidaDeRevocarInvitacionDelAlta = Readonly<{
  empresaId: EmpresaId;
  /** La invitación del alta que quedó revocada. */
  invitacionId: InvitacionId;
  /** `true`: ya estaba revocada (o se repitió la clave); no se escribió nada. */
  yaEstabaRevocada: boolean;
}>;

export type ErrorAlRevocarInvitacionDelAlta =
  | ErrorComunDeCasoDePlataforma
  | ErrorDeRevocacionDelAlta
  | "ID_INVALIDO"
  | "EMPRESA_NO_ENCONTRADA"
  | "VERSION_DESACTUALIZADA";

/**
 * Revocar la invitación del alta SIN reenviarla (H5 §B.5.4): el enlace deja de servir y el mail que no salió
 * no sale. La empresa sigue en `PROVISIONING`; se reenvía la invitación o se cancela el alta. Motivo
 * `REVOCADA_POR_PLATAFORMA`. Revocar lo ya revocado no es un error: devuelve lo mismo sin escribir.
 */
export function armarRevocarInvitacionDelAlta(
  dependencias: DependenciasDeCasoDePlataforma<TxDeRevocacionDelAlta>,
) {
  return async function revocarInvitacionDelAlta(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeRevocarInvitacionDelAlta,
  ): Promise<Resultado<SalidaDeRevocarInvitacionDelAlta, ErrorAlRevocarInvitacionDelAlta>> {
    return ejecutarCasoDePlataforma<
      TxDeRevocacionDelAlta,
      SalidaDeRevocarInvitacionDelAlta,
      EmpresaId,
      Exclude<ErrorAlRevocarInvitacionDelAlta, ErrorComunDeCasoDePlataforma>
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_REVOCAR_INVITACION_DEL_ALTA.accion,
      operacion: OPERACION_REVOCAR_INVITACION_DEL_ALTA,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => {
        const id = uuidDesdeTexto(entrada.empresaId);
        return id.ok ? ok({ entrada: { empresaId: id.valor }, valor: aEmpresaId(id.valor) }) : id;
      },
      trabajar: async (tx, id) => {
        const empresa = await tx.empresas.obtener(id);
        if (empresa === null) return err("EMPRESA_NO_ENCONTRADA");
        const ultima = await tx.invitaciones.obtenerAltaVigente(id);
        const decision = decidirRevocacionDelAlta(empresa, ultima);
        if (!decision.ok) return decision;
        const { invitacion } = decision.valor;
        if (decision.valor.tipo === "YA_REVOCADA") {
          return ok({
            salida: { empresaId: id, invitacionId: invitacion.id, yaEstabaRevocada: true },
            constancias: [],
          });
        }
        const revocada = await tx.invitaciones.revocar(
          invitacion.id,
          invitacion.version,
          contexto.ahora,
          MOTIVO_DE_REVOCACION_POR_PLATAFORMA,
        );
        if (!revocada) return err("VERSION_DESACTUALIZADA");
        return ok({
          salida: { empresaId: id, invitacionId: invitacion.id, yaEstabaRevocada: false },
          constancias: [
            {
              accion: "ALTA_INVITACION_REVOCADA",
              entidad: "invitacion",
              entidadId: invitacion.id,
              antes: { estado: "PENDIENTE", email: invitacion.email },
              despues: {
                empresaId: id,
                estado: "REVOCADA",
                motivo: MOTIVO_DE_REVOCACION_POR_PLATAFORMA,
              },
            },
          ],
        });
      },
      comoRepeticion: (guardado) => ({ ...guardado, yaEstabaRevocada: true }),
    });
  };
}
