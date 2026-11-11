import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import { esUuid } from "../../ventas/publico";
import type { SalonDb } from "./esquema";

/** Una unión confirmada: la cuenta de la mesa de origen queda ABIERTA y sin líneas (la «cuenta de reserva») hasta que se cobra o libera el destino. */
export type UnionDeMesas = Readonly<{
  id: string;
  sucursalId: string;
  cuentaDestinoId: string;
  mesaDestinoId: string;
  cuentaOrigenId: string;
  mesaOrigenId: string;
  clave: string;
  unidaPor: PersonaId;
  unidaEn: Date;
}>;

export type AltaDeUnion = UnionDeMesas;

/** Una división por ítems: la cuenta madre queda ABIERTA y sin líneas (la «cuenta de reserva») hasta que se cobra la última hija. */
export type DivisionDeCuenta = Readonly<{
  id: string;
  sucursalId: string;
  cuentaMadreId: string;
  mesaId: string;
  partes: number;
  divididaPor: PersonaId;
  divididaEn: Date;
}>;

export type ParteDeDivision = Readonly<{ divisionId: string; numero: number; cuentaId: string }>;

/**
 * Persistencia de las uniones y divisiones de cuentas (E7 §3.2). Todas son de SOLO inserción: nada se actualiza ni se borra. Todo corre dentro de la
 * transacción del caso de uso y filtra SIEMPRE por la empresa. Un id que no es un uuid no puede ser el de nada: «no existe».
 */
export interface RepositorioDeUnionesYDivisiones {
  /** `INSERT … ON CONFLICT DO NOTHING` (por id, por clave o por cuenta de origen); `true` si la insertó. */
  insertarUnion(empresa: EmpresaId, alta: AltaDeUnion): Promise<boolean>;
  unionPorId(empresa: EmpresaId, id: string): Promise<UnionDeMesas | null>;
  unionPorClave(empresa: EmpresaId, clave: string): Promise<UnionDeMesas | null>;
  /** La unión cuya cuenta de reserva es esta (la cuenta de origen). */
  unionPorOrigen(empresa: EmpresaId, cuentaOrigenId: string): Promise<UnionDeMesas | null>;
  /** Las uniones que dejaron ítems en esta cuenta. */
  unionesDeDestino(empresa: EmpresaId, cuentaDestinoId: string): Promise<UnionDeMesas[]>;
  /** Las cuentas de reserva de unión que sostienen estas mesas (en una lectura, para el mapa). */
  reservasDeUnion(empresa: EmpresaId, cuentaOrigenIds: readonly string[]): Promise<UnionDeMesas[]>;
  insertarLineaUnida(
    empresa: EmpresaId,
    alta: Readonly<{ lineaId: string; unionId: string; mesaOrigenId: string }>,
  ): Promise<void>;
  /** De qué mesa vino cada línea pasada por una unión (por id de línea). */
  lineasUnidas(
    empresa: EmpresaId,
    lineaIds: readonly string[],
  ): Promise<Map<string, Readonly<{ unionId: string; mesaOrigenId: string }>>>;

  insertarDivision(empresa: EmpresaId, alta: DivisionDeCuenta): Promise<boolean>;
  insertarParte(empresa: EmpresaId, alta: ParteDeDivision): Promise<void>;
  divisionPorId(empresa: EmpresaId, id: string): Promise<DivisionDeCuenta | null>;
  divisionPorMadre(empresa: EmpresaId, cuentaMadreId: string): Promise<DivisionDeCuenta | null>;
  /** La división de la que es hija esta cuenta, con su número de parte. */
  divisionPorHija(
    empresa: EmpresaId,
    cuentaId: string,
  ): Promise<Readonly<{ division: DivisionDeCuenta; numero: number }> | null>;
  partesDeDivision(empresa: EmpresaId, divisionId: string): Promise<ParteDeDivision[]>;
  /** Las divisiones cuya cuenta madre es una de estas (para el mapa). */
  divisionesPorMadres(
    empresa: EmpresaId,
    cuentaMadreIds: readonly string[],
  ): Promise<DivisionDeCuenta[]>;
}

