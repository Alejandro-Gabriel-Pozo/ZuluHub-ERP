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
  /** El artículo de stock del componente, o `null` si es un elaborado (entonces va `compuestoId`). Exactamente uno de los dos. */
  articuloId: string | null;
  /** El producto `ELABORADO` del componente (D96); ausente o `null` si es un artículo. */
  compuestoId?: string | null | undefined;
  /** Texto decimal exacto, en `unidadId`. */
  cantidad: string;
  unidadId: string;
  /** La dimensión del artículo o del elaborado (la base exige que la unidad sea de esa misma dimensión). */
  dimension: string;
  /** Merma en puntos porcentuales (texto decimal, de 0 a menos de 100); ausente o `null` = sin merma. */
  perdida?: string | null | undefined;
}>;

export type AltaDeComposicion = Readonly<{
  productoId: string;
  /** La versión siguiente a la última (la base lo exige: `composicion_numero_salteado`). */
  numero: number;
  /** Texto decimal exacto, mayor que cero: cuántas unidades vendidas rinde la receta. */
  rinde: string;
  /** Los pasos de la ficha de cocina (texto de una línea); ausente o `null` = sin pasos. */
  pasos?: string | null | undefined;
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
  /**
   * Los productos cuya receta VIGENTE lleva a alguno de estos como elaborado (E6: los niveles de recetas dentro de recetas se miden también
   * hacia arriba: una receta nueva debajo de un elaborado puede pasar de cinco niveles a quien ya lo usa).
   */
  productosQueUsan(empresa: EmpresaId, compuestoIds: readonly string[]): Promise<readonly string[]>;
  /** La versión de ese número de ese producto (E6: comparar versiones), o `null`. */
  porNumero(
    empresa: EmpresaId,
    productoId: string,
    numero: number,
  ): Promise<ComposicionGuardada | null>;
  /** Todas las versiones del producto, de la más nueva a la más vieja, SIN sus componentes (E6: la lista de versiones). */
  versionesDe(empresa: EmpresaId, productoId: string): Promise<readonly ComposicionGuardada[]>;
  /** Escribe la versión y sus componentes en la transacción en curso (solo inserción) y devuelve la versión guardada. */
  insertarVersion(empresa: EmpresaId, alta: AltaDeComposicion): Promise<ComposicionGuardada>;
}

type FilaDeVersion = {
  id: string;
  empresa_id: string;
  producto_id: string;
  numero: number;
  rinde: string;
  pasos: string | null;
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
    pasos: fila.pasos,
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
        "compuesto_id",
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
      // La base exige uno solo de los dos (`componente_destino_ck`): ninguno o los dos es una falla, no un dato.
      if ((f.articulo_id === null) === (f.compuesto_id === null)) {
        throw new RangeError("componente sin artículo ni elaborado, o con los dos, en la base");
      }
      const lista = porVersion.get(f.composicion_id) ?? [];
      lista.push({
        numero: f.numero,
        articuloId: f.articulo_id,
        compuestoId: f.compuesto_id,
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
    "pasos",
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
        select distinct on (producto_id) id, empresa_id, producto_id, numero, rinde::text as rinde, pasos, creada_por, creada_en
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
    async productosQueUsan(empresa, compuestoIds) {
      const validos = compuestoIds.filter(esUuid);
      if (validos.length === 0) return [];
      const { rows } = await sql<{ producto_id: string }>`
        with vigente as (
          select distinct on (producto_id) id, producto_id
            from composicion
           where empresa_id = ${empresa}
           order by producto_id, numero desc)
        select distinct v.producto_id
          from vigente v
          join componente_de_composicion k on k.empresa_id = ${empresa} and k.composicion_id = v.id
         where k.compuesto_id in (${sql.join(validos.map((p) => sql`${p}::uuid`))})
         order by v.producto_id`.execute(db);
      return rows.map((f) => f.producto_id);
    },
    async porNumero(empresa, productoId, numero) {
      if (!esUuid(productoId)) return null;
      const fila = await db
        .selectFrom("composicion")
        .select(columnasDeVersion)
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", productoId)
        .where("numero", "=", numero)
        .executeTakeFirst();
      if (fila === undefined) return null;
      const componentes = await componentesDe(empresa, [fila.id]);
      return aVersion(fila, componentes.get(fila.id) ?? []);
    },
    async versionesDe(empresa, productoId) {
      if (!esUuid(productoId)) return [];
      const filas = await db
        .selectFrom("composicion")
        .select(columnasDeVersion)
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", productoId)
        .orderBy("numero", "desc")
        .execute();
      return filas.map((f) => aVersion(f, []));
    },
    async insertarVersion(empresa, alta) {
      const fila = await db
        .insertInto("composicion")
        .values({
          empresa_id: empresa,
          producto_id: alta.productoId,
          numero: alta.numero,
          rinde: alta.rinde,
          pasos: alta.pasos ?? null,
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
              compuesto_id: c.compuestoId ?? null,
              cantidad: c.cantidad,
              unidad_id: c.unidadId,
              dimension: c.dimension,
              ...(c.perdida === null || c.perdida === undefined ? {} : { perdida: c.perdida }),
            })),
          )
          .execute();
      }
      const componentes = await componentesDe(empresa, [fila.id]);
      return aVersion(fila, componentes.get(fila.id) ?? []);
    },
  };
}
