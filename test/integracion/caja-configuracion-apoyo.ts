import type pg from "pg";
import type { Kysely } from "kysely";
import {
  crearAuditoriaDePostgres,
  type AuditoriaDb,
} from "../../src/adaptadores/postgres/auditoria";
import {
  crearAutorizacionDeLecturaDePostgres,
  crearAutorizacionDePostgres,
  type AutorizacionDb,
} from "../../src/adaptadores/postgres/autorizacion";
import { crearLecturaDeDerechosDeUso } from "../../src/adaptadores/postgres/derechos-de-uso";
import {
  crearTransacciones,
  type SinTablas,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import { CATALOGO_DE_PERILLAS } from "../../src/capacidades/planes/perillas";
import {
  crearRepositorioDeJornadas,
  type CierreDb,
  type TxDeCierre,
} from "../../src/modulos/cierre/publico";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  crearRepositorioDeArqueos,
  crearRepositorioDeCajas,
  crearRepositorioDeCobros,
  crearRepositorioDeCobrosDeLaJornada,
  crearRepositorioDeCorrecciones,
  crearRepositorioDeCuentasDeCobro,
  crearRepositorioDeDeclaraciones,
  crearRepositorioDeFotos,
  crearRepositorioDeLaJornada,
  crearRepositorioDeMediosDePago,
  crearRepositorioDeMovimientos,
  crearRepositorioDeSesiones,
  crearConsultasDeCaja,
  crearCasosDeUsoDeCaja,
  type CajaDb,
  type TicketsPorCobranza,
  type TxDeAporteDeCaja,
  type TxDeCaja,
  type TxDeConsultasDeCaja,
} from "../../src/modulos/caja/publico";
import {
  crearCasosDeUsoDeEmpresas,
  crearLecturaDeSucursalBloqueada,
  crearRepositorioDeEmpresas,
  crearRepositorioDeSucursales,
  type EmpresasDb,
  type GanchosAlDesactivarSucursal,
  type GanchosDeSucursal,
  type TxDeEmpresas,
} from "../../src/modulos/empresas/publico";
import { crearLecturaDePlanes, type PlanesDb } from "../../src/modulos/planes/publico";
import { crearRepositorioDeTenants, type TenantsDb } from "../../src/modulos/tenants/publico";
import {
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
  type TenantId,
} from "../../src/primitivas/identificadores/marca";
import type { BaseDePruebas } from "./global";
import { comoEmpresa, crearEmpresaActiva, type TxDePrueba } from "./entorno";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  sucursalDe,
  type RolDePrueba,
} from "./fixtures-identidad";
import { asignarPlan, crearPlanPublicado } from "./marcas-apoyo";

/**
 * Apoyo de las pruebas de integración de la configuración de caja (E3, tramo 3): una empresa con el módulo `caja` activado y dentro de su
 * plan (el catálogo real lo tiene «en desarrollo»: las pruebas usan las reglas reales con `caja` disponible, `REGLAS_DE_CAJA`), su gerente
 * u otro rol, y las transacciones con lo que armaría la composición (repositorios de caja, derechos de uso y sucursal bloqueada) sobre los
 * roles REALES de la aplicación. El escenario lo arma el DUEÑO de la base; lo que se prueba va con el contexto firmado de la persona.
 */

/** Las reglas reales con `caja` ya construida: así los casos de uso y las consultas pasan el guard. */
export const REGLAS_DE_CAJA: ReglasDeEmpresa = {
  catalogo: { ...CATALOGO_DE_MODULOS, caja: { ...CATALOGO_DE_MODULOS.caja, estado: "disponible" } },
  permisos: PERMISOS_DE_EMPRESA,
};

export type TxDeCajaDePrueba = TxDeCaja &
  TxDeConsultasDeCaja &
  TxDeAporteDeCaja &
  TxDeEmpresas &
  TxDeCierre &
  Readonly<{ db: Kysely<SinTablas> }>;

/**
 * Las transacciones de la puerta de la aplicación con lo que piden los casos de uso y las consultas de caja. `ajustar` envuelve lo que
 * recibe el trabajo (para inyectar una falla o una barrera); sin él, es exactamente lo que armaría la composición.
 */
