import {
  estadoEfectivo,
  type EstadoDeEmpresa,
  type EstadoDeTenant,
} from "../../../contexto/estados";
import { estadoDeInvitacion, type Invitacion } from "./invitacion";

/**
 * Envío del mail de una invitación (ADR-007). Dominio puro: sin reloj ni aleatoriedad. El trabajo
 * `enviar_invitacion` puede ejecutarse mucho después de encolado: la invitación pudo revocarse,
 * reemplazarse, aceptarse o vencer, o la empresa pudo dejar de operar. Solo se envía si la invitación
 * sigue `PENDIENTE` y vigente.
 */
export type MotivoDeOmision =
  "REEMPLAZADA" | "REVOCADA" | "ACEPTADA" | "VENCIDA" | "EMPRESA_NO_OPERA";

export type DecisionDeEnvio =
  Readonly<{ tipo: "ENVIAR" }> | Readonly<{ tipo: "OMITIR"; motivo: MotivoDeOmision }>;

export type DatosDeEnvio = Readonly<{
  ahora: Date;
  empresa: EstadoDeEmpresa;
  tenant: EstadoDeTenant;
}>;

/**
 * Decide si se manda el mail. Gana el primer motivo que aplique: reemplazada por otra (se revocó al
 * reenviar), revocada, aceptada, vencida (`ahora >= venceEn`) y, por último, que la empresa no opere
 * (tenant suspendido, empresa suspendida, cancelada o en baja). El alta del gerente nace con la empresa
 * en `PROVISIONING` y es justamente cuando hay que mandarla: en ese estado se evalúa como si la
 * empresa estuviera `ACTIVE`, igual que al aceptarla; en cualquier otro, como cualquier invitación.
 */
export function decidirEnvioDeInvitacion(
  invitacion: Invitacion,
  { ahora, empresa, tenant }: DatosDeEnvio,
): DecisionDeEnvio {
  if (invitacion.reemplazadaPor !== null) return { tipo: "OMITIR", motivo: "REEMPLAZADA" };
  const estado = estadoDeInvitacion(invitacion, ahora);
  if (estado === "REVOCADA") return { tipo: "OMITIR", motivo: "REVOCADA" };
  if (estado === "ACEPTADA") return { tipo: "OMITIR", motivo: "ACEPTADA" };
  if (estado === "VENCIDA") return { tipo: "OMITIR", motivo: "VENCIDA" };
  const enAlta = invitacion.tipo === "ALTA_GERENTE" && empresa === "PROVISIONING";
  // Stryker disable next-line StringLiteral: `estadoEfectivo` trata cualquier valor que no sea PROVISIONING, SUSPENDED, CANCELLED o DELETING como ACTIVE; el texto vacío es un estado inválido para los tipos que se comporta igual.
  if (estadoEfectivo(tenant, enAlta ? "ACTIVE" : empresa) !== "OPERA") {
    return { tipo: "OMITIR", motivo: "EMPRESA_NO_OPERA" };
  }
  return { tipo: "ENVIAR" };
}

/**
 * El enlace que recibe el invitado: el token derivado, en la ruta de aceptación de la aplicación.
 * `urlBase` es el origen público validado (sin barra final). El token solo vive en el cuerpo del
 * mail: nunca se guarda ni se registra.
 */
export function armarEnlaceDeInvitacion(urlBase: string, token: string): string {
  return `${urlBase.replace(/\/+$/, "")}/invitaciones/${encodeURIComponent(token)}`;
}

export type MensajeDeInvitacion = Readonly<{ asunto: string; texto: string }>;

const BLANCOS = /\s+/g;

/**
 * Asunto y texto del mail. Determinista: dado el mismo enlace y la misma empresa, siempre el mismo
 * mensaje (los proveedores comparan el cuerpo al aplicar la clave de idempotencia).
 */
export function armarMensajeDeInvitacion(razonSocial: string, enlace: string): MensajeDeInvitacion {
  const empresa = razonSocial.replace(BLANCOS, " ").trim();
  return {
    asunto: `Te invitaron a ${empresa} en ZuluHub`,
    texto: [
      "Hola,",
      "",
      `Te invitaron a sumarte a ${empresa} en ZuluHub.`,
      "",
      "Para aceptar la invitación, abrí este enlace e iniciá sesión con este mismo email:",
      enlace,
      "",
      "El enlace es personal: no lo compartas. Si no esperabas esta invitación, ignorá este mensaje.",
      "",
    ].join("\n"),
  };
}
