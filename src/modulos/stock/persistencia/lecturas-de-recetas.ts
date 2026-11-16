import { sql, type Kysely, type RawBuilder } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { StockDb } from "./esquema";
import { comoPrefijo } from "./lecturas-del-libro";

/**
 * Las listas de la pantalla de Recetas (B1 y B3 de `recetas-pantalla.md` §8): los productos que llevan receta (con o sin ella) y los que se ofrecen como ingrediente. Son LECTURAS
 * paginadas por `(nombre_clave, id)` con el límite que pide quien llama; no escriben. Todo filtra por la empresa (la RLS lo repite) y lo que se busca viaja como parámetro, con `%`,
 * `_` y `\` escapados. Viven en un archivo propio y no en los repositorios de artículos o composiciones, que tocan otros tramos.
 */

/** Las clases que llevan receta (`guardarComposicion`: `PRODUCTO_NO_LLEVA_RECETA` para el resto). */
const CLASES_CON_RECETA = ["VENDIBLE", "ELABORADO"] as const;
/** Las clases que se ofrecen como ingrediente: la materia prima y la reventa entran por su artículo de stock y el elaborado como subcomposición; el insumo, nunca (`COMPONENTE_ES_INSUMO`). */
const CLASES_DE_INGREDIENTE = ["MATERIA_PRIMA", "REVENTA", "ELABORADO"] as const;
const ARTICULOS = ["MATERIA_PRIMA", "REVENTA"] as const;

export type ClaveDePagina = Readonly<{ nombreClave: string; id: string }>;

export type FiltroDeProductosConReceta = Readonly<{
  /** Prefijo del nombre (ya validado: la consulta lo comprueba). */
  texto?: string | undefined;
  /** `true`: con receta (la última versión tiene componentes); `false`: sin receta (nunca tuvo o la última la retiró). Ausente: todos. */
  conReceta?: boolean | undefined;
  activo?: boolean | undefined;
  despuesDe?: ClaveDePagina | undefined;
  limite: number;
}>;

export type FilaDeProductoConReceta = Readonly<{
  productoId: string;
  nombre: string;
  nombreClave: string;
  claseDeUso: "VENDIBLE" | "ELABORADO";
  activo: boolean;
  /** El número de la versión vigente, o `null` si no tiene receta (nunca tuvo, o la última versión la retiró). */
  version: number | null;
}>;

export type FiltroDeIngredientes = Readonly<{
  texto?: string | undefined;
  /** Un producto que no se ofrece (el de la receta que se arma: de ingrediente de sí mismo terminaría en un ciclo). */
  excluirProductoId?: string | undefined;
  despuesDe?: ClaveDePagina | undefined;
  limite: number;
}>;

export type FilaDeIngredienteElegible = Readonly<{
  productoId: string;
  nombre: string;
  nombreClave: string;
  claseDeUso: "MATERIA_PRIMA" | "REVENTA" | "ELABORADO";
  /** La unidad en que se carga: la de stock del artículo o la base del elaborado. */
  unidadId: string;
}>;

export interface LecturasDeRecetas {
  /** Productos `VENDIBLE` o `ELABORADO` de la empresa con su versión vigente (si la hay), de `limite` en `limite`, por `(nombre_clave, id)`. */
  productosConReceta(
    empresa: EmpresaId,
    filtro: FiltroDeProductosConReceta,
  ): Promise<readonly FilaDeProductoConReceta[]>;
  /** Lo que se puede poner de ingrediente: artículos activos de materia prima o reventa (producto activo) y elaborados activos; nunca insumos. */
  ingredientesElegibles(
    empresa: EmpresaId,
    filtro: FiltroDeIngredientes,
  ): Promise<readonly FilaDeIngredienteElegible[]>;
}

type FilaCruda = { id: string; nombre: string; nombre_clave: string; clase_de_uso: string };
type FilaDeProducto = FilaCruda & { activo: boolean; version: number | null };
type FilaDeIngrediente = FilaCruda & { unidad_id: string };

const unirY = (condiciones: readonly RawBuilder<unknown>[]) => sql.join(condiciones, sql` and `);

const enLista = (valores: readonly string[]) => sql.join(valores.map((v) => sql`${v}`));

