import type { Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { CatalogoDb } from "./esquema";

/** Lo que la carta mira de cada producto que se vende, para decidir si sale y, si no, por qué (carta real §4.3 y §6.2). */
export type ProductoParaLaCarta = Readonly<{
  id: string;
  nombre: string;
  activo: boolean;
  /** `null` = el producto no tiene sección; `false` = tiene una sección apagada. */
  seccionActiva: boolean | null;
}>;

/** Lectura de solo lectura para la carta: los productos que se venden (productos vendibles y de reventa) con el estado de su sección. */
export interface LectorDeCarta {
  productosQueSeVenden(empresa: EmpresaId): Promise<readonly ProductoParaLaCarta[]>;
}

export function crearLectorDeCarta(db: Kysely<CatalogoDb>): LectorDeCarta {
  return {
    async productosQueSeVenden(empresa) {
      const filas = await db
        .selectFrom("producto as p")
        .leftJoin("seccion_de_carta as s", (j) =>
          j.onRef("s.id", "=", "p.seccion_de_carta_id").onRef("s.empresa_id", "=", "p.empresa_id"),
        )
        .select(["p.id", "p.nombre", "p.activo", "p.seccion_de_carta_id", "s.activa"])
        .where("p.empresa_id", "=", empresa)
        .where("p.clase_de_uso", "in", ["VENDIBLE", "REVENTA"])
        .orderBy("p.nombre_clave")
        .orderBy("p.id")
        .execute();
      return filas.map((f) => ({
        id: f.id,
        nombre: f.nombre,
        activo: f.activo,
        seccionActiva: f.seccion_de_carta_id === null ? null : f.activa === true,
      }));
    },
  };
}
