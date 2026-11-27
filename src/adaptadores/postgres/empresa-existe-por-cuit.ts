import pg from "pg";

/**
 * ¿Ya hay una empresa viva con ese CUIT en la base? Solo lectura, con la cadena DIRECTA del dueño. La usa el alta de un cliente para decidir si el
 * secreto de invitaciones de su web se puede generar de nuevo (nadie recibió todavía una invitación) o no (ya hay invitaciones firmadas con el actual).
 * Una empresa cancelada no cuenta: es lo mismo que dice el índice único `empresa_cuit_uk`.
 */
export async function empresaExistePorCuit(cadena: string, cuit: string): Promise<boolean> {
  const cliente = new pg.Client({ connectionString: cadena, connectionTimeoutMillis: 15_000 });
  await cliente.connect();
  try {
    const { rows } = await cliente.query<{ existe: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM empresa WHERE cuit = $1 AND estado <> 'CANCELLED') AS existe",
      [cuit],
    );
    return rows[0]?.existe === true;
  } finally {
    await cliente.end();
  }
}
