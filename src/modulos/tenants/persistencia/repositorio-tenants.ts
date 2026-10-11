import type { Generated, Kysely, Selectable } from "kysely";
import type { EstadoDeTenant } from "../../../contexto/estados";
import { tenantId, type TenantId } from "../../../primitivas/identificadores/marca";
import type { CambioDeEstadoDeTenant, Tenant } from "../dominio/tenant";

/** Tablas del módulo (la base es la fuente de verdad; un test compara estas columnas con el catálogo). */
export type TenantsDb = {
  tenant: {
    id: Generated<string>;
    nombre: string;
    estado: Generated<EstadoDeTenant>;
    motivo_estado: Generated<string | null>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
};

export const COLUMNAS_DE_TENANT = [
  "id",
  "nombre",
  "estado",
  "motivo_estado",
  "creado_en",
  "actualizado_en",
  "version",
] as const;

/** Restricción de la base → error de negocio (ADR-004). Un test exige que no falte ninguna. */
export const ERRORES_DE_TENANT_POR_RESTRICCION: Readonly<Record<string, string>> = {
  tenant_pkey: "NO_TRADUCIDA",
  tenant_nombre_ck: "NOMBRE_INVALIDO",
  tenant_estado_ck: "NO_TRADUCIDA",
  tenant_motivo_ck: "MOTIVO_OBLIGATORIO",
  tenant_instalacion_single: "INSTALACION_SINGLE_YA_TIENE_TENANT",
};

export type ErrorDeRepositorioDeTenants = "TENANT_NO_ENCONTRADO" | "VERSION_DESACTUALIZADA";

export interface RepositorioDeTenants {
  crear(nombre: string): Promise<Tenant>;
  obtener(id: TenantId): Promise<Tenant | null>;
  /** Cambia el estado solo si la versión coincide (control optimista). */
  cambiarEstado(
    id: TenantId,
    versionEsperada: number,
    cambio: CambioDeEstadoDeTenant,
  ): Promise<{ ok: true; tenant: Tenant } | { ok: false; error: ErrorDeRepositorioDeTenants }>;
}

function aTenant(fila: Selectable<TenantsDb["tenant"]>): Tenant {
  return {
    id: tenantId(fila.id),
    nombre: fila.nombre,
    estado: fila.estado,
    motivoEstado: fila.motivo_estado,
    version: fila.version,
  };
}

export function crearRepositorioDeTenants(db: Kysely<TenantsDb>): RepositorioDeTenants {
  async function obtener(id: TenantId): Promise<Tenant | null> {
    const fila = await db.selectFrom("tenant").selectAll().where("id", "=", id).executeTakeFirst();
    return fila === undefined ? null : aTenant(fila);
  }

  return {
    obtener,

    async crear(nombre) {
      const fila = await db
        .insertInto("tenant")
        .values({ nombre })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aTenant(fila);
    },

    async cambiarEstado(id, versionEsperada, cambio) {
      const fila = await db
        .updateTable("tenant")
        .set({ estado: cambio.estado, motivo_estado: cambio.motivoEstado })
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      if (fila !== undefined) return { ok: true, tenant: aTenant(fila) };
      const existente = await obtener(id);
      return {
        ok: false,
        error: existente === null ? "TENANT_NO_ENCONTRADO" : "VERSION_DESACTUALIZADA",
      };
    },
  };
}
