import type { CatalogoComercial } from "../../capacidades/modulos/catalogo";
import type { ReglasDePlataforma } from "../../capacidades/permisos/plataforma";
import type { AmbitoDePerilla } from "../../capacidades/planes/perillas";
import type { ValorDePerilla } from "../../capacidades/planes/valores";
import type { RolDeLaMembresia } from "../../capacidades/permisos/roles";
import type {
  EstadoDeEmpresa,
  EstadoDeTenant,
  EstadoEfectivo,
  EstadosDeEmpresa,
} from "../../contexto/estados";
import type { EstadoGuardado, Invitacion, Persona } from "../../modulos/identidad/publico";
import type {
  EstadoDeDominio,
  SuperficieDeDominio,
  TitularDeDominio,
} from "../../modulos/marcas/publico";
import type { AjusteGuardado } from "../../modulos/planes/publico";
import type {
  EmpresaId,
  InvitacionId,
  MarcaComercialId,
  PersonaId,
  PlanId,
  TenantId,
  VersionDePlanId,
} from "../../primitivas/identificadores/marca";
import type { CargaDeAutorizacionDePlataforma } from "../../puertos/autorizacion-de-plataforma";
import type { Dato } from "../../puertos/sin-secretos";
import type { Transacciones } from "../../puertos/transacciones";
import type {
  CombinacionDeEstados,
  CriterioDeBusqueda,
  EntradaDePagina,
  Pagina,
} from "../dominio/soporte/consulta";
import type { CatalogoDePerillasParaPlanes } from "../casos-de-uso/marcas-y-planes-comun";

/**
 * Lo que la plataforma LEE para el soporte (H5 §B.5.9): una interfaz de solo lectura, con tipos de
 * lectura y nada más. La implementa `adaptadores/postgres/soporte-de-plataforma.ts` con el rol de
 * plataforma, que NO tiene permiso sobre las tablas operativas: `sucursal`, `asignacion_sucursal`,
 * `invitacion_sucursal`, `auditoria_empresa`. Ninguna de estas lecturas las toca, ni devuelve el hash
 * de ningún token.
 *
 * Todas las listas se devuelven ordenadas por id, de a `limite` renglones desde `despuesDeId`
 * (exclusivo): una página estable, aunque lleguen renglones nuevos.
 */

/**
 * La marca de un tenant (la «submarca» de la consola): el tenant la tiene desde que nace y no cambia
 * (`tenant.marca_id` es inmutable). El nombre visible es el de la versión VIGENTE de esa marca; `null` si
 * todavía no tiene ninguna.
 */
export type MarcaDeTenant = Readonly<{
  marcaId: MarcaComercialId;
  marcaCodigo: string;
  marcaNombreVisible: string | null;
}>;

/**
 * El plan que rige hoy en un tenant: la asignación de mayor número entre las que ya empezaron («la última
 * decisión manda», `vigenteEn`). Todo `null` si ninguna asignación empezó todavía. `planProgramado` dice si hay
 * una asignación que va a regir más adelante y que nada deja sin efecto (el estado `PROGRAMADA` de
 * `estadoDeDecision`).
 */
export type PlanVigenteDeTenant = Readonly<{
  planId: PlanId | null;
  versionDePlanId: VersionDePlanId | null;
  planCodigo: string | null;
  planNombreComercial: string | null;
  planVersionNumero: number | null;
  planProgramado: boolean;
}>;

/** Un tenant tal como lo lee la base: con su marca, su plan vigente y cuántas empresas ocupan lugar. */
export type FilaDeTenant = MarcaDeTenant &
  PlanVigenteDeTenant &
  Readonly<{
    id: TenantId;
    nombre: string;
    estado: EstadoDeTenant;
    motivoEstado: string | null;
    creadoEn: Date;
    /** Las empresas del tenant que no están canceladas: las que cuentan contra `empresas_por_tenant`. */
    empresasEnUso: number;
    /**
     * Lo que fija la versión de plan vigente para sus perillas (`jsonb`), sin interpretar: la consulta lo
     * lee con `derechosDeUso` para resolver el límite de empresas. `null` si el tenant no tiene plan vigente.
     */
    perillasDelPlan: Readonly<Record<string, unknown>> | null;
  }>;

/** Los criterios de la lista de tenants; `null` = no filtra por eso. */
export type FiltroDeTenants = Readonly<{
  marcaId: MarcaComercialId | null;
  /** Solo los tenants cuyo plan vigente es de ese plan. */
  planId: PlanId | null;
  /** Se busca en el nombre del tenant. */
  buscar: CriterioDeBusqueda | null;
}>;

/** Un ajuste de perilla de TODO el tenant (sin empresa), con el tenant al que pertenece. */
export type AjusteDeUnTenant = AjusteGuardado & Readonly<{ tenantId: TenantId }>;

