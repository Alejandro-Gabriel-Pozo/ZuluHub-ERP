import { sql, type Kysely } from "kysely";
import type { AjusteDePerilla, VersionDePlanVigente } from "../../../capacidades/planes/derechos";
import type { DefinicionDePerilla } from "../../../capacidades/planes/perillas";
import { valorDeAjuste, type ValorDePerilla } from "../../../capacidades/planes/valores";
import {
  empresaId,
  planId,
  tenantId,
  versionDePlanId,
  type EmpresaId,
  type TenantId,
} from "../../../primitivas/identificadores/marca";
import type { PlanesDb } from "./tablas";

/**
 * Lecturas de planes para los derechos de uso (ADR-005). Solo leen: escribir planes, asignaciones y
 * ajustes es de los casos de uso de plataforma (M5). Corren con la conexión de la transacción del
 * llamador: con la aplicación, la RLS de 0007 muestra solo lo del tenant de la empresa del contexto (y, de
 * los ajustes por empresa, los de ella); con la plataforma, todo, bajo un actor vigente. Los filtros por
 * tenant y empresa se repiten a propósito (defensa en profundidad).
 *
 * Ninguna restricción ni error de la base se atrapa: salen tal cual.
 */

/**
 * Una asignación de plan del tenant con lo que la versión asignada congeló. `numero` y `vigenteDesde`
 * son de la ASIGNACIÓN (su serie y su vigencia: «la última decisión manda»); `version.numero` es el de
 * la versión dentro de su plan.
 */
export type AsignacionConVersion = Readonly<{
  numero: number;
  vigenteDesde: Date;
  version: VersionDePlanVigente;
}>;

/** Un ajuste tal como está guardado: el valor sigue siendo el texto de la base (`valorDeAjuste` lo interpreta). */
export type AjusteGuardado = Readonly<{
  perilla: string;
  /** `null`: el ajuste es de todo el tenant. */
  empresaId: EmpresaId | null;
  numero: number;
  vigenteDesde: Date;
  valor: string;
}>;

/**
 * Los ajustes guardados, como los entiende `derechosDeUso`: cada valor se interpreta contra SU perilla
 * (`valorDeAjuste`). Una perilla que el catálogo ya no tiene se ignora; un valor que no es de su tipo cuenta
 * como `DEL_PLAN` (vuelve al plan: falla cerrado). La usan la lectura de derechos y la consulta de
 * diferencia entre versiones: una sola interpretación de lo que dice la base.
 */
export function interpretarAjustes(
  catalogoDePerillas: Readonly<Record<string, DefinicionDePerilla>>,
  guardados: readonly AjusteGuardado[],
): AjusteDePerilla[] {
  const ajustes: AjusteDePerilla[] = [];
  for (const g of guardados) {
    const definicion = Object.hasOwn(catalogoDePerillas, g.perilla)
      ? catalogoDePerillas[g.perilla]
      : undefined;
    if (definicion === undefined) continue;
    ajustes.push({
      perilla: g.perilla,
      empresaId: g.empresaId,
      numero: g.numero,
      vigenteDesde: g.vigenteDesde,
      valor: valorDeAjuste(definicion, g.valor) ?? "DEL_PLAN",
    });
  }
  return ajustes;
}

export interface LecturaDePlanes {
  /**
   * El tenant de la empresa, visto con los permisos de quien consulta; `null` si no la ve (otra empresa,
   * o inexistente). Con la aplicación, solo ve la empresa del contexto.
   */
  tenantDeLaEmpresa(empresa: EmpresaId): Promise<TenantId | null>;
  /** ¿Ve el tenant? (para la plataforma: distingue un tenant sin plan de uno que no existe). */
  existeElTenant(tenant: TenantId): Promise<boolean>;
  /** Todas las asignaciones del tenant, con su versión, por número ascendente. */
  asignacionesDelTenant(tenant: TenantId): Promise<readonly AsignacionConVersion[]>;
  /**
   * Los ajustes del tenant: los de todo el tenant (`empresa_id` nulo) y, si se da `empresa`, también los
   * de esa empresa. Nunca los de otra empresa del mismo tenant.
   */
  ajustesDelTenant(tenant: TenantId, empresa: EmpresaId | null): Promise<readonly AjusteGuardado[]>;
}

/** Los valores de perillas de una versión: la base impone la forma del objeto; lo que no es un objeto no aporta nada. */
function perillasDeLaVersion(json: unknown): Readonly<Record<string, ValorDePerilla>> {
  return typeof json === "object" && json !== null && !Array.isArray(json)
    ? (json as Readonly<Record<string, ValorDePerilla>>)
    : {};
}

export function crearLecturaDePlanes(db: Kysely<PlanesDb>): LecturaDePlanes {
  return {
    async tenantDeLaEmpresa(empresa) {
      const { rows } = await sql<{
        tenant: string | null;
      }>`select tenant_de_empresa(${empresa}) as tenant`.execute(db);
      const tenant = rows[0]?.tenant ?? null;
      return tenant === null ? null : tenantId(tenant);
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
      const filas = await db
        .selectFrom("plan_de_tenant as a")
        .innerJoin("version_de_plan as v", "v.id", "a.version_de_plan_id")
        .select([
          "a.numero as numero",
          "a.vigente_desde as vigente_desde",
          "v.id as version_id",
          "v.plan_id as plan_id",
          "v.numero as version_numero",
          "v.modulos as modulos",
          "v.perillas as perillas",
        ])
        .where("a.tenant_id", "=", tenant)
        .orderBy("a.numero", "asc")
        .execute();
      return filas.map((f): AsignacionConVersion => {
        // `version_de_plan_publicada_ck`: una versión publicada (la única que se asigna) tiene número.
        if (f.version_numero === null) {
          throw new RangeError(`la versión de plan ${f.version_id} asignada no tiene número`);
        }
        return {
          numero: f.numero,
          vigenteDesde: f.vigente_desde,
          version: {
            planId: planId(f.plan_id),
            versionDePlanId: versionDePlanId(f.version_id),
            numero: f.version_numero,
            modulos: f.modulos,
            perillas: perillasDeLaVersion(f.perillas),
          },
        };
      });
    },

    async ajustesDelTenant(tenant, empresa) {
      const filas = await db
        .selectFrom("ajuste_de_perilla")
        .select(["perilla", "empresa_id", "numero", "vigente_desde", "valor"])
        .where("tenant_id", "=", tenant)
        .where((eb) =>
          empresa === null
            ? eb("empresa_id", "is", null)
            : eb.or([eb("empresa_id", "is", null), eb("empresa_id", "=", empresa)]),
        )
        .orderBy("numero", "asc")
        .execute();
      return filas.map((f): AjusteGuardado => ({
        perilla: f.perilla,
        empresaId: f.empresa_id === null ? null : empresaId(f.empresa_id),
        numero: f.numero,
        vigenteDesde: f.vigente_desde,
        valor: f.valor,
      }));
    },
  };
}
