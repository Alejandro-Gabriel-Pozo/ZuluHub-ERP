import { sql, type Kysely } from "kysely";
import type { AlcanceDeSucursales } from "../../../capacidades/permisos/alcance";
import type { EmpresaId, PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { insertarIdempotente } from "../../catalogo/publico";
import type { StockDb } from "./esquema";
import { aConteo, aRegistroDeConteo, esUuid } from "./filas";
import type { Conteo, EstadoDeConteo, RegistroGuardado } from "./modelo";

export type AltaDeConteo = Readonly<{
  /** Lo manda la aplicación: es la idempotencia de abrirlo. */
  id: string;
  depositoId: string;
  abiertoPor: PersonaId;
  abiertoEn: Date;
}>;

export type AltaDeRegistro = Readonly<{
  /** Lo manda la aplicación: es la idempotencia del registro. */
  id: string;
  conteoId: string;
  articuloId: string;
  /** Texto decimal exacto, en la unidad de stock; no negativo. */
  cantidadContada: string;
  registradoPor: PersonaId;
  registradoEn: Date;
}>;

export type ResolucionDeConteo = Readonly<{
  estado: Exclude<EstadoDeConteo, "ABIERTO">;
  resueltoPor: PersonaId;
  resueltoEn: Date;
  /** Obligatorio al cancelar (la base lo exige), nulo al aplicar. */
  motivo: string | null;
}>;

export type FiltroDeConteos = Readonly<{
  alcance: AlcanceDeSucursales;
  depositoId?: string | undefined;
  estado?: EstadoDeConteo | undefined;
  limite: number;
}>;

export interface RepositorioDeConteos {
  obtener(empresa: EmpresaId, id: string): Promise<Conteo | null>;
  /** El conteo con `SELECT … FOR UPDATE`: serializa aplicar, cancelar y registrar sobre el mismo conteo. */
  bloquear(empresa: EmpresaId, id: string): Promise<Conteo | null>;
  /** El conteo abierto del depósito (a lo sumo uno), o `null`. */
  abiertoDe(empresa: EmpresaId, depositoId: string): Promise<Conteo | null>;
  /**
   * `INSERT … ON CONFLICT DO NOTHING` por el `id`: `true` si insertó, `false` si ya existía. Un segundo conteo abierto en el depósito NO es un
   * conflicto del id: sale como error de unicidad (`conteo_fisico_abierto_uk`).
   */
  insertar(empresa: EmpresaId, alta: AltaDeConteo): Promise<boolean>;
  /**
   * `UPDATE … WHERE estado = 'ABIERTO'`: de dos resoluciones a la vez gana una. `null` si el conteo no existe o ya no estaba abierto.
   * Aplicar un conteo sin registros lo rechaza la base (`conteo_fisico_sin_registros`).
   */
  resolver(empresa: EmpresaId, id: string, resolucion: ResolucionDeConteo): Promise<Conteo | null>;
  obtenerRegistro(empresa: EmpresaId, id: string): Promise<RegistroGuardado | null>;
  /** `true` si insertó, `false` si ya había un registro con ese id. Recontar es un registro nuevo (otro id). */
  insertarRegistro(empresa: EmpresaId, alta: AltaDeRegistro): Promise<boolean>;
  /** Todos los registros del conteo, del más viejo al más nuevo (`orden`). */
  registrosDe(empresa: EmpresaId, conteoId: string): Promise<RegistroGuardado[]>;
  /** Los conteos que el alcance deja ver, del más nuevo al más viejo. */
  listar(empresa: EmpresaId, filtro: FiltroDeConteos): Promise<Conteo[]>;
  /** Cuántos conteos hay abiertos en esa sucursal (para el aporte al cierre del día). */
  contarAbiertosDe(empresa: EmpresaId, sucursal: SucursalId): Promise<number>;
}

export function crearRepositorioDeConteos(db: Kysely<StockDb>): RepositorioDeConteos {
  return {
    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await db
        .selectFrom("conteo_fisico")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aConteo(fila);
    },
    async bloquear(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await db
        .selectFrom("conteo_fisico")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .forUpdate()
        .executeTakeFirst();
      return fila === undefined ? null : aConteo(fila);
    },
    async abiertoDe(empresa, depositoId) {
      if (!esUuid(depositoId)) return null;
      const fila = await db
        .selectFrom("conteo_fisico")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("deposito_id", "=", depositoId)
        .where("estado", "=", "ABIERTO")
        .executeTakeFirst();
      return fila === undefined ? null : aConteo(fila);
    },
    async insertar(empresa, alta) {
      const alta_ = () =>
        db.insertInto("conteo_fisico").values({
          id: alta.id,
          empresa_id: empresa,
          deposito_id: alta.depositoId,
          abierto_por: alta.abiertoPor,
          abierto_en: alta.abiertoEn,
        });
      const fila = await insertarIdempotente(
        () =>
          alta_()
            .onConflict((oc) => oc.doNothing())
            .returning("id")
            .executeTakeFirst(),
        async () =>
          (await db
            .selectFrom("conteo_fisico")
            .select("id")
            .where("empresa_id", "=", empresa)
            .where("id", "=", alta.id)
            .executeTakeFirst()) !== undefined,
        () => alta_().returning("id").executeTakeFirstOrThrow(),
      );
      return fila !== undefined;
    },
    async resolver(empresa, id, resolucion) {
      if (!esUuid(id)) return null;
      const fila = await db
        .updateTable("conteo_fisico")
        .set({
          estado: resolucion.estado,
          resuelto_por: resolucion.resueltoPor,
          resuelto_en: resolucion.resueltoEn,
          motivo: resolucion.motivo,
        })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "ABIERTO")
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aConteo(fila);
    },
    async obtenerRegistro(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await db
        .selectFrom("conteo_registro")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aRegistroDeConteo(fila);
    },
    async insertarRegistro(empresa, alta) {
      const alta_ = () =>
        db.insertInto("conteo_registro").values({
          id: alta.id,
          empresa_id: empresa,
          conteo_id: alta.conteoId,
          articulo_id: alta.articuloId,
          cantidad_contada: alta.cantidadContada,
          registrado_por: alta.registradoPor,
          registrado_en: alta.registradoEn,
        });
      const fila = await insertarIdempotente(
        () =>
          alta_()
            .onConflict((oc) => oc.doNothing())
            .returning("id")
            .executeTakeFirst(),
        async () =>
          (await db
            .selectFrom("conteo_registro")
            .select("id")
            .where("empresa_id", "=", empresa)
            .where("id", "=", alta.id)
            .executeTakeFirst()) !== undefined,
        () => alta_().returning("id").executeTakeFirstOrThrow(),
      );
      return fila !== undefined;
    },
    async registrosDe(empresa, conteoId) {
      if (!esUuid(conteoId)) return [];
      const filas = await db
        .selectFrom("conteo_registro")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("conteo_id", "=", conteoId)
        .orderBy("orden")
        .execute();
      return filas.map(aRegistroDeConteo);
    },
    async listar(empresa, filtro) {
      if (filtro.alcance !== "TODAS" && filtro.alcance.length === 0) return [];
      let consulta = db
        .selectFrom("conteo_fisico as c")
        .innerJoin("deposito as d", (j) =>
          j.onRef("d.id", "=", "c.deposito_id").onRef("d.empresa_id", "=", "c.empresa_id"),
        )
        .selectAll("c")
        .where("c.empresa_id", "=", empresa);
      if (filtro.alcance !== "TODAS") {
        consulta = consulta.where("d.sucursal_id", "in", [...filtro.alcance]);
      }
      if (filtro.depositoId !== undefined) {
        if (!esUuid(filtro.depositoId)) return [];
        consulta = consulta.where("c.deposito_id", "=", filtro.depositoId);
      }
      if (filtro.estado !== undefined) consulta = consulta.where("c.estado", "=", filtro.estado);
      const filas = await consulta
        .orderBy("c.abierto_en", "desc")
        .orderBy("c.id", "desc")
        .limit(filtro.limite)
        .execute();
      return filas.map(aConteo);
    },
    async contarAbiertosDe(empresa, sucursal) {
      const { rows } = await sql<{ n: string }>`
        select count(*)::text as n
          from conteo_fisico c
          join deposito d on d.id = c.deposito_id and d.empresa_id = c.empresa_id
         where c.empresa_id = ${empresa} and d.sucursal_id = ${sucursal}::uuid and c.estado = 'ABIERTO'`.execute(
        db,
      );
      return Number(rows[0]?.n ?? "0");
    },
  };
}