export type FilaDeEmpresa = Readonly<{
  id: EmpresaId;
  tenantId: TenantId;
  cuit: string;
  razonSocial: string;
  estado: EstadoDeEmpresa;
  motivoEstado: string | null;
  /** El estado del tenant dueño: junto con el de la empresa da el estado efectivo. */
  estadoDelTenant: EstadoDeTenant;
  zonaHoraria: string;
  moneda: string;
  creadoEn: Date;
}>;

/** Una empresa con el nombre de su tenant, la marca de éste y su plan vigente (lo que muestra la lista de empresas). */
export type FilaDeEmpresaAmpliada = FilaDeEmpresa &
  MarcaDeTenant &
  PlanVigenteDeTenant &
  Readonly<{ tenantNombre: string }>;

export type FiltroDeEmpresas = Readonly<{
  tenantId: TenantId | null;
  estado: EstadoDeEmpresa | null;
  /** Solo las empresas cuyo tenant es de esa marca. */
  marcaId: MarcaComercialId | null;
  /** Solo las empresas cuyo tenant tiene como plan vigente uno de ese plan. */
  planId: PlanId | null;
  /**
   * Los pares (estado del tenant, estado de la empresa) que producen el estado efectivo pedido
   * (`combinacionesDeEstadoEfectivo`); `null` = no filtra por estado efectivo.
   */
  estadosEfectivos: readonly CombinacionDeEstados[] | null;
  /** Se busca en la razón social, el CUIT (sin guiones) y el nombre del tenant. */
  buscar: CriterioDeBusqueda | null;
}>;

export type FiltroDeInvitaciones = Readonly<{
  tenantId: TenantId | null;
  empresaId: EmpresaId | null;
  estado: EstadoGuardado | null;
}>;

/** Un trabajo fallido, tal como lo ve soporte: sin la clave de idempotencia ni nada de la cola interna. */
export type FilaDeTrabajoFallido = Readonly<{
  id: string;
  tipo: string;
  /** `null`: trabajo del ámbito plataforma. */
  empresaId: EmpresaId | null;
  intentos: number;
  ultimoError: string | null;
  datos: Dato;
  creadoEn: Date;
  actualizadoEn: Date;
}>;

export type FiltroDeAuditoria = Readonly<{
  entidad: string | null;
  entidadId: string | null;
  /** Inclusivo. */
  desde: Date | null;
  /** Inclusivo. */
  hasta: Date | null;
}>;

/** Un renglón de la auditoría de plataforma. `id` es un entero de la base, como texto. */
export type FilaDeAuditoria = Readonly<{
  id: string;
  actor: string;
  accion: string;
  entidad: string;
  entidadId: string;
  antes: Dato;
  despues: Dato;
  creadoEn: Date;
}>;

/** Una referencia de error registrada: el motivo tipado, sin ningún dato de negocio. */
export type FilaDeReferencia = Readonly<{
  referencia: string;
  accion: string;
  motivo: string;
  empresaId: EmpresaId | null;
  personaId: PersonaId | null;
  creadoEn: Date;
}>;

/**
 * La membresía de una persona en una empresa tal como la ve la plataforma: SOLO las cuatro columnas
 * que el rol de plataforma puede leer (decisión F1). Sin versión, sin fechas, sin invitación.
 */
export type MembresiaVisible = Readonly<{
  empresaId: EmpresaId;
  personaId: PersonaId;
  rol: RolDeLaMembresia;
  activo: boolean;
}>;

// --- Lo que piden y devuelven la lista de tenants y la de empresas ---------------------------------------

/** El pedido de la lista de tenants: la página y, si se quiere, a qué marca, a qué plan y a qué nombre acotarla. */
export type EntradaDeListarTenants = EntradaDePagina &
  Readonly<{
    /** Solo los tenants de esa marca (id de la marca). */
    marcaId?: string | undefined;
    /** Solo los tenants cuyo plan vigente es de ese plan (id del plan). */
    planId?: string | undefined;
    /** Texto (1 a 200 caracteres) que se busca en el nombre del tenant, sin distinguir mayúsculas. */
    buscar?: string | undefined;
  }>;

/** Un tenant de la lista: lo leído más el límite de empresas que le rige. */
export type VistaDeTenant = Omit<FilaDeTenant, "perillasDelPlan"> &
  Readonly<{
    /**
     * La perilla `empresas_por_tenant` efectiva (ajuste vigente del tenant, si no la del plan, si no la base)
     * contra la que se compara `empresasEnUso`; `"ILIMITADO"` si no tiene tope; `null` si el catálogo de
     * perillas no la conoce.
     */
    limiteDeEmpresas: number | "ILIMITADO" | null;
  }>;

