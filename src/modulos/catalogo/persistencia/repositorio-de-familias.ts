import { sql, type Kysely, type Selectable } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { CatalogoDb } from "./esquema";
import { FORMA_DE_UUID } from "./filas";
import { insertarIdempotente } from "./insertar-idempotente";

export type Familia = Readonly<{
  id: string;
  nombre: string;
  nombreClave: string;
  agruparEnCarta: boolean;
  agruparEnPos: boolean;
  activa: boolean;
  version: number;
}>;

export type MiembroDeFamilia = Readonly<{
  id: string;
  familiaId: string;
  productoId: string;
  posicion: number;
}>;

export type AltaDeFamilia = Readonly<{
  id: string;
  nombre: string;
  nombreClave: string;
  creadoPor: PersonaId | null;
}>;

export type CambiosDeFamilia = Readonly<{
  nombre: string;
  nombreClave: string;
  agruparEnCarta: boolean;
  agruparEnPos: boolean;
  activa: boolean;
}>;

export type FamiliaConMiembros = Readonly<{ familia: Familia; miembros: number }>;

/**
 * Las familias de productos (A8; 0079). Todo filtra por empresa y corre en la transacción de quien llama (que autoriza y audita). Nada se borra: una familia se
 * desactiva y un miembro se quita con fecha y autor (volver a agregarlo es una fila nueva). La unicidad «un producto, una familia» la impone la base (índice
 * parcial); la posición la asigna quien llama con la familia bloqueada.
 */
export interface RepositorioDeFamilias {
  obtener(empresa: EmpresaId, id: string): Promise<Familia | null>;
  /** Como `obtener`, tomando la fila (`FOR UPDATE`): serializa a quienes cambian la misma familia. */
  bloquear(empresa: EmpresaId, id: string): Promise<Familia | null>;
  /** `false` si ya había una familia con ese `id` (la repetición). El nombre repetido lo rechaza la base (`familia_nombre_uk`). */
  insertar(empresa: EmpresaId, alta: AltaDeFamilia): Promise<boolean>;
  /** Cambia solo si la versión es la esperada; `null` si ya no lo es (o no es de la empresa). */
  actualizar(
    empresa: EmpresaId,
    id: string,
    versionEsperada: number,
    cambios: CambiosDeFamilia,
  ): Promise<Familia | null>;
  /** Sube la versión de la familia sin cambiar nada más: cada alta o baja de un miembro invalida a quien miraba la familia antes. */
  tocar(empresa: EmpresaId, id: string): Promise<Familia | null>;
  /** Todas las familias (activas o no) con cuántos miembros vigentes tienen, por nombre. */
  todas(empresa: EmpresaId): Promise<readonly FamiliaConMiembros[]>;
  /** Los miembros vigentes de la familia, en su orden. */
  miembrosVigentes(empresa: EmpresaId, familiaId: string): Promise<readonly MiembroDeFamilia[]>;
  /** El vínculo vigente del producto con cualquier familia, o `null`. */
  vinculoVigenteDelProducto(
    empresa: EmpresaId,
    productoId: string,
  ): Promise<MiembroDeFamilia | null>;
  agregarMiembro(
    empresa: EmpresaId,
    alta: Readonly<{
      familiaId: string;
      productoId: string;
      posicion: number;
      agregadoPor: PersonaId | null;
      agregadoEn: Date;
    }>,
  ): Promise<MiembroDeFamilia>;
  /** Marca el vínculo vigente como terminado; `false` si no había ninguno en esa familia. */
  quitarMiembro(
    empresa: EmpresaId,
    quitar: Readonly<{
      familiaId: string;
      productoId: string;
      quitadoPor: PersonaId | null;
      quitadoEn: Date;
    }>,
  ): Promise<boolean>;
}

const esUuid = (texto: string): boolean => FORMA_DE_UUID.test(texto);

type FilaDeFamilia = Selectable<CatalogoDb["familia_de_producto"]>;
const aFamilia = (f: FilaDeFamilia): Familia => ({
  id: f.id,
  nombre: f.nombre,
  nombreClave: f.nombre_clave,
  agruparEnCarta: f.agrupar_en_carta,
  agruparEnPos: f.agrupar_en_pos,
  activa: f.activa,
  version: f.version,
});

type FilaDeMiembro = Selectable<CatalogoDb["miembro_de_familia"]>;
const aMiembro = (f: FilaDeMiembro): MiembroDeFamilia => ({
  id: f.id,
  familiaId: f.familia_id,
  productoId: f.producto_id,
  posicion: f.posicion,
});

