import type pg from "pg";
import { adminPlataformaId, type AdminPlataformaId } from "../../primitivas/identificadores/marca";
import type { AccionDePlataforma } from "../../puertos/auditoria-de-plataforma";
import { exigirSinSecretos, type Dato } from "../../puertos/sin-secretos";
import { ACTOR_DE_SISTEMA } from "./contexto-firmado";

/**
 * Lo que comparten los scripts del dueño que operan sobre un administrador de plataforma (baja y reseteo del segundo
 * factor; h5-p8 §2.4 y §2.5), dentro de la transacción que abre `enTransaccionDelDueno`. Todo con la conexión DIRECTA
 * del dueño: el rol de autenticación no puede borrar `user` ni `account`, y ningún rol limitado escribe en
 * `admin_plataforma`.
 *
 * El email entra YA normalizado (`emailDesdeTexto`) y solo se usa para buscar: nunca va a una constancia ni a un mensaje.
 */

export type AdminLeido = Readonly<{ id: AdminPlataformaId; activo: boolean }>;

/** El administrador con ese email (activo o no), o `null`. */
export async function leerAdmin(cliente: pg.Client, email: string): Promise<AdminLeido | null> {
  const fila = (
    await cliente.query<{ id: string; activo: boolean }>(
      "SELECT id, activo FROM admin_plataforma WHERE email = $1",
      [email],
    )
  ).rows[0];
  return fila === undefined ? null : { id: adminPlataformaId(fila.id), activo: fila.activo };
}

/**
 * Los usuarios de la librería de ingreso con ese email. La librería guarda el email en minúsculas, y se compara así
 * igual (sin distinguir mayúsculas ni blancos) por si algún valor viejo no lo estuviera: lo que no se encuentra no se
 * revoca. Uno o ninguno en la práctica; se tratan todos los que coincidan.
 */
export async function usuariosDeLaLibreria(cliente: pg.Client, email: string): Promise<string[]> {
  return (
    await cliente.query<{ id: string }>(
      `SELECT id FROM autenticacion."user" WHERE lower(btrim(email)) = $1`,
      [email],
    )
  ).rows.map((fila) => fila.id);
}

/** Borra TODAS las sesiones de esos usuarios (la consola y la web comparten la tabla) y devuelve cuántas. */
export async function revocarSesiones(
  cliente: pg.Client,
  usuarios: readonly string[],
): Promise<number> {
  if (usuarios.length === 0) return 0;
  const r = await cliente.query(
    `DELETE FROM autenticacion.session WHERE "userId" = ANY($1::uuid[])`,
    [usuarios],
  );
  return r.rowCount ?? 0;
}

/**
 * La constancia en `auditoria_plataforma` con el actor `sistema` (no hay sesión web: lo hace el dueño con su conexión),
 * en la misma transacción. Pasa por `exigirSinSecretos`: ni el email ni nada de un secreto entra a la auditoría.
 */
export async function auditar(
  cliente: pg.Client,
  accion: AccionDePlataforma,
  adminId: AdminPlataformaId,
  antes: Readonly<Record<string, Dato>>,
  despues: Readonly<Record<string, Dato>>,
): Promise<void> {
  exigirSinSecretos(antes, accion);
  exigirSinSecretos(despues, accion);
  await cliente.query(
    `INSERT INTO auditoria_plataforma (actor, accion, entidad, entidad_id, antes, despues)
     VALUES ($1, $2, 'admin_plataforma', $3, $4::jsonb, $5::jsonb)`,
    [ACTOR_DE_SISTEMA, accion, adminId, JSON.stringify(antes), JSON.stringify(despues)],
  );
}
