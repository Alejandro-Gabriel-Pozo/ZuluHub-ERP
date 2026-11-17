import { sql, type Kysely } from "kysely";
import {
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import { insertarIdempotente } from "../../catalogo/publico";
import { esUuid } from "../../ventas/publico";
import type { FormaDeMesa, TamanoDeMesa } from "../dominio/mesa";
import type { CasillaDeMesa } from "../dominio/celdas";
import type { SalonDb } from "./esquema";

/** Una mesa tal como está guardada. El estado (libre, en pedido…) NO se guarda: se deriva de sus cuentas (E7 §3.6). */
export type Mesa = Readonly<{
  id: string;
  sucursalId: SucursalId;
  numero: number;
  forma: FormaDeMesa;
  tamano: TamanoDeMesa;
  columna: number;
  fila: number;
  activa: boolean;
  creadaPor: PersonaId;
  creadaEn: Date;
  version: number;
}>;

export type AltaDeMesa = Readonly<{
  id: string;
  sucursalId: SucursalId;
  numero: number;
  forma: FormaDeMesa;
  tamano: TamanoDeMesa;
  columna: number;
  fila: number;
  creadaPor: PersonaId;
  creadaEn: Date;
}>;

export type CambioDeMesa = Readonly<{
  numero: number;
  forma: FormaDeMesa;
  tamano: TamanoDeMesa;
  columna: number;
  fila: number;
}>;

/**
 * Persistencia de las mesas y sus casillas (E7 §3.2). Todo corre dentro de la transacción del caso de uso, filtra SIEMPRE por la empresa (y la RLS lo
 * repite) y no usa caché. Un id que no es un uuid no puede ser el de nada: «no existe».
 */
export interface RepositorioDeMesas {
  /** `INSERT … ON CONFLICT DO NOTHING` por id; `true` si la insertó. Un número repetido en la sucursal propaga el error de unicidad (`mesa_numero_uk`). */
  insertar(empresa: EmpresaId, alta: AltaDeMesa): Promise<boolean>;
  obtener(empresa: EmpresaId, id: string): Promise<Mesa | null>;
  /** Varias mesas por id en UNA lectura. */
  obtenerVarias(empresa: EmpresaId, ids: readonly string[]): Promise<Mesa[]>;
  /** Las mesas de la sucursal por número. */
  listar(empresa: EmpresaId, sucursal: SucursalId, incluirInactivas: boolean): Promise<Mesa[]>;
  /** Cambia los datos de una mesa SI su versión es la esperada (optimistic locking); `false` si otro la cambió antes. */
  cambiar(
    empresa: EmpresaId,
    id: string,
    cambio: CambioDeMesa,
    versionEsperada: number,
  ): Promise<boolean>;
  /** Activa o desactiva SI su versión es la esperada; `false` si otro la cambió antes. */
  fijarActiva(
    empresa: EmpresaId,
    id: string,
    activa: boolean,
    versionEsperada: number,
  ): Promise<boolean>;
  /** Las casillas ACTIVAS de otras mesas de la sucursal (con su número) que pisan estas, para decir con cuál se superpone. */
  mesasQuePisan(
    empresa: EmpresaId,
    sucursal: SucursalId,
    excepto: string | null,
    casillas: readonly CasillaDeMesa[],
  ): Promise<number[]>;
  /** Marca como inactivas las casillas de la mesa (nunca se borran). */
  liberarCasillas(empresa: EmpresaId, sucursal: SucursalId, mesaId: string): Promise<void>;
  /** Activa estas casillas para la mesa (inserta la que no existía, reactiva la que sí). La única parcial de la base impide que dos mesas activas la compartan. */
  ocuparCasillas(
    empresa: EmpresaId,
    sucursal: SucursalId,
    mesaId: string,
    casillas: readonly CasillaDeMesa[],
  ): Promise<void>;
}

type FilaDeMesa = Readonly<{
  id: string;
  sucursal_id: string;
  numero: number;
  forma: string;
  tamano: string;
  columna: number;
  fila: number;
  activa: boolean;
  creada_por: string;
  creada_en: Date;
  version: number;
}>;

const aMesa = (f: FilaDeMesa): Mesa => ({
  id: f.id,
  sucursalId: sucursalId(f.sucursal_id),
  numero: f.numero,
  forma: f.forma as FormaDeMesa,
  tamano: f.tamano as TamanoDeMesa,
  columna: f.columna,
  fila: f.fila,
  activa: f.activa,
  creadaPor: personaId(f.creada_por),
  creadaEn: f.creada_en,
  version: f.version,
});

export function crearRepositorioDeMesas(db: Kysely<SalonDb>): RepositorioDeMesas {
  const seleccionar = () =>
    db
      .selectFrom("mesa")
      .select([
        "id",
        "sucursal_id",
        "numero",
        "forma",
        "tamano",
        "columna",
        "fila",
        "activa",
        "creada_por",
        "creada_en",
        "version",
      ]);
  return {
    async insertar(empresa, alta) {
      const armar = () =>
        db.insertInto("mesa").values({
          id: alta.id,
          empresa_id: empresa,
          sucursal_id: alta.sucursalId,
          numero: alta.numero,
          forma: alta.forma,
          tamano: alta.tamano,
          columna: alta.columna,
          fila: alta.fila,
          creada_por: alta.creadaPor,
          creada_en: alta.creadaEn,
        });
      const fila = await insertarIdempotente(
        () =>
          armar()
            .onConflict((oc) => oc.column("id").doNothing())
            .returning("id")
            .executeTakeFirst(),
        async () =>
          (await db
            .selectFrom("mesa")
            .select("id")
            .where("empresa_id", "=", empresa)
            .where("id", "=", alta.id)
            .executeTakeFirst()) !== undefined,
        () => armar().returning("id").executeTakeFirstOrThrow(),
      );
      return fila !== undefined;
    },

    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aMesa(fila);
    },

    async obtenerVarias(empresa, ids) {
      const validos = ids.filter(esUuid);
      if (validos.length === 0) return [];
      const filas = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("id", "in", validos)
        .orderBy("numero")
        .execute();
      return filas.map(aMesa);
    },

    async listar(empresa, sucursal, incluirInactivas) {
      let consulta = seleccionar()
        .where("empresa_id", "=", empresa)
        .where("sucursal_id", "=", sucursal);
      if (!incluirInactivas) consulta = consulta.where("activa", "=", true);
      return (await consulta.orderBy("numero").execute()).map(aMesa);
    },

    async cambiar(empresa, id, cambio, versionEsperada) {
      if (!esUuid(id)) return false;
      const r = await db
        .updateTable("mesa")
        .set({
          numero: cambio.numero,
          forma: cambio.forma,
          tamano: cambio.tamano,
          columna: cambio.columna,
          fila: cambio.fila,
        })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async fijarActiva(empresa, id, activa, versionEsperada) {
      if (!esUuid(id)) return false;
      const r = await db
        .updateTable("mesa")
        .set({ activa })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async mesasQuePisan(empresa, sucursal, excepto, casillas) {
      if (casillas.length === 0) return [];
      const pares = casillas.map((c) => sql`(${c.columna}, ${c.fila})`);
      const filas = await sql<{ numero: number }>`
        select distinct m.numero
          from mesa_celda c
          join mesa m on m.empresa_id = c.empresa_id and m.id = c.mesa_id
         where c.empresa_id = ${empresa} and c.sucursal_id = ${sucursal} and c.activa
           and (${excepto}::uuid is null or c.mesa_id <> ${excepto}::uuid)
           and (c.columna, c.fila) in (${sql.join(pares)})
         order by m.numero`.execute(db);
      return filas.rows.map((f) => f.numero);
    },

    async liberarCasillas(empresa, sucursal, mesaId) {
      await db
        .updateTable("mesa_celda")
        .set({ activa: false })
        .where("empresa_id", "=", empresa)
        .where("sucursal_id", "=", sucursal)
        .where("mesa_id", "=", mesaId)
        .where("activa", "=", true)
        .execute();
    },

    async ocuparCasillas(empresa, sucursal, mesaId, casillas) {
      if (casillas.length === 0) return;
      // Las que la mesa ya tuvo (inactivas) se reactivan; las demás se insertan. Nunca se pisa nada en silencio.
      const clave = (c: CasillaDeMesa) => `${c.columna},${c.fila}`;
      const quiere = new Set(casillas.map(clave));
      const previas = await db
        .selectFrom("mesa_celda")
        .select(["columna", "fila"])
        .where("empresa_id", "=", empresa)
        .where("mesa_id", "=", mesaId)
        .execute();
      const existentes = new Set(previas.map(clave));
      for (const c of previas.filter((p) => quiere.has(clave(p)))) {
        await db
          .updateTable("mesa_celda")
          .set({ activa: true })
          .where("empresa_id", "=", empresa)
          .where("mesa_id", "=", mesaId)
          .where("columna", "=", c.columna)
          .where("fila", "=", c.fila)
          .execute();
      }
      const nuevas = casillas.filter((c) => !existentes.has(clave(c)));
      if (nuevas.length === 0) return;
      await db
        .insertInto("mesa_celda")
        .values(
          nuevas.map((c) => ({
            empresa_id: empresa,
            sucursal_id: sucursal,
            mesa_id: mesaId,
            columna: c.columna,
            fila: c.fila,
          })),
        )
        .execute();
    },
  };
}
