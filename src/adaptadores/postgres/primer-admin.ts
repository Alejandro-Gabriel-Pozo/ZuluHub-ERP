import pg from "pg";
import { decidirAltaDeAdmin, type ErrorDeAltaDeAdmin } from "../../plataforma/dominio/admin";
import { adminPlataformaId, type AdminPlataformaId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { AccionDePlataforma } from "../../puertos/auditoria-de-plataforma";
import { exigirSinSecretos } from "../../puertos/sin-secretos";
import { ACTOR_DE_SISTEMA } from "./contexto-firmado";
import { esReintentable } from "./errores";

/**
 * Siembra al primer administrador de plataforma (H5 §B.2 y P7). Se corre con la cadena DIRECTA del dueño
 * de la base (ningún rol limitado puede escribir en `admin_plataforma`) desde `scripts/crear-primer-admin.ts`.
 *
 * Todo en UNA transacción SERIALIZABLE: ver si ya existe, aplicar el invariante F5 (un administrador no
 * tiene ninguna membresía ni invitación pendiente: `decidirAltaDeAdmin`), insertar y dejar la constancia en
 * `auditoria_plataforma`. La constancia nombra al actor `sistema` (no hay todavía ningún administrador que
 * pueda ser el actor) y NO lleva el email: la fila del administrador ya lo tiene, y la auditoría se lee
 * desde la consola.
 *
 * Idempotente: repetirlo con el mismo email no inserta ni audita de nuevo (`yaEstaba`). Dos siembras
 * simultáneas del mismo email dejan UN solo administrador y UNA constancia: la que pierde choca (40001 o
 * la unicidad del email), se repite y encuentra al que ganó. Los administradores que ya existen pero no son
 * ADMIN activo (un SOPORTE, uno dado de baja) NO se tocan: cambiar el rol de alguien o reactivarlo es una
 * decisión de permisos que no se toma como efecto de un «crear».
 *
 * El invariante F5 tiene dos barreras: este chequeo (membresías de empresa y de tenant, de cualquier rol y
 * estado, e invitaciones pendientes de cualquier tipo, vencidas o no) y el disparador
 * `admin_plataforma_validar` de la base, que repite el de las membresías.
 */

export type ResultadoDelSembrado = Readonly<{
  adminId: AdminPlataformaId;
  /** `true`: ya existía un ADMIN activo con ese email y no se escribió nada. */
  yaEstaba: boolean;
}>;

export type ErrorDelSembrado =
  | ErrorDeAltaDeAdmin
  /** Ese email ya es de un administrador que no es ADMIN activo (un SOPORTE o uno dado de baja). */
  | "ADMIN_EXISTENTE_NO_ES_ADMIN_ACTIVO";

const ROL_DEL_PRIMER_ADMIN = "ADMIN";
const ACCION_DE_LA_CONSTANCIA: AccionDePlataforma = "ADMIN_PLATAFORMA_ALTA";
const ORIGEN_DE_LA_CONSTANCIA = "script crear-primer-admin";
const REINTENTOS = 12;
const UNICIDAD_DEL_EMAIL = "admin_plataforma_email_uk";
const BARRERA_DE_MEMBRESIAS = "admin_plataforma_sin_membresia";
const ESPERA_BASE_EN_MS = 40;
const ESPERA_TOPE_EN_MS = 1000;

type FilaDeAdmin = { id: string; rol: string; activo: boolean };
type Hechos = { tiene_membresia: boolean; tiene_invitacion_pendiente: boolean };

const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

/**
 * Cuánto esperar antes del reintento número `intento` (0 es el primero): espera exponencial con «jitter completo»
 * (un valor al azar entre 0 y el techo del intento). Bajo SERIALIZABLE los chequeos de existencia toman bloqueos de
 * lectura gruesos, así que varias siembras simultáneas (aunque sean de emails distintos) se cancelan entre sí al
 * confirmar (40001); una espera fija y corta las hace chocar otra vez en bloque y agota los reintentos. El techo
 * crece con cada intento y se corta en `ESPERA_TOPE_EN_MS`.
 */
export function esperaDelReintento(intento: number, azar: () => number = Math.random): number {
  return azar() * Math.min(ESPERA_TOPE_EN_MS, ESPERA_BASE_EN_MS * 2 ** intento);
}

/** Un choque de unicidad del email: lo causó una siembra simultánea del mismo email. Se repite y ve al ganador. */
function esChoqueDelEmail(falla: unknown): boolean {
  return (
    falla instanceof pg.DatabaseError &&
    falla.code === "23505" &&
    falla.constraint === UNICIDAD_DEL_EMAIL
  );
}

function esBarreraDeMembresias(falla: unknown): boolean {
  return (
    falla instanceof pg.DatabaseError &&
    falla.code === "23514" &&
    falla.constraint === BARRERA_DE_MEMBRESIAS
  );
}

async function intentar(
  cliente: pg.Client,
  email: string,
): Promise<Resultado<ResultadoDelSembrado, ErrorDelSembrado>> {
  await cliente.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const existente = (
      await cliente.query<FilaDeAdmin>(
        "SELECT id, rol, activo FROM admin_plataforma WHERE email = $1",
        [email],
      )
    ).rows[0];
    if (existente !== undefined) {
      await cliente.query("ROLLBACK");
      return existente.rol === ROL_DEL_PRIMER_ADMIN && existente.activo
        ? ok({ adminId: adminPlataformaId(existente.id), yaEstaba: true })
        : err("ADMIN_EXISTENTE_NO_ES_ADMIN_ACTIVO");
    }

    const hechos = (
      await cliente.query<Hechos>(
        `SELECT
           EXISTS (
             SELECT 1 FROM persona p
             WHERE p.email = $1
               AND (EXISTS (SELECT 1 FROM membresia m WHERE m.persona_id = p.id)
                    OR EXISTS (SELECT 1 FROM membresia_tenant mt WHERE mt.persona_id = p.id))
           ) AS tiene_membresia,
           EXISTS (
             SELECT 1 FROM invitacion i WHERE i.email = $1 AND i.estado = 'PENDIENTE'
           ) AS tiene_invitacion_pendiente`,
        [email],
      )
    ).rows[0];
    if (hechos === undefined) throw new Error("la consulta de hechos no devolvió una fila");
    const decision = decidirAltaDeAdmin(email, ROL_DEL_PRIMER_ADMIN, {
      tieneMembresia: hechos.tiene_membresia,
      tieneInvitacionPendiente: hechos.tiene_invitacion_pendiente,
    });
    if (!decision.ok) {
      await cliente.query("ROLLBACK");
      return decision;
    }

    const nuevo = (
      await cliente.query<{ id: string }>(
        "INSERT INTO admin_plataforma (email, rol) VALUES ($1, $2) RETURNING id",
        [decision.valor.email, decision.valor.rol],
      )
    ).rows[0];
    if (nuevo === undefined) throw new Error("el alta del administrador no devolvió su id");
    const despues = { rol: decision.valor.rol, origen: ORIGEN_DE_LA_CONSTANCIA };
    exigirSinSecretos(despues, "alta del primer administrador");
    await cliente.query(
      `INSERT INTO auditoria_plataforma (actor, accion, entidad, entidad_id, antes, despues)
       VALUES ($1, $2, 'admin_plataforma', $3, NULL, $4::jsonb)`,
      [ACTOR_DE_SISTEMA, ACCION_DE_LA_CONSTANCIA, nuevo.id, JSON.stringify(despues)],
    );
    await cliente.query("COMMIT");
    return ok({ adminId: adminPlataformaId(nuevo.id), yaEstaba: false });
  } catch (falla) {
    // La transacción queda abortada: se la deshace antes de decidir qué hacer con la falla.
    await cliente.query("ROLLBACK").catch(() => undefined);
    throw falla;
  }
}

export async function crearPrimerAdmin(
  urlDueno: string,
  email: string,
): Promise<Resultado<ResultadoDelSembrado, ErrorDelSembrado>> {
  // El email se valida ANTES de abrir una conexión: un email mal formado no toca la red.
  const previo = decidirAltaDeAdmin(email, ROL_DEL_PRIMER_ADMIN, {
    tieneMembresia: false,
    tieneInvitacionPendiente: false,
  });
  if (!previo.ok) return previo;

  const cliente = new pg.Client({
    connectionString: urlDueno,
    statement_timeout: 30_000,
    lock_timeout: 15_000,
  });
  await cliente.connect();
  try {
    for (let intento = 0; ; intento++) {
      try {
        return await intentar(cliente, previo.valor.email);
      } catch (falla) {
        if (esBarreraDeMembresias(falla)) return err("ADMIN_CON_MEMBRESIA");
        if ((esReintentable(falla) || esChoqueDelEmail(falla)) && intento < REINTENTOS) {
          await esperar(esperaDelReintento(intento));
          continue;
        }
        throw falla;
      }
    }
  } finally {
    await cliente.end();
  }
}
