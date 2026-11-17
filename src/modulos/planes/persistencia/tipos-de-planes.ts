import type { ValorDePerilla } from "../../../capacidades/planes/valores";
import type {
  EmpresaId,
  PlanId,
  TenantId,
  VersionDePlanId,
} from "../../../primitivas/identificadores/marca";
import type { OrigenDeAsignacion } from "../dominio/asignacion";

export type EstadoDePlan = "ACTIVO" | "RETIRADO";

export type PlanGuardado = Readonly<{
  id: PlanId;
  codigo: string;
  estado: EstadoDePlan;
  version: number;
}>;

/** Lo que una versión de plan congela al publicarse (y lo que el borrador va acumulando). */
export type ContenidoDeVersionDePlanGuardable = Readonly<{
  nombreComercial: string;
  modulos: readonly string[];
  perillas: Readonly<Record<string, ValorDePerilla>>;
}>;

/** Una versión de plan tal como está guardada: el borrador (sin número) o una publicada. */
export type VersionDePlanGuardada = ContenidoDeVersionDePlanGuardable &
  Readonly<{
    id: VersionDePlanId;
    planId: PlanId;
    numero: number | null;
    estado: "BORRADOR" | "PUBLICADA";
    motivo: string | null;
    publicadaEn: Date | null;
    /** El actor de plataforma que la publicó (su id). */
    publicadaPor: string | null;
    /** El candado optimista de la fila (`versionEsperada` del borrador). */
    version: number;
  }>;

/** Una versión publicada: tiene número y quién la publicó. */
export type VersionPublicadaDePlan = VersionDePlanGuardada &
  Readonly<{ numero: number; motivo: string; publicadaEn: Date; publicadaPor: string }>;

/** Lo que se escribe al publicar un borrador. */
export type PublicacionPorEscribir = Readonly<{
  numero: number;
  motivo: string;
  /** El instante de la publicación (el `ahora` del contexto). */
  publicadaEn: Date;
}>;

/** Una asignación de plan del tenant con lo que hace falta saber de su versión y su plan. */
export type AsignacionGuardada = Readonly<{
  id: string;
  tenantId: TenantId;
  numero: number;
  versionDePlanId: VersionDePlanId;
  /** El plan de la versión asignada, su código y el número y nombre de esa versión. */
  planId: PlanId;
  planCodigo: string;
  versionNumero: number;
  nombreComercial: string;
  vigenteDesde: Date;
  origen: OrigenDeAsignacion;
  reemplazaProgramada: boolean;
  motivo: string;
  asignadoPor: string;
  creadoEn: Date;
}>;

/** Lo mínimo de una asignación para saber cuál rige (de cualquier tenant). */
export type AsignacionBasica = Readonly<{
  tenantId: TenantId;
  numero: number;
  vigenteDesde: Date;
  versionDePlanId: VersionDePlanId;
}>;

export type AsignacionPorEscribir = Readonly<{
  tenantId: TenantId;
  numero: number;
  versionDePlanId: VersionDePlanId;
  vigenteDesde: Date;
  origen: OrigenDeAsignacion;
  reemplazaProgramada: boolean;
  motivo: string;
}>;

/** Un ajuste de perilla tal como está guardado, con todo lo que la consulta de plataforma muestra. */
export type AjusteCompleto = Readonly<{
  id: string;
  tenantId: TenantId;
  /** `null`: el ajuste es de todo el tenant. */
  empresaId: EmpresaId | null;
  perilla: string;
  numero: number;
  /** El texto de la base (`valorDeAjuste` lo interpreta contra la perilla). */
  valor: string;
  vigenteDesde: Date;
  reemplazaProgramada: boolean;
  motivo: string;
  asignadoPor: string;
  creadoEn: Date;
}>;

export type AjustePorEscribir = Readonly<{
  tenantId: TenantId;
  empresaId: EmpresaId | null;
  perilla: string;
  numero: number;
  /** Ya en el texto que guarda la base (`textoDeAjuste`). */
  valor: string;
  vigenteDesde: Date;
  reemplazaProgramada: boolean;
  motivo: string;
}>;

/** Una fila de `modulo_de_empresa`: lo que la empresa activó (o desactivó; nada se borra). */
export type ModuloDeEmpresaGuardado = Readonly<{
  empresaId: EmpresaId;
  modulo: string;
  activo: boolean;
  version: number;
}>;

/**
 * Un tenant que tiene hoy una versión de plan como asignación VIGENTE, con lo que el lote de migración y la
 * consola necesitan de él: el último número de su serie de asignaciones (lo que `asignarPlan` y
 * `migrarTenantsDeVersion` llaman `numeroEsperado`), si hay algo programado y cuántas empresas ocupan lugar.
 */
export type TenantConLaVersionVigente = Readonly<{
  tenantId: TenantId;
  nombre: string;
  estado: "ACTIVE" | "SUSPENDED";
  marcaId: string;
  /** El MAYOR número de asignación del tenant (no el de la vigente): el próximo cambio tiene que decir que vio ése. */
  ultimoNumeroDeAsignacion: number;
  /** Hay una asignación que va a regir más adelante y que nada deja sin efecto. */
  hayProgramada: boolean;
  /** Las empresas del tenant que no están canceladas. */
  empresas: number;
}>;

