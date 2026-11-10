import { sql, type Kysely } from "kysely";
import {
  empresaId,
  personaId,
  type EmpresaId,
  type PersonaId,
} from "../../../primitivas/identificadores/marca";
import type { StockDb } from "./esquema";
import { esUuid } from "./filas";
import type { ComponenteGuardado, ComposicionGuardada } from "./modelo";

export type AltaDeComponente = Readonly<{
  articuloId: string;
  /** Texto decimal exacto, en `unidadId`. */
  cantidad: string;
  unidadId: string;
  /** La dimensión del artículo (la base exige que la unidad sea de esa misma dimensión). */
  dimension: string;
}>;

export type AltaDeComposicion = Readonly<{
  productoId: string;
  /** La versión siguiente a la última (la base lo exige: `composicion_numero_salteado`). */
  numero: number;
  /** Texto decimal exacto, mayor que cero: cuántas unidades vendidas rinde la receta. */
  rinde: string;
  creadaPor: PersonaId;
  creadaEn: Date;
  /** Vacío: retira la receta (una versión sin componentes). Se numeran desde 1 en el orden recibido. */
  componentes: readonly AltaDeComponente[];
}>;

export interface RepositorioDeComposiciones {
  /**
   * La ÚLTIMA versión (la de mayor número) del producto con sus componentes, o `null` si nunca tuvo. Una versión SIN componentes es la que
   * retira la receta: quien consulta decide qué significa (el producto vuelve a «falta receta»).
   */
  ultimaVersion(empresa: EmpresaId, productoId: string): Promise<ComposicionGuardada | null>;
  /** La última versión de cada uno de esos productos (los que nunca tuvieron no figuran), por id de producto. */
  ultimasVersiones(
    empresa: EmpresaId,
    productoIds: readonly string[],
  ): Promise<Map<string, ComposicionGuardada>>;
  /** Una versión cualquiera con sus componentes (la de la que salió un renglón del libro). */
  obtener(empresa: EmpresaId, id: string): Promise<ComposicionGuardada | null>;
  /** Escribe la versión y sus componentes en la transacción en curso (solo inserción) y devuelve la versión guardada. */
  insertarVersion(empresa: EmpresaId, alta: AltaDeComposicion): Promise<ComposicionGuardada>;
}

type FilaDeVersion = {
  id: string;
  empresa_id: string;
  producto_id: string;
  numero: number;
  rinde: string;
  creada_por: string;
  creada_en: Date;
};

export function crearRepositorioDeComposiciones(db: Kysely<StockDb>): RepositorioDeComposiciones {
  const aVersion = (
    fila: FilaDeVersion,
    componentes: readonly ComponenteGuardado[],
  ): ComposicionGuardada => ({
    id: fila.id,
    empresaId: empresaId(fila.empresa_id),
    productoId: fila.producto_id,
    numero: fila.numero,
    rinde: fila.rinde,
    creadaPor: personaId(fila.creada_por),
    creadaEn: fila.creada_en,
    componentes,
  });

  /** Los componentes de varias versiones, agrupados por versión y en orden. */
  async function componentesDe(
    empresa: EmpresaId,
    versiones: readonly string[],
  ): Promise<Map<string, ComponenteGuardado[]>> {
    const porVersion = new Map<string, ComponenteGuardado[]>();
    if (versiones.length === 0) return porVersion;
    const filas = await db
      .selectFrom("componente_de_composicion")
      .select([
        "composicion_id",
        "numero",
        "articulo_id",
        "cantidad",
        "unidad_id",
        "dimension",
        "perdida",
      ])
      .where("empresa_id", "=", empresa)
      .where("composicion_id", "in", [...versiones])
      .orderBy("composicion_id")
      .orderBy("numero")
      .execute();
    for (const f of filas) {
      // Hoy todo componente es un artículo (el compuesto lo abre E6 y la base lo rechaza): sin artículo es una falla, no un dato.
      if (f.articulo_id === null) throw new RangeError("componente sin artículo en la base");
      const lista = porVersion.get(f.composicion_id) ?? [];
      lista.push({
        numero: f.numero,
        articuloId: f.articulo_id,
        cantidad: f.cantidad,
        unidadId: f.unidad_id,
        dimension: f.dimension,
        perdida: f.perdida,
      });
      porVersion.set(f.composicion_id, lista);
    }
    return porVersion;
  }

  const columnasDeVersion = [
    "id",
    "empresa_id",
    "producto_id",
    "numero",
    "rinde",
    "creada_por",
    "creada_en",
  ] as const;

  return {
    async ultimaVersion(empresa, productoId) {
      if (!esUuid(productoId)) return null;
      const fila = await db
        .selectFrom("composicion")
        .select(columnasDeVersion)
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", productoId)
        .orderBy("numero", "desc")
        .limit(1)
        .executeTakeFirst();
      if (fila === undefined) return null;
      const componentes = await componentesDe(empresa, [fila.id]);
      return aVersion(fila, componentes.get(fila.id) ?? []);
    },
    async ultimasVersiones(empresa, productoIds) {
      const resultado = new Map<string, ComposicionGuardada>();
      const validos = productoIds.filter(esUuid);
      if (validos.length === 0) return resultado;
      const { rows } = await sql<FilaDeVersion>`
        select distinct on (producto_id) id, empresa_id, producto_id, numero, rinde::text as rinde, creada_por, creada_en
          from composicion
         where empresa_id = ${empresa} and producto_id in (${sql.join(validos.map((p) => sql`${p}::uuid`))})
         order by producto_id, numero desc`.execute(db);
      const componentes = await componentesDe(
        empresa,
        rows.map((f) => f.id),
      );
      for (const f of rows) resultado.set(f.producto_id, aVersion(f, componentes.get(f.id) ?? []));
      return resultado;
    },
    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await db
        .selectFrom("composicion")
        .select(columnasDeVersion)
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      if (fila === undefined) return null;
      const componentes = await componentesDe(empresa, [fila.id]);
      return aVersion(fila, componentes.get(fila.id) ?? []);
    },
    async insertarVersion(empresa, alta) {
      const fila = await db
        .insertInto("composicion")
        .values({
          empresa_id: empresa,
          producto_id: alta.productoId,
          numero: alta.numero,
          rinde: alta.rinde,
          creada_por: alta.creadaPor,
          creada_en: alta.creadaEn,
        })
        .returning(columnasDeVersion)
        .executeTakeFirstOrThrow();
      if (alta.componentes.length > 0) {
        await db
          .insertInto("componente_de_composicion")
          .values(
            alta.componentes.map((c, indice) => ({
              empresa_id: empresa,
              composicion_id: fila.id,
              numero: indice + 1,
              articulo_id: c.articuloId,
              cantidad: c.cantidad,
              unidad_id: c.unidadId,
              dimension: c.dimension,
            })),
          )
          .execute();
      }
      const componentes = await componentesDe(empresa, [fila.id]);
      return aVersion(fila, componentes.get(fila.id) ?? []);
    },
  };
}
