import type { Dato } from "./sin-secretos";

/**
 * Las acciones que la plataforma audita (H5 plataforma, §B.5). Una unión cerrada: una acción nueva se
 * suma acá y en el caso de uso que la registra, y la base no acepta una acción vacía.
 */
export const ACCIONES_DE_PLATAFORMA = [
  "TENANT_ALTA",
  "EMPRESA_ALTA",
  "TENANT_SUSPENDIDO",
  "TENANT_REACTIVADO",
  "EMPRESA_SUSPENDIDA",
  "EMPRESA_REACTIVADA",
  "ALTA_CANCELADA",
  "ALTA_INVITACION_REENVIADA",
  "ALTA_INVITACION_REVOCADA",
  "PERSONA_SUSPENDIDA",
  "PERSONA_REACTIVADA",
  "SOPORTE_EXPLICAR",
  // Gestión de dominios (M4a): una constancia por cada cambio real; lo idempotente no audita.
  "DOMINIO_AGREGADO",
  "DOMINIO_VERIFICADO",
  "DOMINIO_ACTIVADO",
  "DOMINIO_DESACTIVADO",
  "DOMINIO_RETIRADO",
  // Marcas, planes, ajustes y módulos de empresa (M5): una constancia por cada cambio real; lo idempotente no audita.
  "MARCA_CREADA",
  "MARCA_BORRADOR_GUARDADO",
  "MARCA_VERSION_CONFIRMADA",
  "PLAN_CREADO",
  "PLAN_BORRADOR_GUARDADO",
  "PLAN_VERSION_PUBLICADA",
  "PLAN_ASIGNADO",
  "PLAN_MIGRADO_POR_LOTE",
  "PERILLA_AJUSTADA",
  "MODULO_ACTIVADO",
  "MODULO_DESACTIVADO",
  // Un administrador de plataforma nuevo: lo siembra el script del primer administrador con la conexión del dueño.
  "ADMIN_PLATAFORMA_ALTA",
  // El segundo factor de un administrador quedó bloqueado por intentos fallidos (P8a): la deja el sistema, sin
  // códigos ni secretos (solo hasta cuándo y cuántos fallos).
  "SEGUNDO_FACTOR_BLOQUEADO",
  // El dueño dio de baja a un administrador o le reseteó el segundo factor (P8b): los dejan los scripts con la conexión
  // del dueño, con el actor `sistema` y SIN el email ni ningún secreto (solo qué cambió y cuántas sesiones se cerraron).
  "ADMIN_PLATAFORMA_BAJA",
  "SEGUNDO_FACTOR_RESETEADO",
] as const;

export type AccionDePlataforma = (typeof ACCIONES_DE_PLATAFORMA)[number];

/**
 * Lo que un caso de uso de plataforma deja asentado. NO lleva el actor: lo pone el adaptador, desde el
 * contexto firmado de la transacción (el administrador o `sistema`), y la base exige que coincida. No
 * lleva secretos (ni tokens ni hashes): `antes` y `despues` pasan por `exigirSinSecretos`.
 */
export type RegistroDeAuditoriaDePlataforma = Readonly<{
  accion: AccionDePlataforma;
  entidad: string;
  entidadId: string;
  antes?: Readonly<Record<string, Dato>> | null;
  despues?: Readonly<Record<string, Dato>> | null;
}>;

/**
 * Puerto de auditoría de plataforma (solo inserción). Va en la MISMA transacción del cambio que
 * describe: si se revierte el cambio, se revierte el registro, y al revés. Solo existe con un contexto
 * de plataforma; con cualquier otro lanza `RangeError`.
 */
export interface AuditoriaDePlataforma {
  registrar(registro: RegistroDeAuditoriaDePlataforma): Promise<void>;
}