export interface RepositorioDePlanes {
  // --- planes ---------------------------------------------------------------------------------------
  obtenerPlan(id: PlanId): Promise<PlanGuardado | null>;
  obtenerPlanPorCodigo(codigo: string): Promise<PlanGuardado | null>;
  /** Todos los planes, por código. */
  listarPlanes(): Promise<readonly PlanGuardado[]>;
  /** Registra el plan: nace `ACTIVO`. El código repetido lo impone la base. */
  crearPlan(codigo: string): Promise<PlanGuardado>;

  // --- versiones de plan ----------------------------------------------------------------------------
  versionPorId(id: VersionDePlanId): Promise<VersionDePlanGuardada | null>;
  /** El borrador del plan (a lo sumo uno); `null` si no hay. */
  borradorDe(plan: PlanId): Promise<VersionDePlanGuardada | null>;
  /** Las versiones publicadas del plan, por número ascendente. */
  publicadasDe(plan: PlanId): Promise<readonly VersionPublicadaDePlan[]>;
  /** Todas las versiones (borradores y publicadas) de esos planes, por plan y número. */
  versionesDeLosPlanes(planes: readonly PlanId[]): Promise<readonly VersionDePlanGuardada[]>;
  /** Abre el borrador. Un segundo borrador del mismo plan lo rechaza la base. */
  crearBorrador(
    plan: PlanId,
    contenido: ContenidoDeVersionDePlanGuardable,
  ): Promise<VersionDePlanGuardada>;
  /** Reemplaza el contenido del borrador solo si la versión coincide; `null` si no. */
  actualizarBorrador(
    id: VersionDePlanId,
    versionEsperada: number,
    contenido: ContenidoDeVersionDePlanGuardable,
  ): Promise<VersionDePlanGuardada | null>;
  /** Publica el borrador solo si la versión coincide; `null` si no (otra transacción cambió antes). */
  publicar(
    id: VersionDePlanId,
    versionEsperada: number,
    publicacion: PublicacionPorEscribir,
  ): Promise<VersionPublicadaDePlan | null>;

  // --- tenants y empresas ----------------------------------------------------------------------------
  /** El tenant de la empresa; `null` si la empresa no existe. */
  tenantDeLaEmpresa(empresa: EmpresaId): Promise<TenantId | null>;
  /** Las empresas del tenant (de cualquier estado), por id. */
  empresasDelTenant(tenant: TenantId): Promise<readonly EmpresaId[]>;
  /** ¿Existe el tenant? */
  existeElTenant(tenant: TenantId): Promise<boolean>;

  // --- asignaciones de plan -------------------------------------------------------------------------
  /** Todas las asignaciones del tenant, con su versión y su plan, por número ascendente. */
  asignacionesDelTenant(tenant: TenantId): Promise<readonly AsignacionGuardada[]>;
  /** Inserta la asignación (solo inserción). El número consecutivo lo impone la base. */
  asignar(nueva: AsignacionPorEscribir): Promise<AsignacionGuardada>;
  /**
   * Todas las asignaciones de los tenants que alguna vez tuvieron alguna de esas versiones (para saber
   * cuál rige hoy en cada uno).
   */
  asignacionesDeLosTenantsQueTuvieron(
    versiones: readonly VersionDePlanId[],
  ): Promise<readonly AsignacionBasica[]>;

  /**
   * Los tenants cuya asignación VIGENTE a `ahora` (la de mayor número entre las que ya empezaron) es esa
   * versión, ordenados por id, de a `limite` desde `despuesDeId` (exclusivo). UNA sentencia, con la misma
   * regla de vigencia que `vigenteEn` y `estadoDeDecision` escrita en SQL (una prueba las compara).
   */
  tenantsConLaVersionVigente(
    version: VersionDePlanId,
    ahora: Date,
    pagina: Readonly<{ limite: number; despuesDeId: TenantId | null }>,
  ): Promise<readonly TenantConLaVersionVigente[]>;

  // --- ajustes de perilla ---------------------------------------------------------------------------
  /** Todos los ajustes del tenant (de él y de sus empresas), por perilla, alcance y número. */
  ajustesDelTenant(tenant: TenantId): Promise<readonly AjusteCompleto[]>;
  /** La serie de UNA perilla en UN alcance (el tenant, o una empresa), por número ascendente. */
  serieDeAjustes(
    tenant: TenantId,
    empresa: EmpresaId | null,
    perilla: string,
  ): Promise<readonly AjusteCompleto[]>;
  /** Inserta el ajuste (solo inserción). El número consecutivo y la empresa del tenant los impone la base. */
  ajustar(nuevo: AjustePorEscribir): Promise<AjusteCompleto>;

  // --- módulos de empresa ---------------------------------------------------------------------------
  /** Todas las filas de módulos de las empresas (activas e inactivas), por empresa y módulo. */
  modulosDeLasEmpresas(empresas: readonly EmpresaId[]): Promise<readonly ModuloDeEmpresaGuardado[]>;
  /** Activa el módulo: lo inserta si no había fila, o lo reactiva solo si la versión coincide. `null`: la fila cambió. */
  activarModulo(
    empresa: EmpresaId,
    modulo: string,
    existente: ModuloDeEmpresaGuardado | null,
  ): Promise<ModuloDeEmpresaGuardado | null>;
  /** Desactiva el módulo solo si la versión coincide. `null`: la fila cambió. */
  desactivarModulo(existente: ModuloDeEmpresaGuardado): Promise<ModuloDeEmpresaGuardado | null>;
}
