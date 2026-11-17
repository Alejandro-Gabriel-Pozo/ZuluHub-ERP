import type { Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { FamiliaParaRenglones, ProductoParaRenglones } from "../dominio/renglones-de-seccion";
import type { CatalogoDb } from "./esquema";
import { FORMA_DE_UUID } from "./filas";

const esUuid = (texto: string): boolean => FORMA_DE_UUID.test(texto);

export type ModoDeOrden = "ALFABETICO" | "A_MANO";

/** El orden de los renglones de una sección: su modo y la versión de ese orden (control optimista de «reordenar»). */
export type OrdenDeSeccion = Readonly<{
  id: string;
  activa: boolean;
  modo: ModoDeOrden;
  version: number;
}>;

export type ProductoLeidoParaRenglones = ProductoParaRenglones &
  Readonly<{ orden: number | null; destacado: boolean }>;
export type FamiliaLeidaParaRenglones = FamiliaParaRenglones &
  Readonly<{ orden: number; destacada: boolean }>;

/** El orden y la estrella (★) del orden de la carta: todo por EMPRESA (DDD 69). */
export interface RepositorioDeOrdenDeCarta {
  /** La sección tomada `FOR UPDATE`: dos reordenamientos a la vez se ponen en fila. `null` si no es de la empresa. */
  bloquearOrdenDeSeccion(empresa: EmpresaId, seccionId: string): Promise<OrdenDeSeccion | null>;
  /** Cambia el modo y sube la versión del orden en uno; `false` si la versión ya no es la esperada. */
  fijarOrdenDeSeccion(
    empresa: EmpresaId,
    seccionId: string,
    versionEsperada: number,
    modo: ModoDeOrden,
  ): Promise<boolean>;
  /** Los productos activos que se venden de la sección, con su lugar y su estrella. */
  productosDeLaSeccion(
    empresa: EmpresaId,
    seccionId: string,
  ): Promise<readonly ProductoLeidoParaRenglones[]>;
  /** Todas las familias con sus miembros vigentes (y la sección de cada uno), su lugar y su estrella. */
  familiasConMiembros(empresa: EmpresaId): Promise<readonly FamiliaLeidaParaRenglones[]>;
  /** El lugar (`orden`) de un renglón; en un producto, crea la fila si no la había (nunca pisa la estrella). */
  ponerOrden(
    empresa: EmpresaId,
    renglon: Readonly<{ tipo: "PRODUCTO" | "FAMILIA"; id: string }>,
    orden: number,
    quien: Readonly<{ por: PersonaId | null; en: Date }>,
  ): Promise<void>;
  /** La estrella de un renglón (estado, no alterna); en un producto, crea la fila si no la había (nunca pisa el lugar). */
  ponerEstrella(
    empresa: EmpresaId,
    renglon: Readonly<{ tipo: "PRODUCTO" | "FAMILIA"; id: string }>,
    destacado: boolean,
    quien: Readonly<{ por: PersonaId | null; en: Date }>,
  ): Promise<void>;
  /** La estrella de un producto (`false` si no tiene fila). */
  estrellaDelProducto(empresa: EmpresaId, productoId: string): Promise<boolean>;
  /** La estrella de una familia (`null` si no es de la empresa). */
  estrellaDeLaFamilia(empresa: EmpresaId, familiaId: string): Promise<boolean | null>;
}

export function crearRepositorioDeOrdenDeCarta(db: Kysely<CatalogoDb>): RepositorioDeOrdenDeCarta {
  return {
    async bloquearOrdenDeSeccion(empresa, seccionId) {
      if (!esUuid(seccionId)) return null;
      const f = await db
        .selectFrom("seccion_de_carta")
        .select(["id", "activa", "orden_de_renglones", "version_del_orden"])
        .where("empresa_id", "=", empresa)
        .where("id", "=", seccionId)
        .forUpdate()
        .executeTakeFirst();
      if (f === undefined) return null;
      return {
        id: f.id,
        activa: f.activa,
        modo: f.orden_de_renglones === "A_MANO" ? "A_MANO" : "ALFABETICO",
        version: f.version_del_orden,
      };
    },
    async fijarOrdenDeSeccion(empresa, seccionId, versionEsperada, modo) {
      const f = await db
        .updateTable("seccion_de_carta")
        .set({ orden_de_renglones: modo, version_del_orden: versionEsperada + 1 })
        .where("empresa_id", "=", empresa)
        .where("id", "=", seccionId)
        .where("version_del_orden", "=", versionEsperada)
        .returning("id")
        .executeTakeFirst();
      return f !== undefined;
    },
    async productosDeLaSeccion(empresa, seccionId) {
      if (!esUuid(seccionId)) return [];
      const filas = await db
        .selectFrom("producto as p")
        .leftJoin("lugar_en_carta_de_producto as l", (join) =>
          join.onRef("l.producto_id", "=", "p.id").onRef("l.empresa_id", "=", "p.empresa_id"),
        )
        .select(["p.id", "p.nombre", "p.seccion_de_carta_id", "l.orden", "l.destacado"])
        .where("p.empresa_id", "=", empresa)
        .where("p.seccion_de_carta_id", "=", seccionId)
        .where("p.activo", "=", true)
        .where("p.se_vende", "=", true)
        .execute();
      return filas.map((f) => ({
        id: f.id,
        nombre: f.nombre,
        seccionId: f.seccion_de_carta_id,
        orden: f.orden,
        destacado: f.destacado ?? false,
      }));
    },
    async familiasConMiembros(empresa) {
      const familias = await db
        .selectFrom("familia_de_producto")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .execute();
      const miembros = await db
        .selectFrom("miembro_de_familia as m")
        .innerJoin("producto as p", (join) =>
          join.onRef("p.id", "=", "m.producto_id").onRef("p.empresa_id", "=", "m.empresa_id"),
        )
        .select(["m.familia_id", "m.producto_id", "p.seccion_de_carta_id"])
        .where("m.empresa_id", "=", empresa)
        .where("m.quitado_en", "is", null)
        .orderBy("m.posicion")
        .execute();
      return familias.map((f) => ({
        id: f.id,
        nombre: f.nombre,
        activa: f.activa,
        agruparEnCarta: f.agrupar_en_carta,
        orden: f.orden,
        destacada: f.destacada,
        miembros: miembros
          .filter((m) => m.familia_id === f.id)
          .map((m) => ({ productoId: m.producto_id, seccionId: m.seccion_de_carta_id })),
      }));
    },
    async ponerOrden(empresa, renglon, orden, quien) {
      if (renglon.tipo === "FAMILIA") {
        await db
          .updateTable("familia_de_producto")
          .set({ orden })
          .where("empresa_id", "=", empresa)
          .where("id", "=", renglon.id)
          .execute();
        return;
      }
      const hubo = await db
        .updateTable("lugar_en_carta_de_producto")
        .set({ orden, actualizado_por: quien.por, actualizado_en: quien.en })
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", renglon.id)
        .returning("producto_id")
        .executeTakeFirst();
      if (hubo !== undefined) return;
      await db
        .insertInto("lugar_en_carta_de_producto")
        .values({
          empresa_id: empresa,
          producto_id: renglon.id,
          orden,
          actualizado_por: quien.por,
          actualizado_en: quien.en,
        })
        .execute();
    },
    async ponerEstrella(empresa, renglon, destacado, quien) {
      if (renglon.tipo === "FAMILIA") {
        await db
          .updateTable("familia_de_producto")
          .set({ destacada: destacado })
          .where("empresa_id", "=", empresa)
          .where("id", "=", renglon.id)
          .execute();
        return;
      }
      const hubo = await db
        .updateTable("lugar_en_carta_de_producto")
        .set({ destacado, actualizado_por: quien.por, actualizado_en: quien.en })
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", renglon.id)
        .returning("producto_id")
        .executeTakeFirst();
      if (hubo !== undefined) return;
      await db
        .insertInto("lugar_en_carta_de_producto")
        .values({
          empresa_id: empresa,
          producto_id: renglon.id,
          destacado,
          actualizado_por: quien.por,
          actualizado_en: quien.en,
        })
        .execute();
    },
    async estrellaDelProducto(empresa, productoId) {
      if (!esUuid(productoId)) return false;
      const f = await db
        .selectFrom("lugar_en_carta_de_producto")
        .select("destacado")
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", productoId)
        .executeTakeFirst();
      return f?.destacado ?? false;
    },
    async estrellaDeLaFamilia(empresa, familiaId) {
      if (!esUuid(familiaId)) return null;
      const f = await db
        .selectFrom("familia_de_producto")
        .select("destacada")
        .where("empresa_id", "=", empresa)
        .where("id", "=", familiaId)
        .executeTakeFirst();
      return f === undefined ? null : f.destacada;
    },
  };
}