/** El pedido de la lista de empresas: la página y los criterios, todos opcionales y combinables (se suman con Y). */
export type EntradaDeListarEmpresas = EntradaDePagina &
  Readonly<{
    /** Solo las empresas de ese tenant. */
    tenantId?: string | undefined;
    /** Solo las empresas en ese estado GUARDADO (`PROVISIONING`, `ACTIVE`, `SUSPENDED`, `CANCELLED`, `DELETING`). */
    estado?: string | undefined;
    /** Solo las empresas cuyo tenant es de esa marca (id de la marca). */
    marcaId?: string | undefined;
    /** Solo las empresas cuyo tenant tiene como plan vigente uno de ese plan (id del plan). */
    planId?: string | undefined;
    /** Solo las empresas en ese estado EFECTIVO (el que combina el suyo con el de su tenant). */
    estadoEfectivo?: string | undefined;
    /** Texto (1 a 200 caracteres) que se busca en la razón social, el CUIT (con o sin guiones) y el nombre del tenant, sin distinguir mayúsculas. */
    buscar?: string | undefined;
  }>;

/** Una empresa con su estado efectivo (el que combina el suyo con el de su tenant). */
export type VistaDeEmpresa = FilaDeEmpresaAmpliada & Readonly<{ estadoEfectivo: EstadoEfectivo }>;

// --- catalogoDePerillas -------------------------------------------------------------------------------

/** Una perilla del catálogo: una función configurable por venta. */
export type PerillaDelCatalogo = Readonly<{
  perilla: string;
  tipo: "INTERRUPTOR" | "LIMITE";
  /** Dónde se CUENTA el uso. */
  ambito: AmbitoDePerilla;
  /** El estándar: lo que rige si ni el plan ni un ajuste dicen otra cosa. */
  valorBase: ValorDePerilla;
  /** Otra perilla que tiene que estar encendida para que ésta valga; `null` si no depende de ninguna. */
  requiere: string | null;
  /** El módulo que la verifica. */
  modulo: string;
}>;

/** El catálogo de perillas del código, por clave. */
export type VistaDeCatalogoDePerillas = Readonly<{ perillas: readonly PerillaDelCatalogo[] }>;

/** Las listas de nivel 1 y la búsqueda de referencias. */
/** Qué dominios de empresa se piden: los de una empresa y/o en un estado; sin filtro, todos los de empresas. */
export type FiltroDeDominios = Readonly<{
  /** Solo ese dominio (y solo si es de una empresa): lo usan las acciones de la consola para no actuar sobre un dominio de marca. */
  dominioId: string | null;
  empresaId: EmpresaId | null;
  estado: EstadoDeDominio | null;
}>;

/**
 * Un dominio de una empresa tal como lo ve la consola: el host, qué muestra, de quién es, en qué estado está y la `version` (la que lee el caso de uso al
 * cambiarlo). Sin el actor que lo registró ni ningún dato de la base que la pantalla no use.
 */
export type FilaDeDominio = Readonly<{
  id: string;
  host: string;
  superficie: SuperficieDeDominio;
  titular: TitularDeDominio;
  estado: EstadoDeDominio;
  verificadoEn: Date | null;
  motivo: string | null;
  version: number;
  empresaId: EmpresaId;
  razonSocial: string;
}>;

export interface LecturaDeNivel1 {
  /** Los dominios de empresas (los de una marca no entran), con la razón social de su empresa: UNA sentencia con join, ordenada por id. */
  listarDominios(filtro: FiltroDeDominios, pagina: Pagina): Promise<FilaDeDominio[]>;
  /**
   * Los tenants con su marca, su plan vigente a `ahora` y cuántas empresas no canceladas tienen: UNA
   * sentencia con joins, no una por fila.
   */
  listarTenants(filtro: FiltroDeTenants, pagina: Pagina, ahora: Date): Promise<FilaDeTenant[]>;
  /**
   * Los ajustes de esa perilla que valen para TODO el tenant (`empresa_id` nulo), de todos esos tenants, en
   * una sentencia: con ellos y el plan vigente se resuelve el límite efectivo sin una lectura por tenant.
   */
  ajustesDeTenants(
    tenants: readonly TenantId[],
    perilla: string,
  ): Promise<readonly AjusteDeUnTenant[]>;
  /**
   * Las empresas con el nombre de su tenant, la marca y el plan vigente a `ahora`: UNA sentencia con
   * joins, no una por fila.
   */
  listarEmpresas(
    filtro: FiltroDeEmpresas,
    pagina: Pagina,
    ahora: Date,
  ): Promise<FilaDeEmpresaAmpliada[]>;
  /** Las empresas que siguen en `PROVISIONING`, con la ÚLTIMA invitación de su alta (`null`: ninguna). */
  listarAltasPendientes(
    pagina: Pagina,
  ): Promise<Array<Readonly<{ empresa: FilaDeEmpresa; invitacion: Invitacion | null }>>>;
  /** Cabeceras y empresas de las invitaciones, sin sucursales y sin el hash del token. */
  listarInvitaciones(filtro: FiltroDeInvitaciones, pagina: Pagina): Promise<Invitacion[]>;
  listarTrabajosFallidos(pagina: Pagina): Promise<FilaDeTrabajoFallido[]>;
  consultarAuditoria(filtro: FiltroDeAuditoria, pagina: Pagina): Promise<FilaDeAuditoria[]>;
  /** Todas las referencias con ese código (normalmente una; dos o más si colisionaron), de la más vieja a la nueva. */
  buscarReferencias(referencia: string): Promise<FilaDeReferencia[]>;
}

