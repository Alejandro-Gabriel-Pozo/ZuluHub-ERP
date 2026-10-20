import type { Kysely, KyselyPlugin } from "kysely";
import { crearLecturaPublicaDeMarcas, type PublicoDb } from "../../src/modulos/marcas/publico";
import type { TxPublica } from "../../src/adaptadores/postgres/resolucion-de-host";
import {
  crearTransaccionesPublicas,
  type TransaccionesPublicasDePostgres,
} from "../../src/adaptadores/postgres/transacciones-publicas";
import type { SinTablas } from "../../src/adaptadores/postgres/transacciones";
import type { BaseDePruebas } from "./global";

/**
 * Apoyo de las pruebas de la puerta pública (M4 y M4b): arma la transacción pública con lo que armaría la
 * composición real sobre el rol REAL `pedernal_publico`. El escenario se prepara con el cliente del
 * dueño (`marcas-apoyo.ts`); lo que se prueba pasa por este rol, sin contexto firmado.
 */

export type TxPublicaDePrueba = TxPublica & Readonly<{ db: Kysely<SinTablas> }>;

/**
 * Un plugin que, al terminar CADA consulta de la transacción, espera a `alTerminar(n)` (n = 1 para la
 * primera). Sirve para meter una escritura de otra conexión justo en el medio de una lectura de varias
 * consultas y ver qué foto de la base sigue viendo. No cambia las consultas ni sus resultados. Un plugin
 * nuevo por transacción: el contador es suyo.
 */
function pluginDeCorte(alTerminar: (n: number) => Promise<void>): KyselyPlugin {
  let consultas = 0;
  return {
    transformQuery: (args) => args.node,
    async transformResult(args) {
      consultas += 1;
      await alTerminar(consultas);
      return args.result;
    },
  };
}

/**
 * `ajustar` envuelve lo que recibe el trabajo (para provocar una escritura o una consulta de más).
 * `alTerminarConsulta` se llama al terminar cada consulta de las lecturas de marcas (ver `pluginDeCorte`).
 */
export function crearEntornoPublico(
  base: BaseDePruebas,
  opciones: {
    url?: string;
    maximoDeConexiones?: number;
    ajustar?: (tx: TxPublicaDePrueba) => TxPublicaDePrueba;
    alTerminarConsulta?: (n: number) => Promise<void>;
  } = {},
): TransaccionesPublicasDePostgres<TxPublicaDePrueba> {
  const ajustar = opciones.ajustar ?? ((tx) => tx);
  const alTerminarConsulta = opciones.alTerminarConsulta;
  return crearTransaccionesPublicas<TxPublicaDePrueba>({
    url: opciones.url ?? base.publico,
    armar: (db) => {
      const lector =
        alTerminarConsulta === undefined ? db : db.withPlugin(pluginDeCorte(alTerminarConsulta));
      return ajustar({ db, marcas: crearLecturaPublicaDeMarcas(lector.withTables<PublicoDb>()) });
    },
    maximoDeConexiones: opciones.maximoDeConexiones ?? 4,
  });
}
