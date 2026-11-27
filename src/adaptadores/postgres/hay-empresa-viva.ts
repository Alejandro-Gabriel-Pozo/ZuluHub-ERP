import pg from "pg";

/**
 * ¿Ya hay ALGUNA empresa viva (no cancelada) en esta base? Solo lectura, con la cadena DIRECTA del dueño. Cada cliente con base propia tiene su base: si ya hay una empresa, el alta ya se hizo (o
 * alguien la hizo a mano) y el secreto de invitaciones de su web NO se puede cambiar, porque dejaría inválida la invitación ya emitida. Se mira la base entera y no un CUIT (un dato editable en el
 * paquete): con otro CUIT el resultado es el mismo. Una empresa cancelada no cuenta (como el índice único `empresa_cuit_uk`).
 */
export async function hayEmpresaViva(cadena: string): Promise<boolean> {
  const cliente = new pg.Client({ connectionString: cadena, connectionTimeoutMillis: 15_000 });
  await cliente.connect();
  try {
    // `empresa` tiene RLS forzada: con un rol sin `rolsuper` ni `rolbypassrls` la consulta devolvería 0 filas aunque haya empresas, y «no hay empresa» rotaría el secreto de invitaciones con el alta
    // ya hecha. Por eso se exige poder ver todo; si no, falla (no devuelve «no hay»).
    const rol = await cliente.query<{ ve_todo: boolean }>(
      "SELECT (rolsuper OR rolbypassrls) AS ve_todo FROM pg_roles WHERE rolname = current_user",
    );
    if (rol.rows[0]?.ve_todo !== true) {
      throw new Error(
        "el rol de la cadena no ve todas las filas de `empresa` (sin rolsuper ni rolbypassrls): no se puede saber si hay una empresa",
      );
    }
    const { rows } = await cliente.query<{ existe: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM empresa WHERE estado <> 'CANCELLED') AS existe",
    );
    return rows[0]?.existe !== false;
  } finally {
    await cliente.end();
  }
}
