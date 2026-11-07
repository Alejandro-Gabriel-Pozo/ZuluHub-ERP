import type { ValorDePerilla } from "../../capacidades/planes/valores";
import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import type { PlanGuardado, VersionDePlanGuardada } from "../../modulos/planes/publico";
import {
  planId as comoPlanId,
  type TenantId,
  type VersionDePlanId,
} from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import { exigirAccionDePlataforma } from "./comun";
import type { DependenciasDeConsultasDeMarcasYPlanes } from "./contrato-de-marcas-y-planes";
import { DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES as D } from "./declaraciones-de-marcas-y-planes";
import { LECTURA, versionVigentePorTenant } from "./lectura-de-planes";

/** Cuántos tenants tiene hoy cada versión (solo cuentan las versiones que se piden). */
function tenantsPorVersion(
  vigentes: ReadonlyMap<TenantId, VersionDePlanId>,
): ReadonlyMap<VersionDePlanId, number> {
  const cuenta = new Map<VersionDePlanId, number>();
  for (const version of vigentes.values()) cuenta.set(version, (cuenta.get(version) ?? 0) + 1);
  return cuenta;
}

// --- listarPlanes ---------------------------------------------------------------------------------------

export type PlanEnLista = Readonly<{
  plan: PlanGuardado;
  /** La última versión publicada; `null` si el plan todavía no publicó ninguna (no se le puede asignar a nadie). */
  ultimaVersion: Readonly<{
    versionDePlanId: VersionDePlanId;
    numero: number;
    nombreComercial: string;
  }> | null;
  hayBorrador: boolean;
}>;

export type VistaDeListaDePlanes = Readonly<{ planes: readonly PlanEnLista[] }>;

/** Los planes, por código, con su última versión publicada y si tienen borrador (§B.11). `planes.ver`, solo lectura. */
export function armarListarPlanes({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeMarcasYPlanes) {
  return async function listarPlanes(
    contexto: ContextoDePlataforma,
  ): Promise<Resultado<VistaDeListaDePlanes, MotivoDeRechazo | ErrorDePersistencia>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (tx): Promise<Resultado<VistaDeListaDePlanes, MotivoDeRechazo>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.listarPlanes.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const planes = await tx.planes.listarPlanes();
        const versiones = await tx.planes.versionesDeLosPlanes(planes.map((p) => p.id));
        return ok({
          planes: planes.map((plan) => {
            const propias = versiones.filter((v) => v.planId === plan.id);
            const publicadas = propias.filter((v) => v.estado === "PUBLICADA");
            const ultima = publicadas.at(-1);
            return {
              plan,
              ultimaVersion:
                ultima === undefined || ultima.numero === null
                  ? null
                  : {
                      versionDePlanId: ultima.id,
                      numero: ultima.numero,
                      nombreComercial: ultima.nombreComercial,
                    },
              hayBorrador: propias.some((v) => v.estado === "BORRADOR"),
            };
          }),
        });
      },
    );
  };
}

// --- fichaDePlan ----------------------------------------------------------------------------------------

export type VersionDePlanEnFicha = Readonly<{
  versionDePlanId: VersionDePlanId;
  /** `null` en el borrador. */
  numero: number | null;
  estado: "BORRADOR" | "PUBLICADA";
  nombreComercial: string;
  modulos: readonly string[];
  perillas: Readonly<Record<string, ValorDePerilla>>;
  motivo: string | null;
  publicadaEn: Date | null;
  publicadaPor: string | null;
  /** La `version` de la fila: la `versionEsperada` de la próxima edición del borrador. */
  version: number;
  /** Cuántos tenants tienen hoy esta versión asignada y vigente (el borrador no tiene ninguno). */
  tenantsConLaVersion: number;
}>;

export type FichaDePlan = Readonly<{
  plan: PlanGuardado;
  /** Por número ascendente; el borrador, si hay, va al final. */
  versiones: readonly VersionDePlanEnFicha[];
  /** Cuántos tenants tienen hoy alguna versión de este plan. */
  tenantsConElPlan: number;
}>;

export type ErrorAlVerFichaDePlan =
  MotivoDeRechazo | "ID_INVALIDO" | "PLAN_NO_ENCONTRADO" | ErrorDePersistencia;

const enFichaDePlan = (v: VersionDePlanGuardada, tenants: number): VersionDePlanEnFicha => ({
  versionDePlanId: v.id,
  numero: v.numero,
  estado: v.estado,
  nombreComercial: v.nombreComercial,
  modulos: v.modulos,
  perillas: v.perillas,
  motivo: v.motivo,
  publicadaEn: v.publicadaEn,
  publicadaPor: v.publicadaPor,
  version: v.version,
  tenantsConLaVersion: tenants,
});

/** La ficha de un plan (§B.11): sus versiones, con sus módulos, sus perillas y cuántos tenants tiene cada una. `planes.ver`. */
export function armarFichaDePlan({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeMarcasYPlanes) {
  return async function fichaDePlan(
    contexto: ContextoDePlataforma,
    entrada: Readonly<{ planId: string }>,
  ): Promise<Resultado<FichaDePlan, ErrorAlVerFichaDePlan>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (tx): Promise<Resultado<FichaDePlan, ErrorAlVerFichaDePlan>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.fichaDePlan.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const id = uuidDesdeTexto(entrada.planId);
        if (!id.ok) return id;
        const plan = await tx.planes.obtenerPlan(comoPlanId(id.valor));
        if (plan === null) return err("PLAN_NO_ENCONTRADO");
        const versiones = await tx.planes.versionesDeLosPlanes([plan.id]);
        const propias = new Set(versiones.map((v) => v.id));
        const vigentes = versionVigentePorTenant(
          await tx.planes.asignacionesDeLosTenantsQueTuvieron(versiones.map((v) => v.id)),
          contexto.ahora,
        );
        const cuenta = tenantsPorVersion(vigentes);
        return ok({
          plan,
          versiones: versiones.map((v) => enFichaDePlan(v, cuenta.get(v.id) ?? 0)),
          tenantsConElPlan: [...vigentes.values()].filter((v) => propias.has(v)).length,
        });
      },
    );
  };
}

export {
  type AsignacionEnHistorial,
  type AjusteEnHistorial,
  type PlanDelTenant,
  type ErrorAlVerPlanDelTenant,
  armarPlanDelTenant,
} from "./plan-del-tenant";
export {
  type EstadoDelModuloParaLaEmpresa,
  type ModuloEnLosDerechos,
  type PerillaEnLosDerechos,
  type DerechosDeUsoDeEmpresa,
  type ErrorAlVerDerechosDeUsoDeEmpresa,
  armarDerechosDeUsoDeEmpresa,
} from "./derechos-de-uso-de-empresa";
export {
  type EntradaDeDiferenciaEntreVersiones,
  type ExtremoDeLaDiferencia,
  type DiferenciaDeVersionesDePlan,
  type ErrorAlVerDiferenciaEntreVersiones,
  armarDiferenciaEntreVersiones,
} from "./diferencia-entre-versiones";
export type { ModulosDeUnaEmpresa } from "./lectura-de-planes";
