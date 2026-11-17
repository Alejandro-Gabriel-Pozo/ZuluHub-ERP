import { estadoDeDecision, type EstadoDeDecision } from "../../capacidades/planes/vigencia";
import { valorDeAjuste, type ValorDePerilla } from "../../capacidades/planes/valores";
import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import type { AjusteCompleto, AsignacionGuardada } from "../../modulos/planes/publico";
import {
  tenantId as comoTenantId,
  type EmpresaId,
  type PlanId,
  type TenantId,
  type VersionDePlanId,
} from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import { exigirAccionDePlataforma } from "./comun";
import type { DependenciasDeConsultasDeMarcasYPlanes } from "./contrato-de-marcas-y-planes";
import { DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES as D } from "./declaraciones-de-marcas-y-planes";
import { LECTURA, modulosPorEmpresa, type ModulosDeUnaEmpresa } from "./lectura-de-planes";

// --- planDelTenant --------------------------------------------------------------------------------------

export type AsignacionEnHistorial = Readonly<{
  numero: number;
  versionDePlanId: VersionDePlanId;
  planId: PlanId;
  planCodigo: string;
  versionNumero: number;
  nombreComercial: string;
  vigenteDesde: Date;
  origen: AsignacionGuardada["origen"];
  reemplazaProgramada: boolean;
  motivo: string;
  asignadoPor: string;
  creadoEn: Date;
  estado: EstadoDeDecision;
}>;

export type AjusteEnHistorial = Readonly<{
  perilla: string;
  /** `null`: el ajuste es de todo el tenant. */
  empresaId: EmpresaId | null;
  numero: number;
  /** El valor interpretado contra su perilla; `"DEL_PLAN"` vuelve al plan; `null`: el texto guardado no es un valor de esa perilla (se trata como `DEL_PLAN`). */
  valor: ValorDePerilla | "DEL_PLAN" | null;
  valorGuardado: string;
  vigenteDesde: Date;
  reemplazaProgramada: boolean;
  motivo: string;
  asignadoPor: string;
  creadoEn: Date;
  estado: EstadoDeDecision;
}>;

export type PlanDelTenant = Readonly<{
  tenantId: TenantId;
  /** El historial, por número ascendente, con `VIGENTE`, `PROGRAMADA`, `SIN_EFECTO` o `ANTERIOR`. */
  asignaciones: readonly AsignacionEnHistorial[];
  ajustes: readonly AjusteEnHistorial[];
  empresas: readonly ModulosDeUnaEmpresa[];
}>;

export type ErrorAlVerPlanDelTenant =
  MotivoDeRechazo | "ID_INVALIDO" | "TENANT_NO_ENCONTRADO" | ErrorDePersistencia;

function ajustesEnElHistorial(
  ajustes: readonly AjusteCompleto[],
  catalogoDePerillas: DependenciasDeConsultasDeMarcasYPlanes["catalogoDePerillas"],
  ahora: Date,
): AjusteEnHistorial[] {
  const clave = (a: AjusteCompleto) => `${a.perilla}\u0000${a.empresaId ?? ""}`;
  return ajustes.map((a) => {
    const serie = ajustes.filter((o) => clave(o) === clave(a));
    const definicion = Object.hasOwn(catalogoDePerillas, a.perilla)
      ? catalogoDePerillas[a.perilla]
      : undefined;
    return {
      perilla: a.perilla,
      empresaId: a.empresaId,
      numero: a.numero,
      valor: definicion === undefined ? null : valorDeAjuste(definicion, a.valor),
      valorGuardado: a.valor,
      vigenteDesde: a.vigenteDesde,
      reemplazaProgramada: a.reemplazaProgramada,
      motivo: a.motivo,
      asignadoPor: a.asignadoPor,
      creadoEn: a.creadoEn,
      estado: estadoDeDecision(serie, a, ahora),
    };
  });
}

/**
 * El plan de un tenant (§B.11): el historial de asignaciones y de ajustes con su estado calculado, y los
 * módulos que cada empresa tiene activados. `planes.ver`, solo lectura.
 */
export function armarPlanDelTenant({
  transacciones,
  reglas,
  catalogoDePerillas,
}: DependenciasDeConsultasDeMarcasYPlanes) {
  return async function planDelTenant(
    contexto: ContextoDePlataforma,
    entrada: Readonly<{ tenantId: string }>,
  ): Promise<Resultado<PlanDelTenant, ErrorAlVerPlanDelTenant>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (tx): Promise<Resultado<PlanDelTenant, ErrorAlVerPlanDelTenant>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.planDelTenant.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const id = uuidDesdeTexto(entrada.tenantId);
        if (!id.ok) return id;
        const tenant = comoTenantId(id.valor);
        if (!(await tx.planes.existeElTenant(tenant))) return err("TENANT_NO_ENCONTRADO");
        const asignaciones = await tx.planes.asignacionesDelTenant(tenant);
        const ajustes = await tx.planes.ajustesDelTenant(tenant);
        return ok({
          tenantId: tenant,
          asignaciones: asignaciones.map((a) => ({
            numero: a.numero,
            versionDePlanId: a.versionDePlanId,
            planId: a.planId,
            planCodigo: a.planCodigo,
            versionNumero: a.versionNumero,
            nombreComercial: a.nombreComercial,
            vigenteDesde: a.vigenteDesde,
            origen: a.origen,
            reemplazaProgramada: a.reemplazaProgramada,
            motivo: a.motivo,
            asignadoPor: a.asignadoPor,
            creadoEn: a.creadoEn,
            estado: estadoDeDecision(asignaciones, a, contexto.ahora),
          })),
          ajustes: ajustesEnElHistorial(ajustes, catalogoDePerillas, contexto.ahora),
          empresas: await modulosPorEmpresa(tx, tenant),
        });
      },
    );
  };
}
