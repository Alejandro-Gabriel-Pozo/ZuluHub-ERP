import type { AjusteDePerilla } from "../../capacidades/planes/derechos";
import {
  diferenciaEntreVersiones as calcularDiferencia,
  type DiferenciaEntreVersiones,
  type TenantParaLaDiferencia,
} from "../../capacidades/planes/diferencia";
import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import { interpretarAjustes, type VersionDePlanGuardada } from "../../modulos/planes/publico";
import {
  tenantId as comoTenantId,
  versionDePlanId as comoVersionDePlanId,
  type PlanId,
  type TenantId,
  type VersionDePlanId,
} from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import { LIMITE_DE_TENANTS_POR_LOTE } from "../dominio/lote-de-migracion";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import { exigirAccionDePlataforma } from "./comun";
import type {
  DependenciasDeConsultasDeMarcasYPlanes,
  TxDeConsultasDeMarcasYPlanes,
} from "./contrato-de-marcas-y-planes";
import { DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES as D } from "./declaraciones-de-marcas-y-planes";
import { LECTURA, versionVigentePorTenant, modulosPorEmpresa } from "./lectura-de-planes";

// --- diferenciaEntreVersiones ---------------------------------------------------------------------------

export type EntradaDeDiferenciaEntreVersiones = Readonly<{
  /** La versión de origen (su id). */
  desde: string;
  /** La versión de destino (su id). */
  hasta: string;
  /**
   * Los tenants para los que se calcula lo que cambia en SU caso (sus ajustes y sus módulos activados). Sin
   * este campo: todos los que hoy tienen la versión `desde` vigente. Hasta `LIMITE_DE_TENANTS_POR_LOTE`.
   */
  tenantIds?: readonly string[] | undefined;
}>;

export type ExtremoDeLaDiferencia = Readonly<{
  versionDePlanId: VersionDePlanId;
  planId: PlanId;
  planCodigo: string;
  numero: number | null;
  estado: "BORRADOR" | "PUBLICADA";
  nombreComercial: string;
}>;

export type DiferenciaDeVersionesDePlan = DiferenciaEntreVersiones<string, string> &
  Readonly<{ desde: ExtremoDeLaDiferencia; hasta: ExtremoDeLaDiferencia }>;

export type ErrorAlVerDiferenciaEntreVersiones =
  | MotivoDeRechazo
  | "ID_INVALIDO"
  | "VERSION_DE_PLAN_NO_ENCONTRADA"
  | "TENANT_NO_ENCONTRADO"
  | "LOTE_DEMASIADO_GRANDE"
  | ErrorDePersistencia;

async function extremo(
  tx: TxDeConsultasDeMarcasYPlanes,
  version: VersionDePlanGuardada,
): Promise<ExtremoDeLaDiferencia> {
  const plan = await tx.planes.obtenerPlan(version.planId);
  // Una versión siempre pertenece a un plan que existe (`version_de_plan_plan_id_fkey`).
  if (plan === null) throw new RangeError(`la versión ${version.id} no tiene plan`);
  return {
    versionDePlanId: version.id,
    planId: version.planId,
    planCodigo: plan.codigo,
    numero: version.numero,
    estado: version.estado,
    nombreComercial: version.nombreComercial,
  };
}

/**
 * Lo que cambia entre dos versiones de plan (§B.11, N2): módulos que entran y salen, perillas que suben o
 * bajan y, por tenant, los ajustes que sobreviven (y si pisan un cambio) y los módulos activados que
 * quedarían en solo lectura. Es el cálculo de `capacidades/planes` (el mismo que aplicar una y otra versión
 * a `derechosDeUso`), sobre datos de plataforma: no ve el uso operativo («3 de 2» lo ve el gerente).
 * `planes.ver`, solo lectura.
 */
export function armarDiferenciaEntreVersiones({
  transacciones,
  reglas,
  catalogoDeModulos,
  catalogoDePerillas,
}: DependenciasDeConsultasDeMarcasYPlanes) {
  return async function diferenciaEntreVersiones(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeDiferenciaEntreVersiones,
  ): Promise<Resultado<DiferenciaDeVersionesDePlan, ErrorAlVerDiferenciaEntreVersiones>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (
        tx,
      ): Promise<Resultado<DiferenciaDeVersionesDePlan, ErrorAlVerDiferenciaEntreVersiones>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.diferenciaEntreVersiones.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const desdeId = uuidDesdeTexto(entrada.desde);
        if (!desdeId.ok) return desdeId;
        const hastaId = uuidDesdeTexto(entrada.hasta);
        if (!hastaId.ok) return hastaId;
        let pedidos: TenantId[] | null = null;
        if (entrada.tenantIds !== undefined) {
          const ids: TenantId[] = [];
          for (const texto of entrada.tenantIds) {
            const id = uuidDesdeTexto(texto);
            if (!id.ok) return id;
            if (!ids.includes(comoTenantId(id.valor))) ids.push(comoTenantId(id.valor));
          }
          if (ids.length > LIMITE_DE_TENANTS_POR_LOTE) return err("LOTE_DEMASIADO_GRANDE");
          pedidos = ids;
        }

        const desde = await tx.planes.versionPorId(comoVersionDePlanId(desdeId.valor));
        const hasta = await tx.planes.versionPorId(comoVersionDePlanId(hastaId.valor));
        if (desde === null || hasta === null) return err("VERSION_DE_PLAN_NO_ENCONTRADA");

        let tenantIds: readonly TenantId[];
        if (pedidos === null) {
          const vigentes = versionVigentePorTenant(
            await tx.planes.asignacionesDeLosTenantsQueTuvieron([desde.id]),
            contexto.ahora,
          );
          tenantIds = [...vigentes].filter(([, v]) => v === desde.id).map(([t]) => t);
        } else {
          for (const tenant of pedidos) {
            if (!(await tx.planes.existeElTenant(tenant))) return err("TENANT_NO_ENCONTRADO");
          }
          tenantIds = pedidos;
        }

        const tenants: TenantParaLaDiferencia[] = [];
        for (const tenantId of tenantIds) {
          const ajustes: AjusteDePerilla[] = interpretarAjustes(
            catalogoDePerillas,
            await tx.planes.ajustesDelTenant(tenantId),
          );
          const empresas = await modulosPorEmpresa(tx, tenantId);
          tenants.push({
            tenantId,
            ajustes,
            empresas: empresas.map((e) => ({
              empresaId: e.empresaId,
              modulosActivados: e.modulos.filter((m) => m.activo).map((m) => m.modulo),
            })),
          });
        }

        return ok({
          desde: await extremo(tx, desde),
          hasta: await extremo(tx, hasta),
          ...calcularDiferencia({
            catalogoDeModulos,
            catalogoDePerillas,
            desde,
            hasta,
            tenants,
            ahora: contexto.ahora,
          }),
        });
      },
    );
  };
}
