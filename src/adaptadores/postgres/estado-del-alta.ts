import pg from "pg";

/**
 * El estado del alta de un cliente con base propia, para decidir si se puede reemitir la invitación del gerente. Solo lectura, con la cadena DIRECTA del dueño (las tablas tienen RLS forzada: con un rol que
 * no ve todas las filas el resultado sería «no hay nada», así que se exige `rolsuper` o `rolbypassrls` y, si no, falla). Devuelve ids, tipos, estados y el email de los administradores: el email es un dato
 * personal, quien llama lo tapa y no lo imprime.
 */
export type EstadoDelAlta = Readonly<{
  empresas: readonly Readonly<{ id: string; estado: string }>[];
  invitacionesPendientes: readonly Readonly<{ id: string; tipo: string }>[];
  /** Los administradores de plataforma activos con rol ADMIN, del más antiguo al más nuevo (actúa el primero: el que sembró el alta). */
  administradores: readonly string[];
}>;

export async function leerEstadoDelAlta(cadena: string): Promise<EstadoDelAlta> {
  const cliente = new pg.Client({ connectionString: cadena, connectionTimeoutMillis: 15_000 });
  await cliente.connect();
  try {
    const rol = await cliente.query<{ ve_todo: boolean }>(
      "SELECT (rolsuper OR rolbypassrls) AS ve_todo FROM pg_roles WHERE rolname = current_user",
    );
    if (rol.rows[0]?.ve_todo !== true) {
      throw new Error(
        "el rol de la cadena no ve todas las filas (sin rolsuper ni rolbypassrls): no se puede saber el estado del alta",
      );
    }
    const empresas = await cliente.query<{ id: string; estado: string }>(
      "SELECT id, estado FROM empresa WHERE estado <> 'CANCELLED' ORDER BY id",
    );
    const invitaciones = await cliente.query<{ id: string; tipo: string }>(
      "SELECT id, tipo FROM invitacion WHERE estado = 'PENDIENTE' ORDER BY id",
    );
    const admins = await cliente.query<{ email: string }>(
      "SELECT email FROM admin_plataforma WHERE activo AND rol = 'ADMIN' ORDER BY creado_en, email",
    );
    return {
      empresas: empresas.rows,
      invitacionesPendientes: invitaciones.rows,
      administradores: admins.rows.map((a) => a.email),
    };
  } finally {
    await cliente.end();
  }
}
