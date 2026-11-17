import pg from "pg";
import type { BaseDePruebas } from "./global";

/** La conexión del dueño de la base de pruebas (evade RLS: arma escenarios). */
export async function conectarDueno(base: BaseDePruebas): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: base.dueno });
  await c.connect();
  return c;
}

/** Un motivo de la lista del sistema de motivos de rechazo, activo (la «Otra» fija sembrada por 0027 si no hay otro). */
export async function motivoDeRechazo(c: pg.Client): Promise<string> {
  const r = await c.query<{ id: string }>(
    "select id from valor_de_lista where lista = 'MOTIVOS_DE_RECHAZO' and activo order by fija desc, nombre limit 1",
  );
  const id = r.rows[0]?.id;
  if (id === undefined) throw new Error("no hay un motivo de rechazo activo sembrado");
  return id;
}
