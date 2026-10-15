import { clavesDe, estadoDeModulos } from "../../capacidades/modulos/activos";
import type { AjusteDePerilla } from "../../capacidades/planes/derechos";
import {
  diferenciaEntreVersiones as calcularDiferencia,
  type DiferenciaEntreVersiones,
  type TenantParaLaDiferencia,
} from "../../capacidades/planes/diferencia";
import {
  estadoDeDecision,
  vigenteEn,
  type EstadoDeDecision,
} from "../../capacidades/planes/vigencia";
import {
  valorDeAjuste,
  type OrigenDeValor,
  type ValorDePerilla,
} from "../../capacidades/planes/valores";
import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  interpretarAjustes,
  type AjusteCompleto,
  type AsignacionBasica,
  type AsignacionGuardada,
  type PlanGuardado,
  type VersionDePlanGuardada,
} from "../../modulos/planes/publico";
import {
  empresaId as comoEmpresaId,
  planId as comoPlanId,
  tenantId as comoTenantId,
  versionDePlanId as comoVersionDePlanId,
  type EmpresaId,
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

const LECTURA = { aislamiento: "read committed", soloLectura: true } as const;

// --- Lo común -------------------------------------------------------------------------------------------

/** La versión que rige hoy en cada tenant, a partir de todas sus asignaciones (de los tenants que se pasan). */
function versionVigentePorTenant(
  asignaciones: readonly AsignacionBasica[],
  ahora: Date,
): ReadonlyMap<TenantId, VersionDePlanId> {
  const porTenant = new Map<TenantId, AsignacionBasica[]>();
  for (const a of asignaciones)
    porTenant.set(a.tenantId, [...(porTenant.get(a.tenantId) ?? []), a]);
  const vigentes = new Map<TenantId, VersionDePlanId>();
  for (const [tenant, propias] of porTenant) {
    const vigente = vigenteEn(propias, ahora);
    if (vigente !== null) vigentes.set(tenant, vigente.versionDePlanId);
  }
  return vigentes;
}

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

export type ModulosDeUnaEmpresa = Readonly<{
  empresaId: EmpresaId;
  /** Los módulos que la empresa tiene o tuvo activados (nada se borra: los desactivados figuran con `activo: false`). */
  modulos: readonly Readonly<{ modulo: string; activo: boolean }>[];
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

async function modulosPorEmpresa(
  tx: TxDeConsultasDeMarcasYPlanes,
  tenant: TenantId,
): Promise<ModulosDeUnaEmpresa[]> {
  const empresas = await tx.planes.empresasDelTenant(tenant);
  const filas = await tx.planes.modulosDeLasEmpresas(empresas);
  return empresas.map((empresaId) => ({
    empresaId,
    modulos: filas
      .filter((f) => f.empresaId === empresaId)
      .map((f) => ({ modulo: f.modulo, activo: f.activo })),
  }));
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

// --- derechosDeUsoDeEmpresa -----------------------------------------------------------------------------

export type EstadoDelModuloParaLaEmpresa = "ACTIVO" | "SOLO_LECTURA" | "NO_ACTIVO";

export type ModuloEnLosDerechos = Readonly<{
  modulo: string;
  obligatorio: boolean;
  /** `false`: el módulo está en desarrollo; no se puede activar. */
  disponible: boolean;
  /** Dentro del techo del plan que rige (los obligatorios siempre). */
  habilitadoPorElPlan: boolean;
  /** La empresa lo tiene activado. */
  activado: boolean;
  estado: EstadoDelModuloParaLaEmpresa;
}>;

export type PerillaEnLosDerechos = Readonly<{
  perilla: string;
  valor: ValorDePerilla;
  origen: OrigenDeValor;
}>;

export type DerechosDeUsoDeEmpresa = Readonly<{
  empresaId: EmpresaId;
  tenantId: TenantId;
  /** El instante con que se calcularon. */
  leidoEn: Date;
  /** La versión de plan que rige; `null` si el tenant no tiene (solo los módulos obligatorios y las perillas base). */
  versionDePlan: Readonly<{
    planId: PlanId;
    versionDePlanId: VersionDePlanId;
    numero: number;
  }> | null;
  modulos: readonly ModuloEnLosDerechos[];
  perillas: readonly PerillaEnLosDerechos[];
}>;

export type ErrorAlVerDerechosDeUsoDeEmpresa =
  MotivoDeRechazo | "ID_INVALIDO" | "EMPRESA_NO_ENCONTRADA" | ErrorDePersistencia;

/**
 * Los derechos de uso de una empresa vistos desde la plataforma (§B.11): módulos habilitados por el plan y
 * activados por la empresa, con su estado para el guard, y cada perilla con su valor y su origen
 * (`BASE`, `PLAN`, `AJUSTE`). Es el mismo cálculo que ve la propia empresa. Sin uso: la plataforma no
 * cuenta datos operativos. `planes.ver`, solo lectura.
 */
export function armarDerechosDeUsoDeEmpresa({
  transacciones,
  reglas,
  catalogoDeModulos,
}: DependenciasDeConsultasDeMarcasYPlanes) {
  return async function derechosDeUsoDeEmpresa(
    contexto: ContextoDePlataforma,
    entrada: Readonly<{ empresaId: string }>,
  ): Promise<Resultado<DerechosDeUsoDeEmpresa, ErrorAlVerDerechosDeUsoDeEmpresa>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (tx): Promise<Resultado<DerechosDeUsoDeEmpresa, ErrorAlVerDerechosDeUsoDeEmpresa>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.derechosDeUsoDeEmpresa.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const id = uuidDesdeTexto(entrada.empresaId);
        if (!id.ok) return id;
        const empresa = comoEmpresaId(id.valor);
        const derechos = await tx.derechos.deLaEmpresaParaLaPlataforma(contexto, empresa);
        if (derechos === null) return err("EMPRESA_NO_ENCONTRADA");
        const filas = await tx.planes.modulosDeLasEmpresas([empresa]);
        const activados = filas.filter((f) => f.activo).map((f) => f.modulo);
        const estado = estadoDeModulos(catalogoDeModulos, activados, [
          ...derechos.modulosHabilitados,
        ]);
        return ok({
          empresaId: empresa,
          tenantId: derechos.tenantId,
          leidoEn: derechos.leidoEn,
          versionDePlan: derechos.versionDePlan,
          modulos: clavesDe(catalogoDeModulos).map((modulo) => {
            const definicion = catalogoDeModulos[modulo];
            return {
              modulo,
              obligatorio: definicion?.obligatorio ?? false,
              disponible: definicion?.estado === "disponible",
              habilitadoPorElPlan: derechos.modulosHabilitados.has(modulo),
              activado: activados.includes(modulo),
              estado: estado.modulosActivos.has(modulo)
                ? "ACTIVO"
                : estado.modulosEnSoloLectura.has(modulo)
                  ? "SOLO_LECTURA"
                  : "NO_ACTIVO",
            };
          }),
          perillas: [...derechos.perillas].map(([perilla, valor]) => ({
            perilla,
            valor:
              valor.tipo === "INTERRUPTOR"
                ? { tipo: valor.tipo, encendida: valor.encendida }
                : { tipo: valor.tipo, limite: valor.limite },
            origen: valor.origen,
          })),
        });
      },
    );
  };
}

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
