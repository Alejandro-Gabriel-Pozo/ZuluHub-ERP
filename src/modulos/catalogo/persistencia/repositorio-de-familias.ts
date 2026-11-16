import { sql, type Kysely, type Selectable } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { CatalogoDb } from "./esquema";
import { FORMA_DE_UUID } from "./filas";
import type { FamiliaParaRenglones, ProductoParaRenglones } from "../dominio/renglones-de-seccion";
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
export interface RepositorioDeFamilias extends RepositorioDeOrdenDeCarta {
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
