import { type Kysely, sql } from "kysely";
import {
  empresaId,
  planId,
  tenantId,
  versionDePlanId,
} from "../../../primitivas/identificadores/marca";
import type { OrigenDeAsignacion } from "../dominio/asignacion";
import type { PlanesDePlataformaDb } from "./tablas";
import type { AsignacionGuardada, RepositorioDePlanes } from "./tipos-de-planes";
import { deLaLista } from "./mapeos-de-planes";

const ORIGENES: readonly OrigenDeAsignacion[] = ["ALTA", "CAMBIO", "MIGRACION_DE_VERSION"];

export function crearAsignacionesDePlanes(
  db: Kysely<PlanesDePlataformaDb>,
): Pick<
  RepositorioDePlanes,
  | "tenantDeLaEmpresa"
  | "empresasDelTenant"
  | "existeElTenant"
  | "asignacionesDelTenant"
  | "asignar"
  | "asignacionesDeLosTenantsQueTuvieron"
  | "tenantsConLaVersionVigente"
> {
  /** Una asignación con su versión y su plan, ordenada por número. */
  const asignacionesConVersion = () =>
    db
      .selectFrom("plan_de_tenant as a")
      .innerJoin("version_de_plan as v", "v.id", "a.version_de_plan_id")
      .innerJoin("plan as p", "p.id", "v.plan_id")
      .select([
        "a.id as id",
        "a.tenant_id as tenant_id",
        "a.numero as numero",
        "a.version_de_plan_id as version_de_plan_id",
        "a.vigente_desde as vigente_desde",
        "a.origen as origen",
        "a.reemplaza_programada as reemplaza_programada",
        "a.motivo as motivo",
        "a.asignado_por as asignado_por",
        "a.creado_en as creado_en",
        "v.plan_id as plan_id",
        "v.numero as version_numero",
        "v.nombre_comercial as nombre_comercial",
        "p.codigo as plan_codigo",
      ]);

  type FilaDeAsignacion = Awaited<
    ReturnType<ReturnType<typeof asignacionesConVersion>["executeTakeFirstOrThrow"]>
  >;

  function aAsignacion(f: FilaDeAsignacion): AsignacionGuardada {
    // `version_de_plan_publicada_ck`: la versión asignada está publicada y, por eso, tiene número.
    if (f.version_numero === null) {
      throw new RangeError(`la versión de plan ${f.version_de_plan_id} asignada no tiene número`);
    }
    return {
      id: f.id,
      tenantId: tenantId(f.tenant_id),
      numero: f.numero,
      versionDePlanId: versionDePlanId(f.version_de_plan_id),
      planId: planId(f.plan_id),
      planCodigo: f.plan_codigo,
      versionNumero: f.version_numero,
      nombreComercial: f.nombre_comercial,
      vigenteDesde: f.vigente_desde,
      origen: deLaLista(ORIGENES, f.origen, "origen de asignación"),
      reemplazaProgramada: f.reemplaza_programada,
      motivo: f.motivo,
      asignadoPor: f.asignado_por,
      creadoEn: f.creado_en,
    };
  }

  return {
    async tenantDeLaEmpresa(empresa) {
      const fila = await db
        .selectFrom("empresa")
        .select("tenant_id")
        .where("id", "=", empresa)
        .executeTakeFirst();
      return fila === undefined ? null : tenantId(fila.tenant_id);
    },

    async empresasDelTenant(tenant) {
      const filas = await db
        .selectFrom("empresa")
        .select("id")
        .where("tenant_id", "=", tenant)
        .orderBy("id", "asc")
        .execute();
      return filas.map((f) => empresaId(f.id));
    },

    async existeElTenant(tenant) {
      const fila = await db
        .selectFrom("tenant")
        .select("id")
        .where("id", "=", tenant)
        .executeTakeFirst();
      return fila !== undefined;
    },

    async asignacionesDelTenant(tenant) {
      const filas = await asignacionesConVersion()
        .where("a.tenant_id", "=", tenant)
        .orderBy("a.numero", "asc")
        .execute();
      return filas.map(aAsignacion);
    },

    async asignar(nueva) {
      const insertada = await db
        .insertInto("plan_de_tenant")
        .values({
          tenant_id: nueva.tenantId,
          numero: nueva.numero,
          version_de_plan_id: nueva.versionDePlanId,
          vigente_desde: nueva.vigenteDesde,
          origen: nueva.origen,
          reemplaza_programada: nueva.reemplazaProgramada,
          motivo: nueva.motivo,
          asignado_por: sql<string>`(select app_actor_plataforma())`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const fila = await asignacionesConVersion()
        .where("a.id", "=", insertada.id)
        .executeTakeFirstOrThrow();
      return aAsignacion(fila);
    },

    async asignacionesDeLosTenantsQueTuvieron(versiones) {
      if (versiones.length === 0) return [];
      const filas = await db
        .selectFrom("plan_de_tenant")
        .select(["tenant_id", "numero", "vigente_desde", "version_de_plan_id"])
        .where("tenant_id", "in", (eb) =>
          eb
            .selectFrom("plan_de_tenant")
            .select("tenant_id")
            .where("version_de_plan_id", "in", versiones),
        )
        .orderBy("tenant_id", "asc")
        .orderBy("numero", "asc")
        .execute();
      return filas.map((f) => ({
        tenantId: tenantId(f.tenant_id),
        numero: f.numero,
        vigenteDesde: f.vigente_desde,
        versionDePlanId: versionDePlanId(f.version_de_plan_id),
      }));
    },

    async tenantsConLaVersionVigente(version, ahora, pagina) {
      let consulta = db
        .selectFrom("tenant as t")
        .innerJoinLateral(
          (eb) =>
            eb
              .selectFrom("plan_de_tenant as a")
              .select("a.version_de_plan_id")
              .whereRef("a.tenant_id", "=", "t.id")
              .where("a.vigente_desde", "<=", ahora)
              .orderBy("a.numero", "desc")
              .limit(1)
              .as("av"),
          (unir) => unir.onTrue(),
        )
        .where("av.version_de_plan_id", "=", version)
        .select((eb) => [
          "t.id as id",
          "t.nombre as nombre",
          "t.estado as estado",
          "t.marca_id as marca_id",
          eb
            .selectFrom("plan_de_tenant as u")
            .select((eb2) => eb2.fn.max("u.numero").as("ultimo"))
            .whereRef("u.tenant_id", "=", "t.id")
            .as("ultimo_numero"),
          // `estadoDeDecision` = PROGRAMADA: todavía no empezó y ninguna de mayor número, que empiece a su
          // hora o antes, la deja sin efecto.
          eb
            .exists(
              eb
                .selectFrom("plan_de_tenant as pr")
                .select("pr.tenant_id")
                .whereRef("pr.tenant_id", "=", "t.id")
                .where("pr.vigente_desde", ">", ahora)
                .where((eb2) =>
                  eb2.not(
                    eb2.exists(
                      eb2
                        .selectFrom("plan_de_tenant as po")
                        .select("po.tenant_id")
                        .whereRef("po.tenant_id", "=", "pr.tenant_id")
                        .whereRef("po.numero", ">", "pr.numero")
                        .whereRef("po.vigente_desde", "<=", "pr.vigente_desde"),
                    ),
                  ),
                ),
            )
            .as("hay_programada"),
          eb
            .selectFrom("empresa as ec")
            .select(eb.fn.countAll<string>().as("n"))
            .whereRef("ec.tenant_id", "=", "t.id")
            .where("ec.estado", "<>", "CANCELLED")
            .as("empresas"),
        ])
        .orderBy("t.id")
        .limit(pagina.limite);
      if (pagina.despuesDeId !== null) consulta = consulta.where("t.id", ">", pagina.despuesDeId);
      const filas = await consulta.execute();
      return filas.map((f) => {
        // Si el tenant sale por tener una asignación vigente, tiene al menos una: el máximo existe.
        if (f.ultimo_numero === null) {
          throw new RangeError(`el tenant ${f.id} con plan vigente no tiene asignaciones`);
        }
        return {
          tenantId: tenantId(f.id),
          nombre: f.nombre,
          estado: deLaLista(["ACTIVE", "SUSPENDED"], f.estado, "estado de tenant"),
          marcaId: f.marca_id,
          ultimoNumeroDeAsignacion: f.ultimo_numero,
          hayProgramada: Boolean(f.hay_programada),
          empresas: Number(f.empresas),
        };
      });
    },
  };
}
