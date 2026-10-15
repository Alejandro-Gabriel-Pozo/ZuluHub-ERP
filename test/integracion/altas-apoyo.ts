import { randomBytes } from "node:crypto";
import type { Kysely } from "kysely";
import type pg from "pg";
import { crearAdminsDePostgres, type AdminsDb } from "../../src/adaptadores/postgres/admins";
import {
  crearAuditoriaDePostgres,
  type AuditoriaDb,
} from "../../src/adaptadores/postgres/auditoria";
import {
  crearAuditoriaDePlataformaDePostgres,
  type AuditoriaDePlataformaDb,
} from "../../src/adaptadores/postgres/auditoria-de-plataforma";
import {
  crearAutorizacionDePlataformaDePostgres,
  type AutorizacionDePlataformaDb,
} from "../../src/adaptadores/postgres/autorizacion-de-plataforma";
import { crearLecturaDeDerechosDeUso } from "../../src/adaptadores/postgres/derechos-de-uso";
import {
  crearIdempotenciaDePostgres,
  type IdempotenciaDb,
} from "../../src/adaptadores/postgres/idempotencia";
import { crearTrabajosDePostgres, type TrabajosDb } from "../../src/adaptadores/postgres/trabajos";
import {
  crearTransacciones,
  type SinTablas,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import { REGLAS_DE_PLATAFORMA } from "../../src/capacidades/permisos/plataforma";
import { CATALOGO_DE_PERILLAS } from "../../src/capacidades/planes/perillas";
import type { ContextoDePlataforma } from "../../src/contexto/contexto";
import {
  crearRepositorioDeEmpresas,
  crearRepositorioDeSucursales,
  type EmpresasDb,
} from "../../src/modulos/empresas/publico";
import {
  crearRepositorioDeInvitaciones,
  type IdentidadDb,
} from "../../src/modulos/identidad/publico";
import {
  crearLecturaDeMarcaParaElAlta,
  type LecturaParaElAltaDb,
} from "../../src/modulos/marcas/publico";
import {
  crearAsignacionesDePlanDelAlta,
  crearLecturaDePlanes,
  crearLecturaDeVersionesDePlanParaElAlta,
  crearModulosDeEmpresaDelAlta,
  type PlanesDb,
  type PlanesDelAltaDb,
} from "../../src/modulos/planes/publico";
import { crearRepositorioDeTenants, type TenantsDb } from "../../src/modulos/tenants/publico";
import {
  crearCasosDeUsoDeAltas,
  type CasosDeUsoDeAltas,
  type DependenciasDeAltas,
} from "../../src/plataforma/casos-de-uso/altas";
import type { TxDeAlta } from "../../src/plataforma/casos-de-uso/alta-nucleo";
import type { EntradaDeAltaDeEmpresa } from "../../src/plataforma/casos-de-uso/alta-de-empresa";
import type { Tokens } from "../../src/puertos/tokens";
import { MODULOS_DE_PRUEBA } from "../utilidades/planes";
import { SOPORTE_DE_PRUEBA } from "./admins-de-prueba";
import { cuitAlAzar } from "./entorno";
import type { BaseDePruebas } from "./global";
import {
  ajustarPerilla,
  asignarPlan,
  crearDominio,
  crearMarca,
  crearMundoDeMarca,
  crearPlanPublicado,
  crearVersionDeMarcaConfirmada,
  marcaPrincipal,
  type MundoDeMarca,
} from "./marcas-apoyo";
import { claveAlAzar } from "./plataforma-apoyo";
import { plataformaEn } from "./soporte-datos";

/**
 * Apoyo de las pruebas de integración del alta de empresas (H5 P5 y M6): arma la transacción de plataforma
 * con lo que armaría la composición (los repositorios de tenants, empresas, identidad, marcas y planes, la
 * auditoría, la idempotencia y los trabajos) sobre los roles REALES, y con ella los casos de uso. Todo
 * escenario (marcas, planes, tenants existentes) se prepara con el cliente del DUEÑO (`marcas-apoyo.ts`);
 * lo que se prueba pasa por el rol de plataforma y su contexto firmado.
 */

export type TxDeAltaDePrueba = TxDeAlta &
  Readonly<{
    /** Consultas de verificación y fallas provocadas, sin tipar. */
    db: Kysely<SinTablas>;
  }>;

/** Los pasos del alta tras los cuales las pruebas de atomicidad provocan una falla. */
export const PASOS_DEL_ALTA = [
  "tenant",
  "plan",
  "empresa",
  "sucursal",
  "modulos",
  "invitacion",
  "trabajo",
  "auditoria_de_empresa",
  "auditoria_de_plataforma",
  "idempotencia",
] as const;
export type PasoDelAlta = (typeof PASOS_DEL_ALTA)[number];

/** El error que provocan las pruebas de atomicidad: no es de la base, así que el adaptador lo relanza. */
export class FallaInyectada extends Error {
  constructor(paso: string) {
    super(`falla inyectada después de ${paso}`);
  }
}

/** Lo que cada paso hace de más cuando se lo envuelve: llama al original y, DESPUÉS, falla. */
function conFallaDespuesDe(paso: PasoDelAlta, tx: TxDeAltaDePrueba): TxDeAltaDePrueba {
  const despues = async <T>(valor: Promise<T>): Promise<T> => {
    await valor;
    throw new FallaInyectada(paso);
  };
  switch (paso) {
    case "tenant":
      return {
        ...tx,
        tenants: { ...tx.tenants, crear: (...a) => despues(tx.tenants.crear(...a)) },
      };
    case "plan":
      return {
        ...tx,
        asignacionesDePlan: {
          asignarEnElAlta: (...a) => despues(tx.asignacionesDePlan.asignarEnElAlta(...a)),
        },
      };
    case "empresa":
      return {
        ...tx,
        empresas: { ...tx.empresas, crear: (...a) => despues(tx.empresas.crear(...a)) },
      };
    case "sucursal":
      return {
        ...tx,
        sucursales: { ...tx.sucursales, sembrar: (...a) => despues(tx.sucursales.sembrar(...a)) },
      };
    case "modulos":
      return {
        ...tx,
        modulosDeEmpresa: { activar: (...a) => despues(tx.modulosDeEmpresa.activar(...a)) },
      };
    case "invitacion":
      return {
        ...tx,
        invitaciones: {
          ...tx.invitaciones,
          crear: (...a) => despues(tx.invitaciones.crear(...a)),
        },
      };
    case "trabajo":
      return {
        ...tx,
        trabajos: { ...tx.trabajos, encolar: (...a) => despues(tx.trabajos.encolar(...a)) },
      };
    case "auditoria_de_empresa":
      return { ...tx, auditoria: { registrar: (...a) => despues(tx.auditoria.registrar(...a)) } };
    case "auditoria_de_plataforma":
      return {
        ...tx,
        auditoriaDePlataforma: {
          registrar: (...a) => despues(tx.auditoriaDePlataforma.registrar(...a)),
        },
      };
    case "idempotencia":
      return {
        ...tx,
        idempotencia: {
          ...tx.idempotencia,
          registrar: (...a) => despues(tx.idempotencia.registrar(...a)),
        },
      };
  }
}

/** El entorno que usa la composición real; `ajustar` envuelve lo que recibe el trabajo (barrera, falla). */
export function crearEntornoDeAlta(
  base: BaseDePruebas,
  maximoDeConexiones = 5,
  ajustar: (tx: TxDeAltaDePrueba) => TxDeAltaDePrueba = (tx) => tx,
): TransaccionesDePostgres<TxDeAltaDePrueba> {
  return crearTransacciones<TxDeAltaDePrueba>({
    urls: {
      OPERATIVO: base.app,
      GRUPO: base.grupo,
      PLATAFORMA: base.plataforma,
      TRABAJOS: base.trabajos,
    },
    armar: (db, contexto) => {
      const planes = crearLecturaDePlanes(db.withTables<PlanesDb>());
      return ajustar({
        db,
        autorizacionDePlataforma: crearAutorizacionDePlataformaDePostgres(
          db.withTables<AutorizacionDePlataformaDb>(),
        ),
        auditoriaDePlataforma: crearAuditoriaDePlataformaDePostgres(
          db.withTables<AuditoriaDePlataformaDb>(),
          contexto,
        ),
        idempotencia: crearIdempotenciaDePostgres(db.withTables<IdempotenciaDb>(), contexto),
        admins: crearAdminsDePostgres(db.withTables<AdminsDb>()),
        tenants: crearRepositorioDeTenants(db.withTables<TenantsDb>()),
        empresas: crearRepositorioDeEmpresas(db.withTables<EmpresasDb>()),
        sucursales: crearRepositorioDeSucursales(db.withTables<EmpresasDb>()),
        invitaciones: crearRepositorioDeInvitaciones(db.withTables<IdentidadDb>()),
        trabajos: crearTrabajosDePostgres(db.withTables<TrabajosDb>()),
        auditoria: crearAuditoriaDePostgres(db.withTables<AuditoriaDb>()),
        marcas: crearLecturaDeMarcaParaElAlta(db.withTables<LecturaParaElAltaDb>()),
        versionesDePlan: crearLecturaDeVersionesDePlanParaElAlta(db.withTables<PlanesDelAltaDb>()),
        asignacionesDePlan: crearAsignacionesDePlanDelAlta(db.withTables<PlanesDelAltaDb>()),
        modulosDeEmpresa: crearModulosDeEmpresaDelAlta(db.withTables<PlanesDelAltaDb>()),
        derechos: crearLecturaDeDerechosDeUso(planes, {
          catalogoDeModulos: MODULOS_DE_PRUEBA,
          catalogoDePerillas: CATALOGO_DE_PERILLAS,
        }),
      });
    },
    maximoDeConexiones,
    clave: base.clave,
  });
}

/** Un entorno que, tras el paso dado, falla (para probar que no queda nada). */
export const crearEntornoConFallaDespuesDe = (base: BaseDePruebas, paso: PasoDelAlta) =>
  crearEntornoDeAlta(base, 3, (tx) => conFallaDespuesDe(paso, tx));

export const SECRETO_DE_PRUEBA: Buffer = randomBytes(32);

/** Una fábrica de invitaciones con secreto de prueba: la misma que usa la composición, sin entorno. */
export const tokensDePrueba = (): Tokens => crearTokensHmac(SECRETO_DE_PRUEBA);

/** Las dependencias de todos los casos del alta, sobre un mismo entorno de transacciones. */
export const dependenciasDeAltas = (
  entorno: TransaccionesDePostgres<TxDeAltaDePrueba>,
  tokens: Pick<Tokens, "emitir"> = tokensDePrueba(),
): DependenciasDeAltas => ({
  altaDeEmpresa: {
    transacciones: entorno,
    reglas: REGLAS_DE_PLATAFORMA,
    tokens,
    catalogoDeModulos: MODULOS_DE_PRUEBA,
  },
  cancelarAlta: { transacciones: entorno, reglas: REGLAS_DE_PLATAFORMA },
  cancelarAltasVencidas: { transacciones: entorno },
  reenviarInvitacionDelAlta: { transacciones: entorno, reglas: REGLAS_DE_PLATAFORMA, tokens },
  revocarInvitacionDelAlta: { transacciones: entorno, reglas: REGLAS_DE_PLATAFORMA },
  cicloDeVida: { transacciones: entorno, reglas: REGLAS_DE_PLATAFORMA },
});

export const crearCasosDeAlta = (
  entorno: TransaccionesDePostgres<TxDeAltaDePrueba>,
  tokens: Pick<Tokens, "emitir"> = tokensDePrueba(),
): CasosDeUsoDeAltas => crearCasosDeUsoDeAltas(dependenciasDeAltas(entorno, tokens));

// ---- el escenario: una marca lista para dar de alta, preparada con el cliente del dueño ----------------

export type MarcaLista = Readonly<{
  marca: string;
  host: string;
  plan: string;
  /** La versión PUBLICADA que recibe el tenant nuevo si no se elige otra. */
  version: string;
}>;

export type OpcionesDeMarcaLista = Readonly<{
  /** Usa la marca principal (la de las pruebas) en vez de crear un producto. */
  principal?: boolean;
  /** Los módulos que la marca propone al nacer una empresa (`null`: hereda; por defecto, ninguno). */
  modulosIniciales?: string[] | null;
  /** El techo de módulos del plan por defecto. */
  modulosDelPlan?: string[];
  /** Los valores de perillas del plan por defecto (p. ej. `empresas_por_tenant`). */
  perillasDelPlan?: Record<string, unknown>;
  /** El nombre visible de la versión confirmada (por defecto, el mismo para todas). */
  nombreVisible?: string;
  /** Sin versión confirmada. */
  sinVersion?: boolean;
  /** Sin host canónico activo. */
  sinDominio?: boolean;
}>;

/**
 * Una marca con su plan por defecto publicado, una versión confirmada y vigente que lo nombra, y un
 * host canónico activo de la aplicación: lo mínimo para que se le puedan dar de alta empresas.
 */
export async function crearMarcaLista(
  dueno: pg.Client,
  opciones: OpcionesDeMarcaLista = {},
): Promise<MarcaLista> {
  const marca = opciones.principal === true ? await marcaPrincipal(dueno) : await crearMarca(dueno);
  const { plan, version } = await crearPlanPublicado(dueno, {
    modulos: opciones.modulosDelPlan ?? [],
    perillas: opciones.perillasDelPlan ?? {},
  });
  if (opciones.sinVersion !== true) {
    await crearVersionDeMarcaConfirmada(dueno, marca, {
      nombreVisible: opciones.nombreVisible ?? "Marca de prueba",
      modulosIniciales: opciones.modulosIniciales === undefined ? [] : opciones.modulosIniciales,
      planPorDefecto: plan,
    });
  }
  const host =
    opciones.sinDominio === true ? "" : (await crearDominio(dueno, marca, { canonico: true })).host;
  return { marca, host, plan, version };
}

/**
 * Un tenant que ya existe en esa marca, con una empresa ACTIVA y la versión por defecto de la marca asignada
 * (o la que se indique). `empresasPorTenant` fija el tope con un ajuste de todo el tenant.
 */
export async function crearTenantConPlan(
  dueno: pg.Client,
  m: MarcaLista,
  opciones: { version?: string; empresasPorTenant?: string; estado?: "ACTIVE" | "SUSPENDED" } = {},
): Promise<MundoDeMarca> {
  const mundo = await crearMundoDeMarca(dueno, {
    marca: m.marca,
    estado: "ACTIVE",
  });
  await asignarPlan(dueno, mundo.tenant, opciones.version ?? m.version, { origen: "ALTA" });
  if (opciones.empresasPorTenant !== undefined) {
    await ajustarPerilla(dueno, mundo.tenant, "empresas_por_tenant", opciones.empresasPorTenant);
  }
  if (opciones.estado === "SUSPENDED") {
    await dueno.query(
      "update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
      [mundo.tenant],
    );
  }
  return mundo;
}

/** Una entrada de alta válida con un tenant nuevo de esa marca (CUIT, email y clave distintos cada vez). */
export function altaNueva(
  marca: string,
  extra: Partial<EntradaDeAltaDeEmpresa> = {},
): EntradaDeAltaDeEmpresa {
  return {
    claveDeIdempotencia: claveAlAzar(),
    nombreDeTenant: `tenant-${randomBytes(4).toString("hex")}`,
    marcaId: marca,
    cuit: cuitAlAzar(),
    razonSocial: `Empresa ${randomBytes(3).toString("hex")} S.A.`,
    zonaHoraria: "America/Argentina/Buenos_Aires",
    moneda: "ARS",
    emailGerente: `gerente-${randomBytes(5).toString("hex")}@prueba.test`,
    ...extra,
  };
}

/** Una entrada de alta válida para una empresa más de un tenant que ya existe. */
export function altaEnTenant(
  tenant: string,
  extra: Partial<EntradaDeAltaDeEmpresa> = {},
): EntradaDeAltaDeEmpresa {
  const nueva = altaNueva("-");
  return {
    claveDeIdempotencia: nueva.claveDeIdempotencia,
    tenantId: tenant,
    cuit: nueva.cuit,
    razonSocial: nueva.razonSocial,
    zonaHoraria: nueva.zonaHoraria,
    moneda: nueva.moneda,
    emailGerente: nueva.emailGerente,
    ...extra,
  };
}

/** El contexto del ADMIN sembrado, a la hora de la base: el alta asigna un plan que vale desde `ahora`. */
export const comoAdminAhora = (): ContextoDePlataforma => plataformaEn(new Date());

/** El SOPORTE sembrado: ve, pero no da de alta. */
export const comoSoporteAhora = (): ContextoDePlataforma =>
  plataformaEn(new Date(), { tipo: "ADMIN", id: SOPORTE_DE_PRUEBA });

// ---- lo que las pruebas miran de la base ---------------------------------------------------------------

/** Cuántas filas tiene cada tabla que el alta escribe, para comparar antes y después. */
export type HuellaDelAlta = Readonly<Record<string, number>>;

const TABLAS_DEL_ALTA = {
  tenants: "select count(*) from tenant",
  empresas: "select count(*) from empresa",
  sucursales: "select count(*) from sucursal",
  asignaciones: "select count(*) from plan_de_tenant",
  modulos: "select count(*) from modulo_de_empresa",
  invitaciones: "select count(*) from invitacion",
  invitacionesDeEmpresa: "select count(*) from invitacion_empresa",
  trabajos: "select count(*) from trabajo",
  auditoriaDeEmpresa: "select count(*) from auditoria_empresa",
  auditoriaDePlataforma: "select count(*) from auditoria_plataforma",
  claves: "select count(*) from idempotencia_plataforma",
} as const;

export async function huellaDelAlta(dueno: pg.Client): Promise<HuellaDelAlta> {
  const huella: Record<string, number> = {};
  for (const [nombre, consulta] of Object.entries(TABLAS_DEL_ALTA)) {
    huella[nombre] = Number(((await dueno.query(consulta)).rows[0] as { count: string }).count);
  }
  return huella;
}

/** Lo que dejó UN alta, comparado con la huella de antes (sin contar los módulos, que dependen de la marca). */
export const DELTA_DE_UN_ALTA_CON_TENANT_NUEVO: HuellaDelAlta = {
  tenants: 1,
  empresas: 1,
  sucursales: 1,
  asignaciones: 1,
  modulos: 0,
  invitaciones: 1,
  invitacionesDeEmpresa: 1,
  trabajos: 1,
  // EMPRESA_ALTA + PLAN_ASIGNADO (sin módulos activos).
  auditoriaDeEmpresa: 2,
  // TENANT_ALTA + EMPRESA_ALTA.
  auditoriaDePlataforma: 2,
  claves: 1,
};

export function diferencia(antes: HuellaDelAlta, despues: HuellaDelAlta): HuellaDelAlta {
  return Object.fromEntries(
    Object.keys(despues).map((k) => [k, (despues[k] ?? 0) - (antes[k] ?? 0)]),
  );
}

export const SIN_CAMBIOS: HuellaDelAlta = Object.fromEntries(
  Object.keys(TABLAS_DEL_ALTA).map((k) => [k, 0]),
);
