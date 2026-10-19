import { sql, type Kysely } from "kysely";
import {
  planId,
  versionDePlanId,
  type EmpresaId,
  type PlanId,
  type TenantId,
  type VersionDePlanId,
} from "../../../primitivas/identificadores/marca";

/**
 * Lo que el alta de una empresa (marcas y planes §B.10, tramo M6) lee y escribe de planes y módulos: la
 * versión de plan que se le asigna al tenant nuevo (la elegida o la última publicada del plan por
 * defecto de la marca), esa primera asignación y los módulos iniciales de la empresa. Es de PLATAFORMA
 * (solo un ADMIN escribe estas tablas, por las restrictivas de 0007). Ninguna restricción de la base se
 * atrapa acá: salen tal cual y el adaptador de transacciones las tipa.
 *
 * Las asignaciones posteriores (cambiar de plan, migrar por lote) y la activación manual de módulos son de
 * los casos de uso de M5; esto es solo lo que el alta necesita, sin duplicarlos.
 */

export type PlanesDelAltaDb = {
  plan: { id: string; estado: string };
  version_de_plan: { id: string; plan_id: string; numero: number | null; estado: string };
  plan_de_tenant: {
    tenant_id: string;
    numero: number;
    version_de_plan_id: string;
    vigente_desde: Date;
    origen: string;
    motivo: string;
    asignado_por: string;
  };
  modulo_de_empresa: { empresa_id: string; modulo: string };
};

/** Una versión de plan tal como hace falta para decidir si se puede asignar. */
export type VersionDePlanAsignable = Readonly<{
  versionDePlanId: VersionDePlanId;
  planId: PlanId;
  /** `PUBLICADA` (no un borrador): solo una publicada se asigna. */
  publicada: boolean;
  /** El plan está `RETIRADO`: no se le asignan tenants nuevos. */
  planRetirado: boolean;
}>;

export interface LecturaDeVersionesDePlanParaElAlta {
  /** La versión con ese id (publicada o no); `null` si no existe. */
  versionDePlan(id: VersionDePlanId): Promise<VersionDePlanAsignable | null>;
  /**
   * La última versión PUBLICADA del plan (la de mayor número), o `null` si el plan no existe o no tiene
   * ninguna publicada. Es «la versión vigente» del plan para quien da de alta: publicar una nueva no
   * mueve a nadie que ya tenga la anterior (N1), pero sí es la que recibe el próximo tenant.
   */
  ultimaPublicadaDelPlan(plan: PlanId): Promise<VersionDePlanAsignable | null>;
}

/** La primera asignación de plan de un tenant recién nacido. */
export type AsignacionDeAlta = Readonly<{
  tenantId: TenantId;
  versionDePlanId: VersionDePlanId;
  vigenteDesde: Date;
  motivo: string;
}>;

export interface AsignacionesDePlanDelAlta {
  /**
   * Inserta la asignación número 1 del tenant, con origen `ALTA`. Quién la asignó NO lo elige quien llama:
   * lo escribe `app_actor_plataforma()` (la base exige que sea el actor firmado). Si el tenant ya tuviera
   * asignaciones, el disparador de la base (número consecutivo) la rechaza: el alta solo asigna a un tenant
   * que acaba de nacer.
   */
  asignarEnElAlta(asignacion: AsignacionDeAlta): Promise<void>;
}

export interface ModulosDeEmpresaDelAlta {
  /** Activa los módulos de la empresa (una fila por módulo, `activo` por defecto). Lista vacía: no escribe. */
  activar(empresa: EmpresaId, modulos: readonly string[]): Promise<void>;
}

function aVersion(fila: {
  id: string;
  plan_id: string;
  estado: string;
  plan_estado: string;
}): VersionDePlanAsignable {
  return {
    versionDePlanId: versionDePlanId(fila.id),
    planId: planId(fila.plan_id),
    publicada: fila.estado === "PUBLICADA",
    planRetirado: fila.plan_estado === "RETIRADO",
  };
}

export function crearLecturaDeVersionesDePlanParaElAlta(
  db: Kysely<PlanesDelAltaDb>,
): LecturaDeVersionesDePlanParaElAlta {
  const base = () =>
    db
      .selectFrom("version_de_plan as v")
      .innerJoin("plan as p", "p.id", "v.plan_id")
      .select(["v.id", "v.plan_id", "v.estado", "p.estado as plan_estado"]);
  return {
    async versionDePlan(id) {
      const fila = await base().where("v.id", "=", id).executeTakeFirst();
      return fila === undefined ? null : aVersion(fila);
    },

    async ultimaPublicadaDelPlan(plan) {
      const fila = await base()
        .where("v.plan_id", "=", plan)
        .where("v.estado", "=", "PUBLICADA")
        .orderBy("v.numero", "desc")
        .limit(1)
        .executeTakeFirst();
      return fila === undefined ? null : aVersion(fila);
    },
  };
}

export function crearAsignacionesDePlanDelAlta(
  db: Kysely<PlanesDelAltaDb>,
): AsignacionesDePlanDelAlta {
  return {
    async asignarEnElAlta(asignacion) {
      await db
        .insertInto("plan_de_tenant")
        .values({
          tenant_id: asignacion.tenantId,
          numero: 1,
          version_de_plan_id: asignacion.versionDePlanId,
          vigente_desde: asignacion.vigenteDesde,
          origen: "ALTA",
          motivo: asignacion.motivo,
          asignado_por: sql<string>`(select app_actor_plataforma())`,
        })
        .execute();
    },
  };
}

export function crearModulosDeEmpresaDelAlta(db: Kysely<PlanesDelAltaDb>): ModulosDeEmpresaDelAlta {
  return {
    async activar(empresa, modulos) {
      if (modulos.length === 0) return;
      await db
        .insertInto("modulo_de_empresa")
        .values(modulos.map((modulo) => ({ empresa_id: empresa, modulo })))
        .execute();
    },
  };
}