type FilaDeUnion = Readonly<{
  id: string;
  sucursal_id: string;
  cuenta_destino_id: string;
  mesa_destino_id: string;
  cuenta_origen_id: string;
  mesa_origen_id: string;
  clave: string;
  unida_por: string;
  unida_en: Date;
}>;
const aUnion = (f: FilaDeUnion): UnionDeMesas => ({
  id: f.id,
  sucursalId: f.sucursal_id,
  cuentaDestinoId: f.cuenta_destino_id,
  mesaDestinoId: f.mesa_destino_id,
  cuentaOrigenId: f.cuenta_origen_id,
  mesaOrigenId: f.mesa_origen_id,
  clave: f.clave,
  unidaPor: f.unida_por as PersonaId,
  unidaEn: f.unida_en,
});

type FilaDeDivision = Readonly<{
  id: string;
  sucursal_id: string;
  cuenta_madre_id: string;
  mesa_id: string;
  partes: number;
  dividida_por: string;
  dividida_en: Date;
}>;
const aDivision = (f: FilaDeDivision): DivisionDeCuenta => ({
  id: f.id,
  sucursalId: f.sucursal_id,
  cuentaMadreId: f.cuenta_madre_id,
  mesaId: f.mesa_id,
  partes: f.partes,
  divididaPor: f.dividida_por as PersonaId,
  divididaEn: f.dividida_en,
});