/** Los hechos que lee «explicar por qué»: identidad y estados, nunca datos operativos. */
export interface LecturaParaExplicar {
  /** El estado de cada empresa pedida y el de su tenant; las que no existen no aparecen. */
  estadosDeEmpresas(empresas: readonly EmpresaId[]): Promise<EstadosDeEmpresa>;
  personaPorEmail(email: string): Promise<Persona | null>;
  personaPorId(id: PersonaId): Promise<Persona | null>;
  /** Las membresías de la persona (activas o apagadas) en esas empresas. */
  membresiasDe(persona: PersonaId, empresas: readonly EmpresaId[]): Promise<MembresiaVisible[]>;
  /** Una invitación con sus empresas, sin sucursales y sin el hash del token; `null` si no existe. */
  invitacionPorId(id: InvitacionId): Promise<Invitacion | null>;
  /**
   * Los módulos que decide el guard, leídos como los lee `autorizacion.delActor`: los que la empresa tiene ACTIVADOS y los que el plan VIGENTE de su tenant a `ahora` incluye (el techo).
   * Una empresa que no se ve da ambas listas vacías (cierra).
   */
  modulosDeLaEmpresa(empresa: EmpresaId, ahora: Date): Promise<ModulosDeLaEmpresa>;
  /**
   * De dónde sale el conjunto de acciones de esa persona en esa empresa, leído como lo lee `autorizacion.delActor`: la versión vigente de la plantilla de cada rol base y, si tiene
   * rol propio, ese rol (activo o archivado) con su versión vigente. Sin membresía no hay nada que leer (`rolPropio` y plantillas en `null`).
   */
  fuentesDelConjunto(persona: PersonaId, empresa: EmpresaId): Promise<FuentesDelConjuntoLeidas>;
}

export type ModulosDeLaEmpresa = Readonly<{
  activados: readonly string[];
  habilitados: readonly string[];
}>;

/** Las acciones guardadas, tal como están en la base (el catálogo del código las filtra después, en `conjuntoEfectivo`). `null`: sin versión legible. */
export type FuentesDelConjuntoLeidas = Readonly<{
  plantillas: Readonly<Record<"ADMINISTRADOR" | "OPERADOR", readonly string[] | null>>;
  /** El rol propio al que apunta la membresía: `null` si no tiene o su versión no se pudo leer. */
  rolPropio: Readonly<{ activo: boolean; acciones: readonly string[] }> | null;
}>;

/** Todo lo que el adaptador de lectura de soporte ofrece. */
export type LecturaDeSoporte = LecturaDeNivel1 & LecturaParaExplicar;

/**
 * Lo que recibe el trabajo de una consulta de soporte: la lectura y la carga del administrador.
 * No hay auditoría, ni trabajos, ni idempotencia: por tipos, una consulta no escribe.
 */
export type TxDeConsultasDePlataforma = Readonly<{
  soporte: LecturaDeNivel1;
  autorizacionDePlataforma: CargaDeAutorizacionDePlataforma;
}>;

export type DependenciasDeConsultasDePlataforma = Readonly<{
  transacciones: Transacciones<TxDeConsultasDePlataforma>;
  /** El catálogo y la matriz de plataforma con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDePlataforma;
  /**
   * El catálogo comercial de módulos de las empresas (`capacidades/modulos/catalogo.ts`): es lo que
   * muestra «configuración», porque todavía no hay planes ni módulos activables por empresa (decisión
   * 19). Lo inyecta la composición; la matriz de roles de empresa NO se importa desde plataforma.
   */
  catalogoDeEmpresa: CatalogoComercial;
  /**
   * El catálogo de perillas con el que se resuelve el límite `empresas_por_tenant` de cada tenant (el real,
   * `CATALOGO_DE_PERILLAS`, en producción). Lo inyecta la composición, igual que en las consultas de planes.
   */
  catalogoDePerillas: CatalogoDePerillasParaPlanes;
}>;
