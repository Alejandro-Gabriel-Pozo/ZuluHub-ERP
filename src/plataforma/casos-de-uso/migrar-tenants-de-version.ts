import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import { ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import { exigirAccionDePlataforma } from "../consultas/comun";
import { validarLargoDelMotivo, validarVigencia } from "../dominio/formas-de-entrada";
import {
  claveDeIdempotenciaDelTenantDelLote,
  validarLote,
  type ErrorDeLote,
  type TenantDelLoteAMigrar,
} from "../dominio/lote-de-migracion";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import {
  asignarAUnTenant,
  DECLARACION_DE_ASIGNAR_PLAN,
  type ErrorAlAsignarPlan,
} from "./asignar-plan";
import type { DependenciasDeMarcasYPlanes, ErrorPlano } from "./marcas-y-planes-comun";

/** La operación con la que se guarda la clave de idempotencia de CADA tenant del lote (la tabla exige `^[a-z_.]+$`). */
export const OPERACION_MIGRAR_TENANT_DE_VERSION = "planes.migrar_tenant_de_version";

/**
 * El caso de uso y la acción que exige al guard: la de asignar, por cada tenant (cruce X1 de ADR-003). No
 * hay una acción propia del lote: migrar es asignar a muchos.
 */
export const DECLARACION_DE_MIGRAR_TENANTS_DE_VERSION =
  DECLARACION_DE_ASIGNAR_PLAN satisfies DeclaracionDeAccionDePlataforma;

export type EntradaDeMigrarTenantsDeVersion = Readonly<{
  /**
   * Identifica el lote: letras, dígitos y guion, de 1 a 64. La clave de idempotencia de cada tenant es
   * `lote_<claveDeLote>_<tenantId>`: repetir el lote con la misma clave rehace SOLO lo que falló.
   */
  claveDeLote: string;
  /** La versión PUBLICADA a la que pasan todos los tenants del lote. */
  versionDePlanId: string;
  vigenteDesde: Date;
  motivo: string;
  /** De 1 a 200 tenants, cada uno con el número de la última asignación que vio quien migra. */
  tenants: readonly TenantDelLoteAMigrar[];
  reemplazaProgramada: boolean;
}>;

/**
 * Lo que pasó con un tenant del lote:
 *  - `MIGRADO`: se le insertó la asignación (`numero` es el suyo). Si `repetido`, la insertó una llamada
 *    anterior con la misma clave de lote: esta no escribió nada.
 *  - `YA_ESTABA`: la versión pedida ya regía y no había nada programado: no se escribió nada.
 *  - `ERROR`: no se migró; `error` dice por qué (los de `asignarPlan`). Reintentar el lote lo rehace.
 */
export type ResultadoDeTenantDelLote = Readonly<
  | {
      tenantId: string;
      resultado: "MIGRADO" | "YA_ESTABA";
      numero: number;
      repetido: boolean;
      error: null;
    }
  | {
      tenantId: string;
      resultado: "ERROR";
      numero: null;
      repetido: false;
      error: ErrorAlAsignarPlan;
    }
>;

export type SalidaDeMigrarTenantsDeVersion = Readonly<{
  /** Uno por tenant, en el orden del pedido. */
  resultados: readonly ResultadoDeTenantDelLote[];
}>;

type ErrorPropio = ErrorDeLote | "ID_INVALIDO" | "VIGENCIA_INVALIDA" | "MOTIVO_DEMASIADO_LARGO";

/** Lo que falla ANTES de tocar a ningún tenant: el guard y la forma del pedido. Lo de cada tenant va en su resultado. */
export type ErrorAlMigrarTenantsDeVersion = ErrorPlano<
  MotivoDeRechazo | ErrorDePersistencia | ErrorPropio
>;

/**
 * Migrar un lote de tenants a otra versión de plan (M5, escalera N2). Contexto de PLATAFORMA, solo ADMIN.
 * Es `asignarPlan` con origen `MIGRACION_DE_VERSION` para cada tenant elegido, UNA TRANSACCIÓN POR TENANT:
 * lo que sale bien queda aunque otro falle (cada uno con su asignación, su constancia
 * `PLAN_MIGRADO_POR_LOTE` con la clave del lote y la de cada empresa), y el resultado cuenta uno por uno.
 * Cada tenant lleva su `numeroEsperado`: si cambió desde que se miró la diferencia, es
 * `VERSION_DESACTUALIZADA` solo para ese. Repetir el lote con la misma clave —o dos veces a la vez— no
 * duplica nada: lo ya hecho encuentra su clave y se informa como `repetido`.
 */
export function armarMigrarTenantsDeVersion(dependencias: DependenciasDeMarcasYPlanes) {
  return async function migrarTenantsDeVersion(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeMigrarTenantsDeVersion,
  ): Promise<Resultado<SalidaDeMigrarTenantsDeVersion, ErrorAlMigrarTenantsDeVersion>> {
    if ((contexto as Readonly<{ tipo: string }>).tipo !== "PLATAFORMA") {
      throw new RangeError("plataforma: el contexto no es de plataforma");
    }
    // El guard es lo PRIMERO, en su propia lectura: quien no puede asignar no se entera de si el lote está bien armado.
    const permiso = await dependencias.transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      (tx) =>
        exigirAccionDePlataforma(
          dependencias.reglas,
          DECLARACION_DE_MIGRAR_TENANTS_DE_VERSION.accion,
          tx.autorizacionDePlataforma,
          contexto,
        ),
    );
    if (!permiso.ok) return permiso;

    const lote = validarLote(entrada.claveDeLote, entrada.tenants);
    if (!lote.ok) return lote;
    const version = uuidDesdeTexto(entrada.versionDePlanId);
    if (!version.ok) return version;
    const vigencia = validarVigencia(entrada.vigenteDesde);
    if (!vigencia.ok) return vigencia;
    const motivo = validarLargoDelMotivo(entrada.motivo);
    if (!motivo.ok) return motivo;

    const resultados: ResultadoDeTenantDelLote[] = [];
    for (const tenant of lote.valor) {
      const hecha = await asignarAUnTenant(
        dependencias,
        contexto,
        {
          claveDeIdempotencia: claveDeIdempotenciaDelTenantDelLote(
            entrada.claveDeLote,
            tenant.tenantId,
          ),
          tenantId: tenant.tenantId,
          versionDePlanId: version.valor,
          vigenteDesde: vigencia.valor,
          motivo: motivo.valor,
          numeroEsperado: tenant.numeroEsperado,
          reemplazaProgramada: entrada.reemplazaProgramada,
        },
        {
          origen: "MIGRACION_DE_VERSION",
          operacion: OPERACION_MIGRAR_TENANT_DE_VERSION,
          accionDeAuditoria: "PLAN_MIGRADO_POR_LOTE",
          lote: entrada.claveDeLote,
        },
      );
      resultados.push(
        hecha.ok
          ? {
              tenantId: tenant.tenantId,
              resultado: hecha.valor.resultado === "ASIGNADO" ? "MIGRADO" : "YA_ESTABA",
              numero: hecha.valor.numero,
              repetido: hecha.valor.repetida,
              error: null,
            }
          : {
              tenantId: tenant.tenantId,
              resultado: "ERROR",
              numero: null,
              repetido: false,
              error: hecha.error,
            },
      );
    }
    return ok({ resultados });
  };
}