/** Una clase que la base guarda y la pantalla no conoce es una falla, no un dato: nunca se autoriza a ciegas. */
function claseDe<T extends string>(texto: string, permitidas: readonly T[]): T {
  const clase = permitidas.find((c) => c === texto);
  if (clase === undefined) throw new RangeError(`clase de uso inesperada en la lista: ${texto}`);
  return clase;
}

export function crearLecturasDeRecetas(db: Kysely<StockDb>): LecturasDeRecetas {
  return {
    async productosConReceta(empresa, filtro) {
      const condiciones = [
        sql`p.empresa_id = ${empresa}`,
        sql`p.clase_de_uso in (${enLista(CLASES_CON_RECETA)})`,
      ];
      if (filtro.texto !== undefined) {
        condiciones.push(
          sql`p.nombre_clave like ${comoPrefijo(filtro.texto.toLowerCase())} escape '\\'`,
        );
      }
      if (filtro.activo !== undefined) condiciones.push(sql`p.activo = ${filtro.activo}`);
      // «Con receta» es que la ÚLTIMA versión tenga componentes: una versión vacía es la que retiró la receta.
      if (filtro.conReceta !== undefined) {
        condiciones.push(sql`coalesce(v.con_componentes, false) = ${filtro.conReceta}`);
      }
      if (filtro.despuesDe !== undefined) {
        condiciones.push(
          sql`(p.nombre_clave, p.id) > (${filtro.despuesDe.nombreClave}, ${filtro.despuesDe.id}::uuid)`,
        );
      }
      const { rows } = await sql<FilaDeProducto>`
        select p.id, p.nombre, p.nombre_clave, p.clase_de_uso, p.activo,
               case when v.con_componentes then v.numero end as version
          from producto p
          left join lateral (
            select c.numero,
                   exists (select 1 from componente_de_composicion k
                            where k.empresa_id = c.empresa_id and k.composicion_id = c.id) as con_componentes
              from composicion c
             where c.empresa_id = p.empresa_id and c.producto_id = p.id
             order by c.numero desc
             limit 1) v on true
         where ${unirY(condiciones)}
         order by p.nombre_clave, p.id
         limit ${filtro.limite}`.execute(db);
      return rows.map((f) => ({
        productoId: f.id,
        nombre: f.nombre,
        nombreClave: f.nombre_clave,
        claseDeUso: claseDe(f.clase_de_uso, CLASES_CON_RECETA),
        activo: f.activo,
        version: f.version,
      }));
    },

    async ingredientesElegibles(empresa, filtro) {
      const condiciones = [
        sql`p.empresa_id = ${empresa}`,
        sql`p.activo`,
        sql`p.clase_de_uso in (${enLista(CLASES_DE_INGREDIENTE)})`,
        // El elaborado entra por sí mismo; los demás, solo con su artículo de stock activo.
        sql`(p.clase_de_uso = 'ELABORADO' or (p.clase_de_uso in (${enLista(ARTICULOS)}) and a.activo))`,
      ];
      if (filtro.excluirProductoId !== undefined) {
        condiciones.push(sql`p.id <> ${filtro.excluirProductoId}::uuid`);
      }
      if (filtro.texto !== undefined) {
        condiciones.push(
          sql`p.nombre_clave like ${comoPrefijo(filtro.texto.toLowerCase())} escape '\\'`,
        );
      }
      if (filtro.despuesDe !== undefined) {
        condiciones.push(
          sql`(p.nombre_clave, p.id) > (${filtro.despuesDe.nombreClave}, ${filtro.despuesDe.id}::uuid)`,
        );
      }
      const { rows } = await sql<FilaDeIngrediente>`
        select p.id, p.nombre, p.nombre_clave, p.clase_de_uso,
               case when p.clase_de_uso = 'ELABORADO' then p.unidad_base_id else a.unidad_de_stock_id end as unidad_id
          from producto p
          left join articulo_de_stock a on a.empresa_id = p.empresa_id and a.producto_id = p.id
         where ${unirY(condiciones)}
         order by p.nombre_clave, p.id
         limit ${filtro.limite}`.execute(db);
      return rows.map((f) => ({
        productoId: f.id,
        nombre: f.nombre,
        nombreClave: f.nombre_clave,
        claseDeUso: claseDe(f.clase_de_uso, CLASES_DE_INGREDIENTE),
        unidadId: f.unidad_id,
      }));
    },
  };
}
