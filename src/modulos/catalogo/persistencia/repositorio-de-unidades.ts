import type { Kysely } from "kysely";
import type { CatalogoDb } from "./esquema";

/** Una unidad de medida de la lista cerrada (tabla global `unidad_de_medida`, sembrada en 0025): el código es el id; el símbolo es el que se muestra («kg», «u»). */
export type UnidadDeMedida = Readonly<{
  id: string;
  dimension: string;
  simbolo: string;
  /** Texto decimal exacto: cuántas unidades base de su dimensión entran en esta. */
  factorABase: string;
  esBase: boolean;
}>;

/**
 * Las unidades de medida, para mostrar la de un producto y para el desplegable de la ficha. La tabla es global y de solo lectura (nadie la escribe): no filtra por empresa. Los
 * nombres largos («Kilogramo») no existen como dato: lo que hay es el código y el símbolo; un texto nuevo de unidades es una decisión del dueño y va por el vocabulario.
 */
export interface RepositorioDeUnidades {
  /** Todas, por dimensión y de la más chica a la más grande (la base primero). */
  todas(): Promise<readonly UnidadDeMedida[]>;
}

export function crearRepositorioDeUnidades(db: Kysely<CatalogoDb>): RepositorioDeUnidades {
  return {
    async todas() {
      const filas = await db
        .selectFrom("unidad_de_medida")
        .select(["id", "dimension", "simbolo", "factor_a_base", "es_base"])
        .orderBy("dimension")
        .orderBy("es_base", "desc")
        .orderBy("id")
        .execute();
      return filas.map((f) => ({
        id: f.id,
        dimension: f.dimension,
        simbolo: f.simbolo,
        factorABase: f.factor_a_base,
        esBase: f.es_base,
      }));
    },
  };
}
