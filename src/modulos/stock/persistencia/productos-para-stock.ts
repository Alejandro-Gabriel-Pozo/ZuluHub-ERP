import type { Kysely, Selectable } from "kysely";
import type { ClaseDeUso, ProductosParaStock, ProductoParaStock } from "../../catalogo/publico";
import { CLASES_DE_USO } from "../../catalogo/publico";
import type { StockDb } from "./esquema";
import { esUuid } from "./filas";

/** Una clase que la base guarda y el catálogo no conoce es una falla, no un dato: nunca se autoriza a ciegas. */
function claseDeUso(texto: string): ClaseDeUso {
  const clase = CLASES_DE_USO.find((c) => c === texto);
  if (clase === undefined) throw new RangeError(`clase de uso inválida en la base: ${texto}`);
  return clase;
}

const aProducto = (fila: Selectable<StockDb["producto"]>): ProductoParaStock => ({
  id: fila.id,
  nombre: fila.nombre,
  nombreClave: fila.nombre_clave,
  claseDeUso: claseDeUso(fila.clase_de_uso),
  activo: fila.activo,
  unidadBaseId: fila.unidad_base_id,
  dimension: fila.dimension,
});

/** El lector que el catálogo promete (`ProductosParaStock`), sobre las columnas que declara `tablas.ts`. */
export function crearProductosParaStock(db: Kysely<StockDb>): ProductosParaStock {
  const columnas = [
    "id",
    "empresa_id",
    "nombre",
    "nombre_clave",
    "clase_de_uso",
    "unidad_base_id",
    "dimension",
    "activo",
  ] as const;
  return {
    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await db
        .selectFrom("producto")
        .select(columnas)
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aProducto(fila);
    },
    async bloquearCompartido(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await db
        .selectFrom("producto")
        .select(columnas)
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .forShare()
        .executeTakeFirst();
      return fila === undefined ? null : aProducto(fila);
    },
    async porIds(empresa, ids) {
      const validos = ids.filter(esUuid);
      if (validos.length === 0) return [];
      const filas = await db
        .selectFrom("producto")
        .select(columnas)
        .where("empresa_id", "=", empresa)
        .where("id", "in", validos)
        .orderBy("id")
        .execute();
      return filas.map(aProducto);
    },
    async consumoDeVersiones(empresa, versiones) {
      const porVersion = new Map<
        string,
        Array<{ insumoId: string; cantidad: string; escalaConTamano: boolean }>
      >();
      const validas = versiones.filter(esUuid);
      if (validas.length === 0) return porVersion;
      const filas = await db
        .selectFrom("consumo_de_opcion")
        .select(["version_de_opcion_id", "insumo_id", "cantidad", "escala_con_tamano"])
        .where("empresa_id", "=", empresa)
        .where("version_de_opcion_id", "in", validas)
        .orderBy("version_de_opcion_id")
        .orderBy("numero")
        .execute();
      for (const f of filas) {
        const lineas = porVersion.get(f.version_de_opcion_id) ?? [];
        lineas.push({
          insumoId: f.insumo_id,
          cantidad: f.cantidad,
          escalaConTamano: f.escala_con_tamano,
        });
        porVersion.set(f.version_de_opcion_id, lineas);
      }
      return porVersion;
    },
    async factoresDeTamano(empresa, versiones) {
      const factores = new Map<string, string>();
      const validas = versiones.filter(esUuid);
      if (validas.length === 0) return factores;
      const filas = await db
        .selectFrom("version_de_opcion")
        .select(["id", "factor_de_tamano"])
        .where("empresa_id", "=", empresa)
        .where("id", "in", validas)
        .execute();
      for (const f of filas) factores.set(f.id, f.factor_de_tamano);
      return factores;
    },
  };
}