export function crearEntornoDeCaja(
  base: BaseDePruebas,
  maximoDeConexiones = 12,
  ajustar: (tx: TxDeCajaDePrueba) => TxDeCajaDePrueba = (tx) => tx,
): TransaccionesDePostgres<TxDeCajaDePrueba> {
  const armarTx = (
    db: Kysely<SinTablas>,
    autorizacion: TxDeCajaDePrueba["autorizacion"],
  ): TxDeCajaDePrueba =>
    ajustar({
      db,
      tenants: crearRepositorioDeTenants(db.withTables<TenantsDb>()),
      empresas: crearRepositorioDeEmpresas(db.withTables<EmpresasDb>()),
      sucursales: crearRepositorioDeSucursales(db.withTables<EmpresasDb>()),
      cajas: crearRepositorioDeCajas(db.withTables<CajaDb>()),
      mediosDePago: crearRepositorioDeMediosDePago(db.withTables<CajaDb>()),
      cuentasDeCobro: crearRepositorioDeCuentasDeCobro(db.withTables<CajaDb>()),
      sesiones: crearRepositorioDeSesiones(db.withTables<CajaDb>()),
      movimientos: crearRepositorioDeMovimientos(db.withTables<CajaDb>()),
      cobros: crearRepositorioDeCobros(db.withTables<CajaDb>()),
      arqueos: crearRepositorioDeArqueos(db.withTables<CajaDb>()),
      correcciones: crearRepositorioDeCorrecciones(db.withTables<CajaDb>()),
      declaraciones: crearRepositorioDeDeclaraciones(db.withTables<CajaDb>()),
      laJornada: crearRepositorioDeLaJornada(db.withTables<CajaDb>()),
      cobrosDeLaJornada: crearRepositorioDeCobrosDeLaJornada(db.withTables<CajaDb>()),
      fotos: crearRepositorioDeFotos(db.withTables<CajaDb>()),
      jornadas: crearRepositorioDeJornadas(db.withTables<CierreDb>()),
      sucursalBloqueada: crearLecturaDeSucursalBloqueada(db.withTables<EmpresasDb>()),
      derechos: crearLecturaDeDerechosDeUso(crearLecturaDePlanes(db.withTables<PlanesDb>()), {
        catalogoDeModulos: CATALOGO_DE_MODULOS,
        catalogoDePerillas: CATALOGO_DE_PERILLAS,
      }),
      auditoria: crearAuditoriaDePostgres(db.withTables<AuditoriaDb>()),
      autorizacion,
    });
  return crearTransacciones<TxDeCajaDePrueba>({
    urls: { OPERATIVO: base.app },
    armar: (db) => armarTx(db, crearAutorizacionDePostgres(db.withTables<AutorizacionDb>())),
    armarDeLectura: (db) =>
      armarTx(db, crearAutorizacionDeLecturaDePostgres(db.withTables<AutorizacionDb>())),
    maximoDeConexiones,
    clave: base.clave,
  });
}

/** Un `TicketsPorCobranza` que no conoce ningún ticket: como la composición hoy, sin ventas (e3b §4.6). */
export const SIN_TICKETS: TicketsPorCobranza = { ticketsPorCobranza: () => Promise.resolve([]) };

/** Los casos de uso y las consultas sobre unas transacciones dadas, con las reglas dadas (por defecto, `REGLAS_DE_CAJA`) y el puerto de tickets dado. */
export function armarCaja(
  entorno: TransaccionesDePostgres<TxDeCajaDePrueba>,
  reglas: ReglasDeEmpresa = REGLAS_DE_CAJA,
  tickets: TicketsPorCobranza = SIN_TICKETS,
) {
  return {
    casos: crearCasosDeUsoDeCaja({ transacciones: entorno, reglas }),
    consultas: crearConsultasDeCaja({ transacciones: entorno, reglas, tickets }),
  };
}

/**
 * Los casos de uso de empresas sobre las mismas transacciones, con los ganchos de sucursal dados (la composición registra el de caja) y,
 * si se piden, los de desactivación (decisión 178; por defecto, ninguno).
 */
