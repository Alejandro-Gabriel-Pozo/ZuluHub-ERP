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
    const { rows } = await cliente.query<{ existe: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM empresa WHERE estado <> 'CANCELLED') AS existe",
    );
    return rows[0]?.existe !== false;
  } finally {
    await cliente.end();
  }
}