export function crearRepositorioDeFamilias(db: Kysely<CatalogoDb>): RepositorioDeFamilias {
  async function leer(empresa: EmpresaId, id: string, bloquear: boolean) {
    if (!esUuid(id)) return null;
    let consulta = db
      .selectFrom("familia_de_producto")
      .selectAll()
      .where("empresa_id", "=", empresa)
      .where("id", "=", id);
    if (bloquear) consulta = consulta.forUpdate();
    const f = await consulta.executeTakeFirst();
    return f === undefined ? null : aFamilia(f);
  }
  return {
    obtener: (empresa, id) => leer(empresa, id, false),
    bloquear: (empresa, id) => leer(empresa, id, true),
    async insertar(empresa, alta) {
      const nueva = () =>
        db.insertInto("familia_de_producto").values({
          id: alta.id,
          empresa_id: empresa,
          nombre: alta.nombre,
          nombre_clave: alta.nombreClave,
          creado_por: alta.creadoPor,
        });
      const f = await insertarIdempotente(
        () =>
          nueva()
            .onConflict((oc) => oc.doNothing())
            .returning("id")
            .executeTakeFirst(),
        async () =>
          (await db
            .selectFrom("familia_de_producto")
            .select("id")
            .where("empresa_id", "=", empresa)
            .where("id", "=", alta.id)
            .executeTakeFirst()) !== undefined,
        () => nueva().returning("id").executeTakeFirstOrThrow(),
      );
      return f !== undefined;
    },
    async actualizar(empresa, id, versionEsperada, cambios) {
      if (!esUuid(id)) return null;
      const f = await db
        .updateTable("familia_de_producto")
        .set({
          nombre: cambios.nombre,
          nombre_clave: cambios.nombreClave,
          agrupar_en_carta: cambios.agruparEnCarta,
          agrupar_en_pos: cambios.agruparEnPos,
          activa: cambios.activa,
        })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      return f === undefined ? null : aFamilia(f);
    },
    async tocar(empresa, id) {
      if (!esUuid(id)) return null;
      const f = await db
        .updateTable("familia_de_producto")
        .set({ activa: sql<boolean>`activa` })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      return f === undefined ? null : aFamilia(f);
    },
    async todas(empresa) {
      const filas = await db
        .selectFrom("familia_de_producto as f")
        .leftJoin("miembro_de_familia as m", (join) =>
          join
            .onRef("m.familia_id", "=", "f.id")
            .onRef("m.empresa_id", "=", "f.empresa_id")
            .on("m.quitado_en", "is", null),
        )
        .selectAll("f")
        .select(sql<string>`count(m.id)`.as("miembros"))
        .where("f.empresa_id", "=", empresa)
        .groupBy("f.id")
        .orderBy("f.nombre_clave")
        .orderBy("f.id")
        .execute();
      return filas.map((f) => ({ familia: aFamilia(f), miembros: Number(f.miembros) }));
    },
    async miembrosVigentes(empresa, familiaId) {
      if (!esUuid(familiaId)) return [];
      const filas = await db
        .selectFrom("miembro_de_familia")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("familia_id", "=", familiaId)
        .where("quitado_en", "is", null)
        .orderBy("posicion")
        .orderBy("id")
        .execute();
      return filas.map(aMiembro);
    },
    async vinculoVigenteDelProducto(empresa, productoId) {
      if (!esUuid(productoId)) return null;
      const f = await db
        .selectFrom("miembro_de_familia")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", productoId)
        .where("quitado_en", "is", null)
        .executeTakeFirst();
      return f === undefined ? null : aMiembro(f);
    },
    async agregarMiembro(empresa, alta) {
      const f = await db
        .insertInto("miembro_de_familia")
        .values({
          empresa_id: empresa,
          familia_id: alta.familiaId,
          producto_id: alta.productoId,
          posicion: alta.posicion,
          agregado_por: alta.agregadoPor,
          agregado_en: alta.agregadoEn,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aMiembro(f);
    },
    async quitarMiembro(empresa, quitar) {
      const f = await db
        .updateTable("miembro_de_familia")
        .set({ quitado_por: quitar.quitadoPor, quitado_en: quitar.quitadoEn })
        .where("empresa_id", "=", empresa)
        .where("familia_id", "=", quitar.familiaId)
        .where("producto_id", "=", quitar.productoId)
        .where("quitado_en", "is", null)
        .returning("id")
        .executeTakeFirst();
      return f !== undefined;
    },
  };
}
