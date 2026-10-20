import { sql, type Kysely, type Selectable } from "kysely";
import type { ValorDePerilla } from "../../../capacidades/planes/valores";
import {
  empresaId,
  planId,
  tenantId,
  versionDePlanId,
  type EmpresaId,
  type PlanId,
  type TenantId,
  type VersionDePlanId,
} from "../../../primitivas/identificadores/marca";
import type { OrigenDeAsignacion } from "../dominio/asignacion";
import type { PlanesDePlataformaDb } from "./tablas";

/**
 * Repositorio de planes, asignaciones, ajustes y módulos de empresa para la PLATAFORMA (ADR-005, ADR-009;
 * M5). Las mismas reglas del repositorio de marcas:
 *
 *  - Es de plataforma: la aplicación solo LEE lo suyo (`lecturas.ts`); la plataforma escribe, y solo un ADMIN.
 *  - Los cambios sobre una fila existente son `UPDATE ... WHERE version = <la que se leyó>` y devuelven la
 *    fila nueva o `null`. Las asignaciones y los ajustes son solo inserción: se corrigen con otra fila.
 *  - Ninguna restricción de la base se atrapa acá: salen tal cual y el adaptador de transacciones las
 *    traduce a `ErrorDePersistencia` (la traducción a motivos de negocio está en `traducir.ts`).
 *  - Quién publica, asigna o ajusta NO lo elige quien llama: lo escribe `app_actor_plataforma()`, el actor
 *    del contexto firmado, y la política de la base exige que coincida.
 */

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

type FilaDePlan = Selectable<PlanesDePlataformaDb["plan"]>;
type FilaDeVersion = Selectable<PlanesDePlataformaDb["version_de_plan"]>;
type FilaDeAjuste = Selectable<PlanesDePlataformaDb["ajuste_de_perilla"]>;
type FilaDeModulo = Selectable<PlanesDePlataformaDb["modulo_de_empresa"]>;

const ORIGENES: readonly OrigenDeAsignacion[] = ["ALTA", "CAMBIO", "MIGRACION_DE_VERSION"];

/** Un valor de la base que el CHECK correspondiente no deja pasar: si llega otro, algo se rompió. */
function deLaLista<T extends string>(lista: readonly T[], valor: string, nombre: string): T {
  const encontrado = lista.find((v) => v === valor);
  if (encontrado === undefined) throw new RangeError(`${nombre} desconocido en la base: ${valor}`);
  return encontrado;
}

function aPlan(fila: FilaDePlan): PlanGuardado {
  return {
    id: planId(fila.id),
    codigo: fila.codigo,
    estado: deLaLista(["ACTIVO", "RETIRADO"], fila.estado, "estado de plan"),
    version: fila.version,
  };
}

/** Las perillas de una versión: la base impone la forma del objeto (`perillas_validas`). */
function perillasDe(json: unknown): Readonly<Record<string, ValorDePerilla>> {
  return typeof json === "object" && json !== null && !Array.isArray(json)
    ? (json as Readonly<Record<string, ValorDePerilla>>)
    : {};
}

function aVersion(fila: FilaDeVersion): VersionDePlanGuardada {
  return {
    id: versionDePlanId(fila.id),
    planId: planId(fila.plan_id),
    numero: fila.numero,
    estado: fila.estado === "PUBLICADA" ? "PUBLICADA" : "BORRADOR",
    nombreComercial: fila.nombre_comercial,
    modulos: fila.modulos,
    perillas: perillasDe(fila.perillas),
    motivo: fila.motivo,
    publicadaEn: fila.publicada_en,
    publicadaPor: fila.publicada_por,
    version: fila.version,
  };
}

/** `version_de_plan_publicada_ck`: una versión PUBLICADA siempre trae número, fecha, actor y motivo. */
function aPublicada(fila: FilaDeVersion): VersionPublicadaDePlan {
  const v = aVersion(fila);
  if (v.numero === null || v.motivo === null || v.publicadaEn === null || v.publicadaPor === null) {
    throw new RangeError(`la versión de plan ${fila.id} publicada no está completa`);
  }
  return {
    ...v,
    numero: v.numero,
    motivo: v.motivo,
    publicadaEn: v.publicadaEn,
    publicadaPor: v.publicadaPor,
  };
}

function aAjuste(fila: FilaDeAjuste): AjusteCompleto {
  return {
    id: fila.id,
    tenantId: tenantId(fila.tenant_id),
    empresaId: fila.empresa_id === null ? null : empresaId(fila.empresa_id),
    perilla: fila.perilla,
    numero: fila.numero,
    valor: fila.valor,
    vigenteDesde: fila.vigente_desde,
    reemplazaProgramada: fila.reemplaza_programada,
    motivo: fila.motivo,
    asignadoPor: fila.asignado_por,
    creadoEn: fila.creado_en,
  };
}

function aModulo(fila: FilaDeModulo): ModuloDeEmpresaGuardado {
  return {
    empresaId: empresaId(fila.empresa_id),
    modulo: fila.modulo,
    activo: fila.activo,
    version: fila.version,
  };
}

/** Las columnas de la versión que el borrador escribe, a partir de un contenido. */
function columnasDelContenido(contenido: ContenidoDeVersionDePlanGuardable) {
  return {
    nombre_comercial: contenido.nombreComercial,
    modulos: [...contenido.modulos],
    perillas: JSON.stringify(contenido.perillas),
  };
}

