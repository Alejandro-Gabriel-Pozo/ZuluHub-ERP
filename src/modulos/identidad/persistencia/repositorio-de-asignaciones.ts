import type { Kysely } from "kysely";
import {
  empresaId,
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import type { IdentidadDb } from "./tablas";

export type Asignacion = Readonly<{
  empresaId: EmpresaId;
  personaId: PersonaId;
  sucursalId: SucursalId;
  activa: boolean;
  version: number;
}>;

export interface RepositorioDeAsignaciones {
  deLaPersona(empresa: EmpresaId, persona: PersonaId): Promise<Asignacion[]>;
  /** Las asignaciones ACTIVAS de todos los miembros de la empresa (no mira si la sucursal está activa). */
  activasDeLaEmpresa(empresa: EmpresaId): Promise<Asignacion[]>;
  crear(empresa: EmpresaId, persona: PersonaId, sucursales: readonly SucursalId[]): Promise<void>;
  reactivar(
    empresa: EmpresaId,
    persona: PersonaId,
    sucursal: SucursalId,
    versionEsperada: number,
  ): Promise<boolean>;
  /** Apaga una asignación activa. `false`: ya no estaba activa o cambió de versión. */
  apagar(
    empresa: EmpresaId,
    persona: PersonaId,
    sucursal: SucursalId,
    versionEsperada: number,
  ): Promise<boolean>;
  /** Apaga todas las asignaciones activas de la persona en la empresa; devuelve cuántas. */
  apagarTodas(empresa: EmpresaId, persona: PersonaId): Promise<number>;
}

export function crearRepositorioDeAsignaciones(db: Kysely<IdentidadDb>): RepositorioDeAsignaciones {
  const aAsignacion = (f: {
    empresa_id: string;
    persona_id: string;
    sucursal_id: string;
    activa: boolean;
    version: number;
  }): Asignacion => ({
    empresaId: empresaId(f.empresa_id),
    personaId: personaId(f.persona_id),
    sucursalId: sucursalId(f.sucursal_id),
    activa: f.activa,
    version: f.version,
  });
  return {
    async deLaPersona(empresa, persona) {
      const filas = await db
        .selectFrom("asignacion_sucursal")
        .select(["empresa_id", "persona_id", "sucursal_id", "activa", "version"])
        .where("empresa_id", "=", empresa)
        .where("persona_id", "=", persona)
        .orderBy("sucursal_id")
        .execute();
      return filas.map(aAsignacion);
    },

    async activasDeLaEmpresa(empresa) {
      const filas = await db
        .selectFrom("asignacion_sucursal")
        .select(["empresa_id", "persona_id", "sucursal_id", "activa", "version"])
        .where("empresa_id", "=", empresa)
        .where("activa", "=", true)
        .orderBy("persona_id")
        .orderBy("sucursal_id")
        .execute();
      return filas.map(aAsignacion);
    },

    async crear(empresa, persona, sucursales) {
      if (sucursales.length === 0) return;
      await db
        .insertInto("asignacion_sucursal")
        .values(
          sucursales.map((sucursal) => ({
            empresa_id: empresa,
            persona_id: persona,
            sucursal_id: sucursal,
          })),
        )
        .execute();
    },

    async reactivar(empresa, persona, sucursal, versionEsperada) {
      const r = await db
        .updateTable("asignacion_sucursal")
        .set({ activa: true })
        .where("empresa_id", "=", empresa)
        .where("persona_id", "=", persona)
        .where("sucursal_id", "=", sucursal)
        .where("activa", "=", false)
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async apagar(empresa, persona, sucursal, versionEsperada) {
      const r = await db
        .updateTable("asignacion_sucursal")
        .set({ activa: false })
        .where("empresa_id", "=", empresa)
        .where("persona_id", "=", persona)
        .where("sucursal_id", "=", sucursal)
        .where("activa", "=", true)
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async apagarTodas(empresa, persona) {
      const r = await db
        .updateTable("asignacion_sucursal")
        .set({ activa: false })
        .where("empresa_id", "=", empresa)
        .where("persona_id", "=", persona)
        .where("activa", "=", true)
        .executeTakeFirst();
      return Number(r.numUpdatedRows);
    },
  };
}
