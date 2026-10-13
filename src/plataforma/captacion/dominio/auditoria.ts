/**
 * Qué puede llevar la auditoría de las solicitudes (alta por solicitud §2.2 y R-C3). Dominio puro.
 *
 * La auditoría es de solo inserción y NO se anonimiza: todo dato personal que entre ahí sobrevive para
 * siempre a la anonimización de la solicitud. Por eso lleva una lista BLANCA de claves y valores con
 * forma de identificador (sin arroba, sin espacios, sin texto libre). La base repite la misma lista para
 * lo que escribe la landing (`datos_de_auditoria_de_captacion_validos`); una prueba compara ambas.
 */

export const ENTIDAD_DE_AUDITORIA = "solicitud_de_alta";

/** El actor de lo que escribe la landing (no hay administrador: el interesado no tiene cuenta). */
export const ACTOR_DE_AUDITORIA_DE_CAPTACION = "captacion";

/** Las acciones que puede dejar la landing; la base no admite otras para ese actor. */
export const ACCIONES_DE_CAPTACION = [
  "SOLICITUD_RECIBIDA",
  "SOLICITUD_REENVIO",
  "SOLICITUD_VERIFICADA",
] as const;

/** Las que deja la plataforma (administradores y barridos). */
export const ACCIONES_DE_PLATAFORMA = [
  "SOLICITUD_APROBADA",
  "SOLICITUD_RECHAZADA",
  "SOLICITUD_SPAM",
  "SOLICITUD_ALTA_CREADA",
  "SOLICITUD_VENCIDA",
  "SOLICITUD_ANONIMIZADA",
] as const;

export type AccionDeAuditoria =
  (typeof ACCIONES_DE_CAPTACION)[number] | (typeof ACCIONES_DE_PLATAFORMA)[number];

export const CLAVES_DE_AUDITORIA = [
  "estado",
  "motivo",
  "marcaId",
  "rubro",
  "provincia",
  "campania",
  "empresaId",
  "numeroDeEnvio",
  "medicionConsentida",
  "versionDeTerminos",
  "versionDePrivacidad",
  "versionDeAvisoDeMedicion",
  "correoDelGerenteEsElVerificado",
] as const;

export type ClaveDeAuditoria = (typeof CLAVES_DE_AUDITORIA)[number];

export type ValorDeAuditoria = string | number | boolean | null;

export type DatosDeAuditoria = Readonly<Partial<Record<ClaveDeAuditoria, ValorDeAuditoria>>>;

/** Un texto de auditoría es un identificador: letras, dígitos y `. _ ~ : -`, de 1 a 200. Sin arroba. */
const TEXTO_SEGURO = /^[A-Za-z0-9._~:-]{1,200}$/;

export function valorDeAuditoriaSeguro(valor: unknown): boolean {
  if (typeof valor === "string") return TEXTO_SEGURO.test(valor);
  if (typeof valor === "number") return Number.isFinite(valor);
  return typeof valor === "boolean" || valor === null;
}

/**
 * Las claves de `datos` que NO pueden ir a la auditoría: las que no están en la lista blanca o cuyo
 * valor no tiene la forma segura. Vacía = se puede escribir. Mantiene el orden de `datos`.
 */
export function clavesNoPermitidas(datos: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(datos).filter(
    (clave) =>
      !(CLAVES_DE_AUDITORIA as readonly string[]).includes(clave) ||
      !valorDeAuditoriaSeguro(datos[clave]),
  );
}