export function crearRepositorioDeUnionesYDivisiones(
  db: Kysely<SalonDb>,
): RepositorioDeUnionesYDivisiones {
  const unionesSel = () =>
    db
      .selectFrom("union_de_mesas")
      .select([
        "id",
        "sucursal_id",
        "cuenta_destino_id",
        "mesa_destino_id",
        "cuenta_origen_id",
        "mesa_origen_id",
        "clave",
        "unida_por",
        "unida_en",
      ]);
  const divisionesSel = () =>
    db
      .selectFrom("division_de_cuenta")
      .select([
        "id",
        "sucursal_id",
        "cuenta_madre_id",
        "mesa_id",
        "partes",
        "dividida_por",
        "dividida_en",
      ]);
  return {
    async insertarUnion(empresa, alta) {
      const fila = await db
        .insertInto("union_de_mesas")
        .values({
          id: alta.id,
          empresa_id: empresa,
          sucursal_id: alta.sucursalId,
          cuenta_destino_id: alta.cuentaDestinoId,
          mesa_destino_id: alta.mesaDestinoId,
          cuenta_origen_id: alta.cuentaOrigenId,
          mesa_origen_id: alta.mesaOrigenId,
          clave: alta.clave,
          unida_por: alta.unidaPor,
          unida_en: alta.unidaEn,
        })
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      return fila !== undefined;
    },
    async unionPorId(empresa, id) {
      if (!esUuid(id)) return null;
      const f = await unionesSel()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return f === undefined ? null : aUnion(f);
    },
    async unionPorClave(empresa, clave) {
      const f = await unionesSel()
        .where("empresa_id", "=", empresa)
        .where("clave", "=", clave)
        .executeTakeFirst();
      return f === undefined ? null : aUnion(f);
    },
    async unionPorOrigen(empresa, cuentaOrigenId) {
      if (!esUuid(cuentaOrigenId)) return null;
      const f = await unionesSel()
        .where("empresa_id", "=", empresa)
        .where("cuenta_origen_id", "=", cuentaOrigenId)
        .executeTakeFirst();
      return f === undefined ? null : aUnion(f);
    },
    async unionesDeDestino(empresa, cuentaDestinoId) {
      if (!esUuid(cuentaDestinoId)) return [];
      const filas = await unionesSel()
        .where("empresa_id", "=", empresa)
        .where("cuenta_destino_id", "=", cuentaDestinoId)
        .orderBy("unida_en")
        .orderBy("id")
        .execute();
      return filas.map(aUnion);
    },
    async reservasDeUnion(empresa, cuentaOrigenIds) {
      const ids = cuentaOrigenIds.filter(esUuid);
      if (ids.length === 0) return [];
      const filas = await unionesSel()
        .where("empresa_id", "=", empresa)
        .where("cuenta_origen_id", "in", ids)
        .execute();
      return filas.map(aUnion);
    },
    async insertarLineaUnida(empresa, alta) {
      await db
        .insertInto("linea_unida")
        .values({
          empresa_id: empresa,
          linea_id: alta.lineaId,
          union_id: alta.unionId,
          mesa_origen_id: alta.mesaOrigenId,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    },
    async lineasUnidas(empresa, lineaIds) {
      const ids = lineaIds.filter(esUuid);
      const mapa = new Map<string, Readonly<{ unionId: string; mesaOrigenId: string }>>();
      if (ids.length === 0) return mapa;
      const filas = await db
        .selectFrom("linea_unida")
        .select(["linea_id", "union_id", "mesa_origen_id"])
        .where("empresa_id", "=", empresa)
        .where("linea_id", "in", ids)
        .execute();
      for (const f of filas)
        mapa.set(f.linea_id, { unionId: f.union_id, mesaOrigenId: f.mesa_origen_id });
      return mapa;
    },

    async insertarDivision(empresa, alta) {
      const fila = await db
        .insertInto("division_de_cuenta")
        .values({
          id: alta.id,
          empresa_id: empresa,
          sucursal_id: alta.sucursalId,
          cuenta_madre_id: alta.cuentaMadreId,
          mesa_id: alta.mesaId,
          partes: alta.partes,
          dividida_por: alta.divididaPor,
          dividida_en: alta.divididaEn,
        })
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      return fila !== undefined;
    },
    async insertarParte(empresa, alta) {
      await db
        .insertInto("parte_de_division")
        .values({
          empresa_id: empresa,
          division_id: alta.divisionId,
          numero: alta.numero,
          cuenta_id: alta.cuentaId,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    },
    async divisionPorId(empresa, id) {
      if (!esUuid(id)) return null;
      const f = await divisionesSel()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return f === undefined ? null : aDivision(f);
    },
    async divisionPorMadre(empresa, cuentaMadreId) {
      if (!esUuid(cuentaMadreId)) return null;
      const f = await divisionesSel()
        .where("empresa_id", "=", empresa)
        .where("cuenta_madre_id", "=", cuentaMadreId)
        .executeTakeFirst();
      return f === undefined ? null : aDivision(f);
    },
    async divisionPorHija(empresa, cuentaId) {
      if (!esUuid(cuentaId)) return null;
      const filas = await sql<FilaDeDivision & { numero: number }>`
        select d.id, d.sucursal_id, d.cuenta_madre_id, d.mesa_id, d.partes, d.dividida_por, d.dividida_en, p.numero
          from parte_de_division p
          join division_de_cuenta d on d.empresa_id = p.empresa_id and d.id = p.division_id
         where p.empresa_id = ${empresa} and p.cuenta_id = ${cuentaId}`.execute(db);
      const f = filas.rows[0];
      return f === undefined ? null : { division: aDivision(f), numero: f.numero };
    },
    async partesDeDivision(empresa, divisionId) {
      if (!esUuid(divisionId)) return [];
      const filas = await db
        .selectFrom("parte_de_division")
        .select(["division_id", "numero", "cuenta_id"])
        .where("empresa_id", "=", empresa)
        .where("division_id", "=", divisionId)
        .orderBy("numero")
        .execute();
      return filas.map((f) => ({
        divisionId: f.division_id,
        numero: f.numero,
        cuentaId: f.cuenta_id,
      }));
    },
    async divisionesPorMadres(empresa, cuentaMadreIds) {
      const ids = cuentaMadreIds.filter(esUuid);
      if (ids.length === 0) return [];
      const filas = await divisionesSel()
        .where("empresa_id", "=", empresa)
        .where("cuenta_madre_id", "in", ids)
        .execute();
      return filas.map(aDivision);
    },
  };
}