export function crearRepositorioDePlanes(db: Kysely<PlanesDePlataformaDb>): RepositorioDePlanes {
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
    async obtenerPlan(id) {
      const fila = await db.selectFrom("plan").selectAll().where("id", "=", id).executeTakeFirst();
      return fila === undefined ? null : aPlan(fila);
    },

    async obtenerPlanPorCodigo(codigo) {
      const fila = await db
        .selectFrom("plan")
        .selectAll()
        .where("codigo", "=", codigo)
        .executeTakeFirst();
      return fila === undefined ? null : aPlan(fila);
    },

    async listarPlanes() {
      const filas = await db.selectFrom("plan").selectAll().orderBy("codigo", "asc").execute();
      return filas.map(aPlan);
    },

    async crearPlan(codigo) {
      const fila = await db
        .insertInto("plan")
        .values({ codigo })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aPlan(fila);
    },

    async versionPorId(id) {
      const fila = await db
        .selectFrom("version_de_plan")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aVersion(fila);
    },

    async borradorDe(plan) {
      const fila = await db
        .selectFrom("version_de_plan")
        .selectAll()
        .where("plan_id", "=", plan)
        .where("estado", "=", "BORRADOR")
        .executeTakeFirst();
      return fila === undefined ? null : aVersion(fila);
    },

    async publicadasDe(plan) {
      const filas = await db
        .selectFrom("version_de_plan")
        .selectAll()
        .where("plan_id", "=", plan)
        .where("estado", "=", "PUBLICADA")
        .orderBy("numero", "asc")
        .execute();
      return filas.map(aPublicada);
    },

    async versionesDeLosPlanes(planes) {
      if (planes.length === 0) return [];
      const filas = await db
        .selectFrom("version_de_plan")
        .selectAll()
        .where("plan_id", "in", planes)
        .orderBy("plan_id", "asc")
        .orderBy("numero", "asc")
        .execute();
      return filas.map(aVersion);
    },

    async crearBorrador(plan, contenido) {
      const fila = await db
        .insertInto("version_de_plan")
        .values({ plan_id: plan, ...columnasDelContenido(contenido) })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aVersion(fila);
    },

    async actualizarBorrador(id, versionEsperada, contenido) {
      const fila = await db
        .updateTable("version_de_plan")
        .set(columnasDelContenido(contenido))
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .where("estado", "=", "BORRADOR")
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aVersion(fila);
    },

    async publicar(id, versionEsperada, publicacion) {
      const fila = await db
        .updateTable("version_de_plan")
        .set({
          estado: "PUBLICADA",
          numero: publicacion.numero,
          motivo: publicacion.motivo,
          publicada_en: publicacion.publicadaEn,
          publicada_por: sql<string>`(select app_actor_plataforma())`,
        })
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .where("estado", "=", "BORRADOR")
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aPublicada(fila);
    },

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

    async ajustesDelTenant(tenant) {
      const filas = await db
        .selectFrom("ajuste_de_perilla")
        .selectAll()
        .where("tenant_id", "=", tenant)
        .orderBy("perilla", "asc")
        .orderBy("empresa_id", "asc")
        .orderBy("numero", "asc")
        .execute();
      return filas.map(aAjuste);
    },

    async serieDeAjustes(tenant, empresa, perilla) {
      const filas = await db
        .selectFrom("ajuste_de_perilla")
        .selectAll()
        .where("tenant_id", "=", tenant)
        .where("perilla", "=", perilla)
        .where((eb) =>
          empresa === null ? eb("empresa_id", "is", null) : eb("empresa_id", "=", empresa),
        )
        .orderBy("numero", "asc")
        .execute();
      return filas.map(aAjuste);
    },

    async ajustar(nuevo) {
      const fila = await db
        .insertInto("ajuste_de_perilla")
        .values({
          tenant_id: nuevo.tenantId,
          empresa_id: nuevo.empresaId,
          perilla: nuevo.perilla,
          numero: nuevo.numero,
          valor: nuevo.valor,
          vigente_desde: nuevo.vigenteDesde,
          reemplaza_programada: nuevo.reemplazaProgramada,
          motivo: nuevo.motivo,
          asignado_por: sql<string>`(select app_actor_plataforma())`,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aAjuste(fila);
    },

    async modulosDeLasEmpresas(empresas) {
      if (empresas.length === 0) return [];
      const filas = await db
        .selectFrom("modulo_de_empresa")
        .selectAll()
        .where("empresa_id", "in", empresas)
        .orderBy("empresa_id", "asc")
        .orderBy("modulo", "asc")
        .execute();
      return filas.map(aModulo);
    },

    async activarModulo(empresa, modulo, existente) {
      if (existente === null) {
        const fila = await db
          .insertInto("modulo_de_empresa")
          .values({ empresa_id: empresa, modulo })
          .returningAll()
          .executeTakeFirstOrThrow();
        return aModulo(fila);
      }
      const fila = await db
        .updateTable("modulo_de_empresa")
        .set({ activo: true })
        .where("empresa_id", "=", existente.empresaId)
        .where("modulo", "=", existente.modulo)
        .where("version", "=", existente.version)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aModulo(fila);
    },

    async desactivarModulo(existente) {
      const fila = await db
        .updateTable("modulo_de_empresa")
        .set({ activo: false })
        .where("empresa_id", "=", existente.empresaId)
        .where("modulo", "=", existente.modulo)
        .where("version", "=", existente.version)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aModulo(fila);
    },
  };
}
