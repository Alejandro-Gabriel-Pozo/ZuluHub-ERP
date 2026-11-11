import type { Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { esNivelDeCompra, NIVEL_INICIAL_DE_COMPRA, type NivelDeCompra } from "../dominio/niveles";
import type { ComprasDb } from "./esquema";

export type ConfiguracionDeCompras = Readonly<{ nivel: NivelDeCompra; version: number }>;

/**
 * El nivel de operación de las compras de la empresa (E9 §3.3). La fila nace la primera vez que se la necesita (valor inicial N1); `bloquear` la toma
 * `FOR UPDATE`: cambiar el nivel y registrar una compra a la vez se serializan, y cada compra sella el nivel con que nació.
 */
export interface RepositorioDeConfiguracionDeCompras {
  /** La configuración vigente (la crea con el valor inicial si todavía no existe). */
  leer(empresa: EmpresaId): Promise<ConfiguracionDeCompras>;
  /** Igual que `leer`, con la fila bloqueada hasta el fin de la transacción. */
  bloquear(empresa: EmpresaId): Promise<ConfiguracionDeCompras>;
  /** `null` si la versión ya no es la esperada. */
  cambiarNivel(
    empresa: EmpresaId,
    nivel: NivelDeCompra,
    versionEsperada: number,
  ): Promise<ConfiguracionDeCompras | null>;
}

function aConfiguracion(fila: { nivel: string; version: number }): ConfiguracionDeCompras {
  if (!esNivelDeCompra(fila.nivel))
    throw new RangeError(`nivel de compras desconocido: ${fila.nivel}`);
  return { nivel: fila.nivel, version: fila.version };
}

export function crearRepositorioDeConfiguracionDeCompras(
  db: Kysely<ComprasDb>,
): RepositorioDeConfiguracionDeCompras {
  async function asegurar(empresa: EmpresaId, bloquear: boolean): Promise<ConfiguracionDeCompras> {
    await db
      .insertInto("configuracion_de_compras")
      .values({ empresa_id: empresa, nivel: NIVEL_INICIAL_DE_COMPRA })
      .onConflict((oc) => oc.doNothing())
      .execute();
    let consulta = db
      .selectFrom("configuracion_de_compras")
      .select(["nivel", "version"])
      .where("empresa_id", "=", empresa);
    if (bloquear) consulta = consulta.forUpdate();
    return aConfiguracion(await consulta.executeTakeFirstOrThrow());
  }
  return {
    leer: (empresa) => asegurar(empresa, false),
    bloquear: (empresa) => asegurar(empresa, true),
    async cambiarNivel(empresa, nivel, versionEsperada) {
      const fila = await db
        .updateTable("configuracion_de_compras")
        .set({ nivel })
        .where("empresa_id", "=", empresa)
        .where("version", "=", versionEsperada)
        .returning(["nivel", "version"])
        .executeTakeFirst();
      return fila === undefined ? null : aConfiguracion(fila);
    },
  };
}
