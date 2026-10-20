import type { RolDePlataforma } from "../../capacidades/permisos/plataforma";
import { emailDesdeTexto, type Email } from "../../modulos/identidad/publico";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";

/**
 * Identidad de plataforma (H5, especificación §B.2). Dominio puro: sin reloj ni aleatoriedad (la hora
 * entra como dato), sin guard y sin puertos. Un administrador de plataforma es una identidad propia,
 * distinta de `Persona`: no tiene membresías.
 */

/** Duración máxima de una sesión de plataforma, contada desde el inicio de sesión (8 h absolutas). */
export const LIMITE_ABSOLUTO_DE_SESION_EN_MS = 8 * 3_600_000;

/** Tiempo sin usar la sesión a partir del cual se vence (30 min de inactividad). */
export const LIMITE_DE_INACTIVIDAD_EN_MS = 30 * 60_000;

/**
 * Cuánto se tolera que el reloj de otra instancia esté adelantado respecto de `ahora` (un inicio o un
 * último uso apenas "en el futuro"). Más que eso es un dato inconsistente y la sesión no vale.
 */
export const TOLERANCIA_DE_RELOJ_EN_MS = 60_000;

/** Un `transcurrido` válido: no más en el futuro que la tolerancia, y estrictamente menor que el límite. */
function dentroDelLimite(transcurridoEnMs: number, limiteEnMs: number): boolean {
  return transcurridoEnMs >= -TOLERANCIA_DE_RELOJ_EN_MS && transcurridoEnMs < limiteEnMs;
}

/**
 * ¿La sesión de plataforma sigue vigente? Vale mientras no pasaron 8 h desde `inicio` y no pasaron 30
 * min desde `ultimoUso`; en el instante exacto de cada límite ya venció. La impone el adaptador de
 * autenticación en cada pedido; el criterio vive acá para probarlo con mutación. Falla cerrado: una
 * fecha inválida, o muy en el futuro, no vale.
 */
export function sesionVigente(inicio: Date, ultimoUso: Date, ahora: Date): boolean {
  return (
    dentroDelLimite(ahora.getTime() - inicio.getTime(), LIMITE_ABSOLUTO_DE_SESION_EN_MS) &&
    dentroDelLimite(ahora.getTime() - ultimoUso.getTime(), LIMITE_DE_INACTIVIDAD_EN_MS)
  );
}

/** Lo que la base guarda de un administrador y el guard necesita para decidir. */
export type DatosDeAdminParaElGuard = Readonly<{ rol: RolDePlataforma; activo: boolean }>;

/**
 * El rol con el que el guard decide: el del administrador si está activo; `null` si no existe o fue
 * dado de baja (el guard devuelve entonces `SIN_PERMISO`, nunca otro motivo). Se lee dentro de la
 * transacción de cada caso de uso: bajar a un administrador corta en la operación siguiente.
 */
export function rolVigenteDeAdmin(admin: DatosDeAdminParaElGuard | null): RolDePlataforma | null {
  return admin !== null && admin.activo ? admin.rol : null;
}

export type ErrorDeAltaDeAdmin =
  "EMAIL_INVALIDO" | "ADMIN_CON_MEMBRESIA" | "ADMIN_CON_INVITACION_PENDIENTE";

/** Lo que el script de alta de administradores averigua en la base antes de decidir. */
export type HechosParaAltaDeAdmin = Readonly<{
  /** La persona con ese email tiene alguna membresía, activa o apagada, de cualquier rol (F5). */
  tieneMembresia: boolean;
  /** Hay alguna invitación guardada como `PENDIENTE` para ese email, de cualquier tipo (vencida o no). */
  tieneInvitacionPendiente: boolean;
}>;

export type AdminNuevo = Readonly<{ email: Email; rol: RolDePlataforma }>;

/**
 * Decide si un email puede ser administrador de plataforma. Invariante (decisión F5 del dueño): un
 * administrador de plataforma NO puede tener ninguna membresía de empresa, ni siquiera apagada, ni una
 * invitación pendiente que se la daría al aceptarla. Orden: email inválido, membresía, invitación.
 * El email se normaliza con la misma regla que el de las personas (`emailDesdeTexto`).
 */
export function decidirAltaDeAdmin(
  email: string,
  rol: RolDePlataforma,
  hechos: HechosParaAltaDeAdmin,
): Resultado<AdminNuevo, ErrorDeAltaDeAdmin> {
  const normalizado = emailDesdeTexto(email);
  if (!normalizado.ok) return normalizado;
  if (hechos.tieneMembresia) return err("ADMIN_CON_MEMBRESIA");
  if (hechos.tieneInvitacionPendiente) return err("ADMIN_CON_INVITACION_PENDIENTE");
  return ok({ email: normalizado.valor, rol });
}

export type ErrorDeBajaDeAdmin = "ADMIN_NO_ENCONTRADO";

/** Lo que el script de baja decide a partir de lo que leyó del administrador. */
export type DecisionDeBajaDeAdmin = Readonly<{
  /** `true`: estaba activo y hay que ponerlo en `activo = false`. `false`: ya estaba de baja, no hay cambio de estado. */
  darDeBaja: boolean;
}>;

/**
 * La baja de un administrador (h5-p8 §2.5), a partir de lo que el script leyó de `admin_plataforma`. Un email que no es
 * de ningún administrador es un error (no se inventa una baja). Que ya esté de baja NO lo es: el script es idempotente,
 * repetirlo no falla ni cambia nada (igual vuelve a cerrar las sesiones que le queden).
 */
export function decidirBajaDeAdmin(
  admin: Readonly<{ activo: boolean }> | null,
): Resultado<DecisionDeBajaDeAdmin, ErrorDeBajaDeAdmin> {
  if (admin === null) return err("ADMIN_NO_ENCONTRADO");
  return ok({ darDeBaja: admin.activo });
}

export type ErrorDeReseteoDeSegundoFactor = "ADMIN_NO_ENCONTRADO" | "ADMIN_DADO_DE_BAJA";

/**
 * El reseteo del segundo factor de un administrador que perdió su dispositivo (h5-p8 §2.4). Solo tiene sentido para
 * personal habilitado: un email que no es de ningún administrador, o de uno dado de baja, se rechaza sin tocar nada (no
 * se borran secretos de quien ya no puede entrar).
 */
export function decidirReseteoDeSegundoFactor(
  admin: Readonly<{ activo: boolean }> | null,
): Resultado<null, ErrorDeReseteoDeSegundoFactor> {
  if (admin === null) return err("ADMIN_NO_ENCONTRADO");
  if (!admin.activo) return err("ADMIN_DADO_DE_BAJA");
  return ok(null);
}
