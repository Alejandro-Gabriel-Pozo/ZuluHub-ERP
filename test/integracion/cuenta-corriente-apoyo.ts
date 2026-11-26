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
import {
  crearTransacciones,
  type SinTablas,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  crearCasosDeUsoDeCuentaCorriente,
  crearConsultasDeCuentaCorriente,
  crearRepositoriosDeCuentaCorriente,
  type TxDeConsultasDeCuentaCorriente,
  type TxDeCuentaCorriente,
} from "../../src/modulos/cuenta_corriente/publico";
import { crearRepositoriosDeClientes } from "../../src/modulos/clientes/publico";
import { crearRepositorioDeEmpresas, type EmpresasDb } from "../../src/modulos/empresas/publico";
import { crearRepositorioDeTenants, type TenantsDb } from "../../src/modulos/tenants/publico";
import {
  personaId,
  type EmpresaId,
  type PersonaId,
  type TenantId,
} from "../../src/primitivas/identificadores/marca";
import { comoEmpresa, crearEmpresaActiva, type TxDePrueba } from "./entorno";
import type { BaseDePruebas } from "./global";
import { crearMembresiaDeBase, crearPersonaDeBase, type RolDePrueba } from "./fixtures-identidad";
import { asignarPlan, crearPlanPublicado } from "./marcas-apoyo";
import { ahoraDeLaCorrida } from "./reloj-de-la-corrida";
import { cuitUnico, sufijoUnico } from "./unicos";

/**
 * Apoyo de las pruebas de integración de la cuenta corriente de clientes (CC-1): una empresa con el módulo `cuenta_corriente` activado y dentro de su plan (el
 * catálogo real lo tiene «en desarrollo»: las pruebas usan las reglas reales con el módulo disponible, `REGLAS_DE_CUENTA_CORRIENTE`), su gerente u otro rol, clientes
 * con CUIT y las transacciones con lo que armaría la composición (los repositorios del módulo, la auditoría y la autorización) sobre los roles REALES de la
 * aplicación. El escenario lo arma el DUEÑO de la base; lo que se prueba va con el contexto firmado de la persona.
 */

/** Las reglas reales con `cuenta_corriente` ya construida y disponible: así los casos de uso y las consultas pasan el guard. */
const REGLAS_DE_CUENTA_CORRIENTE: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    cuenta_corriente: { ...CATALOGO_DE_MODULOS.cuenta_corriente, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};

export type TxDeCuentaCorrienteDePrueba = TxDeCuentaCorriente &
  TxDeConsultasDeCuentaCorriente &
  Readonly<{ db: Kysely<SinTablas> }>;

/** Las transacciones de la puerta de la aplicación con lo que piden los casos de uso y las consultas. `ajustar` envuelve lo que recibe el trabajo (para inyectar una barrera). */
export function crearEntornoDeCuentaCorriente(
  base: BaseDePruebas,
  maximoDeConexiones = 4,
  ajustar: (tx: TxDeCuentaCorrienteDePrueba) => TxDeCuentaCorrienteDePrueba = (tx) => tx,
): TransaccionesDePostgres<TxDeCuentaCorrienteDePrueba> {
  const armarTx = (
    db: Kysely<SinTablas>,
    autorizacion: TxDeCuentaCorrienteDePrueba["autorizacion"],
  ): TxDeCuentaCorrienteDePrueba =>
    ajustar({
      db,
      tenants: crearRepositorioDeTenants(db.withTables<TenantsDb>()),
      empresas: crearRepositorioDeEmpresas(db.withTables<EmpresasDb>()),
      ...crearRepositoriosDeCuentaCorriente(db),
      ...crearRepositoriosDeClientes(db),
      auditoria: crearAuditoriaDePostgres(db.withTables<AuditoriaDb>()),
      autorizacion,
    });
  return crearTransacciones<TxDeCuentaCorrienteDePrueba>({
    urls: { OPERATIVO: base.app },
    armar: (db) => armarTx(db, crearAutorizacionDePostgres(db.withTables<AutorizacionDb>())),
    armarDeLectura: (db) =>
      armarTx(db, crearAutorizacionDeLecturaDePostgres(db.withTables<AutorizacionDb>())),
    maximoDeConexiones,
    clave: base.clave,
  });
}