export function armarEmpresasConGanchos(
  entorno: TransaccionesDePostgres<TxDeCajaDePrueba>,
  ganchosDeSucursal: GanchosDeSucursal<TxDeEmpresas>,
  reglas: ReglasDeEmpresa = REGLAS_DE_CAJA,
  ganchosAlDesactivarSucursal: GanchosAlDesactivarSucursal<TxDeEmpresas> = [],
) {
  return crearCasosDeUsoDeEmpresas({
    transacciones: entorno,
    reglas,
    ganchosDeSucursal,
    ganchosAlDesactivarSucursal,
  });
}

export type MundoDeCaja = Readonly<{
  tenant: TenantId;
  empresa: EmpresaId;
  sucursal: SucursalId;
  persona: PersonaId;
  /** El contexto operativo de la persona, con el reloj real (las asignaciones de plan nacen vigentes según el reloj de la base). */
  ctx: () => ContextoOperativo;
}>;

export type OpcionesDeMundoDeCaja = Readonly<{
  rol?: RolDePrueba;
  /** El límite de cajas por sucursal que fija el plan; sin él rige la base (1). */
  limiteDeCajas?: number | "ILIMITADO";
  /** Módulos del plan (el techo). Por defecto, `caja`. */
  plan?: readonly string[];
  /** Módulos que la empresa activó. Por defecto, los del plan. */
  activados?: readonly string[];
  /** Solo para el operador: lo asigna a la sucursal de la empresa (por defecto, sin alcance). */
  asignarALaSucursal?: boolean;
  /** Un tenant ya creado (para tener dos empresas del mismo grupo). */
  tenant?: TenantId;
}>;

export async function crearMundoDeCaja(
  entornoBase: TransaccionesDePostgres<TxDePrueba>,
  dueno: pg.Client,
  opciones: OpcionesDeMundoDeCaja = {},
): Promise<MundoDeCaja> {
  const e = await crearEmpresaActiva(
    entornoBase,
    opciones.tenant === undefined ? {} : { tenant: opciones.tenant },
  );
  const persona = await crearPersonaDeBase(dueno);
  await crearMembresiaDeBase(dueno, e.empresa, persona.id, opciones.rol ?? "GERENTE");
  const plan = opciones.plan ?? ["caja"];
  const perillas =
    opciones.limiteDeCajas === undefined
      ? {}
      : { cajas_por_sucursal: { tipo: "LIMITE", limite: opciones.limiteDeCajas } };
  const { version } = await crearPlanPublicado(dueno, { modulos: [...plan], perillas });
  await asignarPlan(dueno, e.tenant, version, { desdeSegundos: -30 });
  for (const modulo of opciones.activados ?? plan) {
    await dueno.query("insert into modulo_de_empresa (empresa_id, modulo) values ($1, $2)", [
      e.empresa,
      modulo,
    ]);
  }
  const sucursal = await sucursalDe(dueno, e.empresa);
  if (opciones.asignarALaSucursal === true) {
    await crearAsignacionDeBase(dueno, e.empresa, persona.id, sucursal);
  }
  const id = personaId(persona.id);
  return {
    tenant: e.tenant,
    empresa: e.empresa,
    sucursal: sucursalId(sucursal),
    persona: id,
    ctx: () => ({ ...comoEmpresa(e.empresa, id), ahora: new Date() }),
  };
}

/** Otra persona con un rol en la empresa del mundo (y, si se pide, asignada a su sucursal): su contexto operativo. */
export async function sumarPersona(
  dueno: pg.Client,
  mundo: MundoDeCaja,
  rol: RolDePrueba,
  asignarALaSucursal = false,
): Promise<() => ContextoOperativo> {
  const persona = await crearPersonaDeBase(dueno);
  await crearMembresiaDeBase(dueno, mundo.empresa, persona.id, rol);
  if (asignarALaSucursal) {
    await crearAsignacionDeBase(dueno, mundo.empresa, persona.id, mundo.sucursal);
  }
  const id = personaId(persona.id);
  return () => ({ ...comoEmpresa(mundo.empresa, id), ahora: new Date() });
}

/** Otra sucursal de la empresa (la inserta el dueño de la base). */
export async function otraSucursalDeCaja(
  dueno: pg.Client,
  empresa: EmpresaId,
  nombre: string,
): Promise<SucursalId> {
  const { rows } = await dueno.query<{ id: string }>(
    "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
    [empresa, nombre],
  );
  return sucursalId(rows[0]?.id as string);
}
