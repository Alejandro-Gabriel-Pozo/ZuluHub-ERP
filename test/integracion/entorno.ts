import { randomBytes, randomInt } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { instalarClaveDeContexto } from "../../src/adaptadores/postgres/contexto-firmado";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import {
  crearTransacciones,
  type SinTablas,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import type { Contexto, ContextoOperativo } from "../../src/contexto/contexto";
import {
  digitoVerificadorDeCuit,
  cuitDesdeTexto,
  type Cuit,
} from "../../src/primitivas/identificacion-fiscal/cuit";
import {
  personaId,
  type EmpresaId,
  type PersonaId,
  type TenantId,
} from "../../src/primitivas/identificadores/marca";
import {
  crearRepositorioDeEmpresas,
  crearRepositorioDeSucursales,
  type EmpresasDb,
  type RepositorioDeEmpresas,
  type RepositorioDeSucursales,
} from "../../src/modulos/empresas/publico";
import {
  crearRepositorioDeAsignaciones,
  crearRepositorioDeInvitaciones,
  crearRepositorioDeMembresias,
  crearRepositorioDePersonas,
  type IdentidadDb,
  type TxDeIdentidad,
} from "../../src/modulos/identidad/publico";
import {
  crearRepositorioDeTenants,
  type RepositorioDeTenants,
  type TenantsDb,
} from "../../src/modulos/tenants/publico";
import {
  crearAuditoriaDePostgres,
  type AuditoriaDb,
} from "../../src/adaptadores/postgres/auditoria";
import { crearTrabajosDePostgres, type TrabajosDb } from "../../src/adaptadores/postgres/trabajos";
import type { BaseDePruebas } from "./global";

/**
 * Armado común de las pruebas de integración. Lo que recibe un trabajo de prueba es lo que
 * armaría la composición real: los repositorios de los módulos más el `db` crudo para consultas
 * de verificación.
 */

export type TxDePrueba = Readonly<{
  /** Consultas de verificación sin tipar. */
  db: Kysely<SinTablas>;
  tenants: RepositorioDeTenants;
  empresas: RepositorioDeEmpresas;
  sucursales: RepositorioDeSucursales;
}> &
  TxDeIdentidad;

/**
 * `ajustar` envuelve lo que recibe el trabajo (para inyectar una falla o una barrera en las pruebas
 * de concurrencia); sin él, es exactamente lo que armaría la composición.
 */
export function crearEntornoDePrueba(
  base: BaseDePruebas,
  maximoDeConexiones = 5,
  ajustar: (tx: TxDePrueba) => TxDePrueba = (tx) => tx,
): TransaccionesDePostgres<TxDePrueba> {
  return crearTransacciones<TxDePrueba>({
    urls: {
      OPERATIVO: base.app,
      GRUPO: base.grupo,
      PLATAFORMA: base.plataforma,
      TRABAJOS: base.trabajos,
    },
    armar: (db) =>
      ajustar({
        db,
        tenants: crearRepositorioDeTenants(db.withTables<TenantsDb>()),
        empresas: crearRepositorioDeEmpresas(db.withTables<EmpresasDb>()),
        sucursales: crearRepositorioDeSucursales(db.withTables<EmpresasDb>()),
        personas: crearRepositorioDePersonas(db.withTables<IdentidadDb>()),
        membresias: crearRepositorioDeMembresias(db.withTables<IdentidadDb>()),
        asignaciones: crearRepositorioDeAsignaciones(db.withTables<IdentidadDb>()),
        invitaciones: crearRepositorioDeInvitaciones(db.withTables<IdentidadDb>()),
        trabajos: crearTrabajosDePostgres(db.withTables<TrabajosDb>()),
        auditoria: crearAuditoriaDePostgres(db.withTables<AuditoriaDb>()),
      }),
    maximoDeConexiones,
    clave: base.clave,
  });
}

const AHORA = new Date("2026-10-11T12:00:00Z");

export const comoPlataforma = (): Contexto => ({
  tipo: "PLATAFORMA",
  administrador: "admin-de-prueba",
  ahora: AHORA,
});

export const comoEmpresa = (
  empresa: EmpresaId,
  persona: PersonaId | null = null,
): ContextoOperativo => ({
  tipo: "OPERATIVO",
  empresaId: empresa,
  personaId: persona,
  ahora: AHORA,
});

export const comoGrupo = (tenant: TenantId, persona: PersonaId): Contexto => ({
  tipo: "GRUPO",
  tenantId: tenant,
  personaId: persona,
  ahora: AHORA,
});

export const comoTrabajos = (): Contexto => ({ tipo: "TRABAJOS", ahora: AHORA });

/** Quien llega con un enlace de invitación: sin empresa ni persona, solo el hash del token. */
export const comoInvitacion = (tokenHash: string): Contexto => ({
  tipo: "INVITACION",
  tokenHash,
  ahora: AHORA,
});

/** El `ahora` de las pruebas (el mismo de todos los contextos de este archivo). */
export const AHORA_DE_PRUEBA = AHORA;

/** CUIT válido al azar (único con altísima probabilidad dentro de una corrida). */
export function cuitAlAzar(): Cuit {
  for (;;) {
    let diez = String(randomInt(20, 34));
    while (diez.length < 10) diez += String(randomInt(0, 10));
    const verificador = digitoVerificadorDeCuit(diez);
    if (verificador === null) continue;
    const resultado = cuitDesdeTexto(`${diez}${verificador}`);
    if (resultado.ok) return resultado.valor;
  }
}

export const nombreAlAzar = (prefijo: string): string =>
  `${prefijo}-${randomBytes(4).toString("hex")}`;

export type EmpresaDePrueba = Readonly<{ tenant: TenantId; empresa: EmpresaId; cuit: Cuit }>;

/** Crea un tenant y una empresa ACTIVA con una sucursal, como lo haría el alta de plataforma. */
export async function crearEmpresaActiva(
  entorno: TransaccionesDePostgres<TxDePrueba>,
  opciones: { tenant?: TenantId; nombreDeSucursal?: string } = {},
): Promise<EmpresaDePrueba> {
  const resultado = await entorno.ejecutar(
    // El armado de datos no prueba aislamiento transaccional: no necesita SERIALIZABLE.
    { contexto: comoPlataforma(), aislamiento: "read committed" },
    async ({ tenants, empresas, db }) => {
      const tenant = opciones.tenant ?? (await tenants.crear(nombreAlAzar("tenant"))).id;
      const cuit = cuitAlAzar();
      const creada = await empresas.crear({
        tenantId: tenant,
        cuit,
        razonSocial: nombreAlAzar("empresa"),
      });
      await sql`insert into sucursal (empresa_id, nombre)
                values (${creada.id}, ${opciones.nombreDeSucursal ?? "Casa central"})`.execute(db);
      const activa = await empresas.cambiarEstado(creada.id, creada.version, {
        estado: "ACTIVE",
        motivoEstado: null,
      });
      if (!activa.ok) throw new Error("no se pudo activar la empresa de prueba");
      return { ok: true as const, valor: { tenant, empresa: creada.id, cuit } };
    },
  );
  if (!resultado.ok)
    throw new Error(`no se pudo crear la empresa de prueba: ${JSON.stringify(resultado.error)}`);
  return resultado.valor;
}

/** Crea una empresa que sigue en alta (PROVISIONING): existe, pero todavía no opera. */
export async function crearEmpresaEnAlta(
  entorno: TransaccionesDePostgres<TxDePrueba>,
  opciones: { tenant?: TenantId } = {},
): Promise<EmpresaDePrueba> {
  const resultado = await entorno.ejecutar(
    { contexto: comoPlataforma(), aislamiento: "read committed" },
    async ({ tenants, empresas }) => {
      const tenant = opciones.tenant ?? (await tenants.crear(nombreAlAzar("tenant"))).id;
      const cuit = cuitAlAzar();
      const creada = await empresas.crear({
        tenantId: tenant,
        cuit,
        razonSocial: nombreAlAzar("empresa"),
      });
      return { ok: true as const, valor: { tenant, empresa: creada.id, cuit } };
    },
  );
  if (!resultado.ok)
    throw new Error(`no se pudo crear la empresa en alta: ${JSON.stringify(resultado.error)}`);
  return resultado.valor;
}

/** Crea una persona y la hace propietaria del tenant. */
export async function crearPropietario(
  entorno: TransaccionesDePostgres<TxDePrueba>,
  tenant: TenantId,
  opciones: { activo?: boolean } = {},
): Promise<PersonaId> {
  const resultado = await entorno.ejecutar(
    { contexto: comoPlataforma(), aislamiento: "read committed" },
    async ({ db }) => {
      const { rows } = await sql<{ id: string }>`
      insert into persona (email) values (${`${randomBytes(6).toString("hex")}@prueba.test`})
      returning id`.execute(db);
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("no se creó la persona");
      await sql`insert into membresia_tenant (persona_id, tenant_id, rol, activo)
              values (${id}, ${tenant}, 'PROPIETARIO', ${opciones.activo ?? true})`.execute(db);
      return { ok: true as const, valor: personaId(id) };
    },
  );
  if (!resultado.ok) throw new Error("no se pudo crear el propietario de prueba");
  return resultado.valor;
}

/**
 * Una base descartable propia, para pruebas que cambian la instalación o el esquema. Si se migra,
 * se le instala la clave de contexto de la corrida (así `crearEntornoDePrueba` funciona), salvo con
 * `sinClave: true` (falla cerrada: la base no tiene ninguna clave).
 */
export async function crearBaseAparte(
  base: BaseDePruebas,
  opciones: { migrar?: boolean; sinClave?: boolean } = {},
): Promise<{ base: BaseDePruebas; destruir: () => Promise<void> }> {
  const nombre = `zuluhub_it_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: base.admin });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${nombre}`);
  const conBase = (url: string) => {
    const u = new URL(url);
    u.pathname = `/${nombre}`;
    return u.toString();
  };
  const propia: BaseDePruebas = {
    admin: base.admin,
    dueno: conBase(base.dueno),
    app: conBase(base.app),
    grupo: conBase(base.grupo),
    trabajos: conBase(base.trabajos),
    plataforma: conBase(base.plataforma),
    clave: base.clave,
  };
  if (opciones.migrar !== false) {
    await aplicarMigraciones(propia.dueno, join(import.meta.dirname, "../../migraciones"));
    if (opciones.sinClave !== true) await instalarClaveDeContexto(propia.dueno, base.clave);
  }
  return {
    base: propia,
    destruir: async () => {
      await admin.query(`DROP DATABASE ${nombre} WITH (FORCE)`);
      await admin.end();
    },
  };
}

/** Punto de encuentro: todos esperan hasta que llegaron `participantes`. */
export function crearBarrera(participantes: number): () => Promise<void> {
  let llegaron = 0;
  let liberar: () => void = () => undefined;
  const abierta = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  return async () => {
    llegaron += 1;
    if (llegaron >= participantes) liberar();
    await abierta;
  };
}