/** Los casos de uso y las consultas sobre unas transacciones dadas, con las reglas dadas (por defecto, `REGLAS_DE_CUENTA_CORRIENTE`). */
export function armarCuentaCorriente(
  entorno: TransaccionesDePostgres<TxDeCuentaCorrienteDePrueba>,
  reglas: ReglasDeEmpresa = REGLAS_DE_CUENTA_CORRIENTE,
) {
  return {
    casos: crearCasosDeUsoDeCuentaCorriente({ transacciones: entorno, reglas }),
    consultas: crearConsultasDeCuentaCorriente({ transacciones: entorno, reglas }),
  };
}

export type MundoDeCuentaCorriente = Readonly<{
  tenant: TenantId;
  empresa: EmpresaId;
  persona: PersonaId;
  /** El contexto operativo de la persona, con el reloj real (las asignaciones de plan nacen vigentes según el reloj de la base). */
  ctx: () => ContextoOperativo;
}>;

export type OpcionesDeMundoDeCuentaCorriente = Readonly<{
  rol?: RolDePrueba;
  /** Módulos del plan (el techo). Por defecto, `cuenta_corriente`. */
  plan?: readonly string[];
  /** Módulos que la empresa activó. Por defecto, los del plan. */
  activados?: readonly string[];
}>;

export async function crearMundoDeCuentaCorriente(
  entornoBase: TransaccionesDePostgres<TxDePrueba>,
  dueno: pg.Client,
  opciones: OpcionesDeMundoDeCuentaCorriente = {},
): Promise<MundoDeCuentaCorriente> {
  const e = await crearEmpresaActiva(entornoBase, {});
  const persona = await crearPersonaDeBase(dueno);
  await crearMembresiaDeBase(dueno, e.empresa, persona.id, opciones.rol ?? "GERENTE");
  const plan = opciones.plan ?? ["cuenta_corriente"];
  const { version } = await crearPlanPublicado(dueno, { modulos: [...plan], perillas: {} });
  await asignarPlan(dueno, e.tenant, version, { desdeSegundos: -30 });
  for (const modulo of opciones.activados ?? plan) {
    await dueno.query("insert into modulo_de_empresa (empresa_id, modulo) values ($1, $2)", [
      e.empresa,
      modulo,
    ]);
  }
  const id = personaId(persona.id);
  return {
    tenant: e.tenant,
    empresa: e.empresa,
    persona: id,
    ctx: () => ({ ...comoEmpresa(e.empresa, id), ahora: ahoraDeLaCorrida() }),
  };
}

/** Otra persona con un rol en la empresa del mundo: su contexto operativo. */
export async function sumarPersonaDeCuentaCorriente(
  dueno: pg.Client,
  mundo: MundoDeCuentaCorriente,
  rol: RolDePrueba,
): Promise<() => ContextoOperativo> {
  const persona = await crearPersonaDeBase(dueno);
  await crearMembresiaDeBase(dueno, mundo.empresa, persona.id, rol);
  const id = personaId(persona.id);
  return () => ({ ...comoEmpresa(mundo.empresa, id), ahora: ahoraDeLaCorrida() });
}

export type OpcionesDeCliente = Partial<{
  estado: "ACTIVA" | "INACTIVA";
  rol: string | null;
  documento: "CUIT" | "DNI" | null;
  naturaleza: "HUMANA" | "JURIDICA";
}>;

/** Un cliente de la empresa (parte con rol, documento y estado a elección; por defecto: cliente activo con CUIT y razón social). Lo inserta el dueño de la base. */
export async function crearClienteDePrueba(
  dueno: pg.Client,
  mundo: MundoDeCuentaCorriente,
  o: OpcionesDeCliente = {},
): Promise<string> {
  const documento = o.documento === undefined ? "CUIT" : o.documento;
  const { rows } = await dueno.query<{ id: string }>(
    `insert into parte (empresa_id, idempotencia_alta, naturaleza, nombre, documento_tipo, documento_numero, creado_por)
     values ($1, gen_random_uuid(), $2, $3, $4, $5, $6) returning id`,
    [
      mundo.empresa,
      o.naturaleza ?? "JURIDICA",
      `Cliente ${sufijoUnico()}`,
      documento,
      documento === "CUIT" ? cuitUnico() : documento === "DNI" ? "20123456" : null,
      mundo.persona,
    ],
  );
  const id = rows[0]?.id as string;
  const rol = o.rol === undefined ? "CUSTOMER" : o.rol;
  if (rol !== null) {
    await dueno.query("insert into parte_rol (empresa_id, parte_id, rol) values ($1, $2, $3)", [
      mundo.empresa,
      id,
      rol,
    ]);
  }
  if (o.estado === "INACTIVA") {
    await dueno.query("update parte set estado = 'INACTIVA' where id = $1", [id]);
  }
  return id;
}
