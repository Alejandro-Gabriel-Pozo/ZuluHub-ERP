import { crearLecturaPublicaDeMarcas, type PublicoDb } from "../../src/modulos/marcas/publico";
import type { TxPublica } from "../../src/adaptadores/postgres/resolucion-de-host";
import {
  crearTransaccionesPublicas,
  type TransaccionesPublicasDePostgres,
} from "../../src/adaptadores/postgres/transacciones-publicas";
import type { SinTablas } from "../../src/adaptadores/postgres/transacciones";
import type { Kysely } from "kysely";
import type { BaseDePruebas } from "./global";

/**
 * Apoyo de las pruebas de la puerta pública (M4): arma la transacción pública con lo que armaría la
 * composición real sobre el rol REAL `zuluhub_publico`. El escenario se prepara con el cliente del
 * dueño (`marcas-apoyo.ts`); lo que se prueba pasa por este rol, sin contexto firmado.
 */

export type TxPublicaDePrueba = TxPublica & Readonly<{ db: Kysely<SinTablas> }>;

/** `ajustar` envuelve lo que recibe el trabajo (para provocar una escritura o una consulta de más). */
export function crearEntornoPublico(
  base: BaseDePruebas,
  opciones: {
    url?: string;
    maximoDeConexiones?: number;
    ajustar?: (tx: TxPublicaDePrueba) => TxPublicaDePrueba;
  } = {},
): TransaccionesPublicasDePostgres<TxPublicaDePrueba> {
  const ajustar = opciones.ajustar ?? ((tx) => tx);
  return crearTransaccionesPublicas<TxPublicaDePrueba>({
    url: opciones.url ?? base.publico,
    armar: (db) => ajustar({ db, marcas: crearLecturaPublicaDeMarcas(db.withTables<PublicoDb>()) }),
    maximoDeConexiones: opciones.maximoDeConexiones ?? 4,
  });
}
