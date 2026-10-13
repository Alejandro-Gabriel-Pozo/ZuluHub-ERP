import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { instalarClaveDeContexto } from "../../src/adaptadores/postgres/contexto-firmado";
import type { Contexto } from "../../src/contexto/contexto";
import { ERRORES_DE_EMPRESAS_POR_RESTRICCION } from "../../src/modulos/empresas/publico";
import { ERRORES_DE_IDENTIDAD_POR_RESTRICCION } from "../../src/modulos/identidad/publico";
import { ERRORES_DE_TENANT_POR_RESTRICCION } from "../../src/modulos/tenants/publico";
import { adminPlataformaId, personaId } from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import { SOPORTE_DE_PRUEBA, sembrarAdminsDePrueba } from "./admins-de-prueba";
import {
  comoEmpresa,
  comoGrupo,
  comoPlataforma,
  comoTrabajos,
  crearBaseAparte,
  crearEmpresaActiva,
  crearEntornoDePrueba,
  crearPropietario,
  cuitAlAzar,
  type EmpresaDePrueba,
} from "./entorno";
import {
  aceptarDeBase,
  crearAsignacionDeBase,
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  incluirEmpresa,
  type RolDePrueba,
} from "./fixtures-identidad";
import { SesionDePrueba, type Intento } from "./sesiones";

/**
 * H6, tramo T1: la migración 0005 (traspaso de gerencia, asignaciones desde la empresa y reglas de
 * base de las sucursales) contra una base real. Seis bloques:
 *  1. Catálogo: lo que la base DECLARA (columnas, políticas exactas, funciones, disparadores).
 *  2. Restricciones y máquina de estados del traspaso: lo que la base impide aun al dueño.
 *  3. Membresía: el rol cambia solo por traspaso (matriz del disparador y de la política).
 *  4. El traspaso con los roles reales: quién puede qué (aplicación, grupo, trabajos, plataforma).
 *  5. Asignaciones desde la empresa.
 *  6. Sucursales: nombre sin locale, largo, caracteres y «nunca sin una activa».
 *  7. Compatibilidad: 0005 sobre una base con datos de 0001 a 0004.
 * La concurrencia está en `administracion-concurrencia.test.ts`. Las conexiones son directas por `pg`
 * con el rol real y su contexto firmado: no pasan por los repositorios.
 */

const base = inject("baseDePruebas");
// Varias pruebas arman una base aparte (migraciones incluidas): con la máquina cargada pasan de 5 s.
vi.setConfig({ testTimeout: 60_000 });

const PROPUESTO_EN = new Date("2026-10-11T12:00:00Z");
const VENCE_EN = new Date("2026-10-18T12:00:00Z");
const DESPUES_DEL_VENCIMIENTO = new Date("2026-10-19T12:00:00Z");

const ROLES = [
  "zuluhub_app",
  "zuluhub_grupo",
  "zuluhub_trabajos",
  "zuluhub_plataforma",
  "zuluhub_autenticacion",
] as const;
const SEARCH_PATH_FIJO = "search_path=pg_catalog, public, pg_temp";

const FUNCIONES_NUEVAS = [
  "membresia_validar_cambio",
  "sucursal_serializar_bajas",
  "sucursal_validar_baja",
  "traspaso_gerencia_validar_alta",
  "traspaso_gerencia_validar_cambio",
  "traspaso_gerencia_verificar_aceptado",
] as const;

/** Las transiciones que el traspaso permite (T4 las compara con las de su dominio). */
const TRANSICIONES_DE_TRASPASO: Readonly<Record<string, readonly string[]>> = {
  PROPUESTO: ["ACEPTADO", "RECHAZADO", "CANCELADO"],
  ACEPTADO: [],
  RECHAZADO: [],
  CANCELADO: [],
};
const ESTADOS = ["PROPUESTO", "ACEPTADO", "RECHAZADO", "CANCELADO"] as const;

// ---- aserciones sobre un intento ---------------------------------------------------------------

function rechazado(r: Intento, codigo: string, restriccion?: string): void {
  expect(r.ok, "tenía que rechazarse").toBe(false);
  if (r.ok) return;
  expect(r.codigo, r.mensaje).toBe(codigo);
  if (restriccion !== undefined) expect(r.restriccion, r.mensaje).toBe(restriccion);
}
const denegado = (r: Intento) => rechazado(r, "42501");
/** La base lo rechaza, sin importar cuál de las barreras (los disparadores corren antes que la política). */
function noEntra(r: Intento): void {
  expect(r.ok, "tenía que rechazarse").toBe(false);
  if (!r.ok) expect(["42501", "23514"], r.mensaje).toContain(r.codigo);
}
const check = (r: Intento, restriccion: string) => rechazado(r, "23514", restriccion);
const clave = (r: Intento, restriccion: string) => rechazado(r, "23505", restriccion);
const referencia = (r: Intento, restriccion: string) => rechazado(r, "23503", restriccion);
function filas(r: Intento, n: number): void {
  expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
  if (r.ok) expect(r.filas).toBe(n);
}

describe.skipIf(base === null)("administración: la migración 0005 contra una base real", () => {
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;

  beforeAll(async () => {
    if (base === null) return;
    dueno = new pg.Client({ connectionString: base.dueno });
    await dueno.connect();
    entorno = crearEntornoDePrueba(base);
  });
  afterAll(async () => {
    await entorno.cerrar();
    await dueno.end();
  });

  const consultar = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;

  // ---- escenarios -------------------------------------------------------------------------------

  type Escena = Readonly<{
    empresa: EmpresaDePrueba;
    sucursal: string;
    gerente: string;
    admin: string;
    operador: string;
    otro: string;
  }>;

  /** Una empresa activa con un gerente, un administrador y dos operadores, armada por el dueño. */
  const armar = async (opciones: { tenant?: EmpresaDePrueba["tenant"] } = {}): Promise<Escena> => {
    const empresa = await crearEmpresaActiva(
      entorno,
      opciones.tenant === undefined ? {} : { tenant: opciones.tenant },
    );
    const sucursal = (
      await consultar<{ id: string }>("select id from sucursal where empresa_id = $1", [
        empresa.empresa,
      ])
    )[0]?.id as string;
    const nueva = async (rol: RolDePrueba, activo = true) => {
      const p = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, empresa.empresa, p.id, rol, activo);
      return p.id;
    };
    return {
      empresa,
      sucursal,
      gerente: await nueva("GERENTE"),
      admin: await nueva("ADMINISTRADOR"),
      operador: await nueva("OPERADOR"),
      otro: await nueva("OPERADOR"),
    };
  };

  const comoPersona = (e: Escena, persona: string | null): Contexto =>
    comoEmpresa(e.empresa.empresa, persona === null ? null : personaId(persona));

  /** Abre una sesión de la aplicación en esa empresa, con esa persona; todo se deshace al terminar. */
  const conApp = async <T>(
    e: Escena,
    persona: string | null,
    trabajo: (s: SesionDePrueba) => Promise<T>,
    aislamiento: "read committed" | "repeatable read" | "serializable" = "read committed",
  ): Promise<T> => {
    if (base === null) throw new Error("sin base");
    const s = await SesionDePrueba.abrir(base, "zuluhub_app", comoPersona(e, persona), aislamiento);
    try {
      return await trabajo(s);
    } finally {
      await s.cerrar();
    }
  };

  const conRol = async <T>(
    rol: "zuluhub_app" | "zuluhub_grupo" | "zuluhub_trabajos" | "zuluhub_plataforma",
    contexto: Contexto | null,
    trabajo: (s: SesionDePrueba) => Promise<T>,
  ): Promise<T> => {
    if (base === null) throw new Error("sin base");
    const s = await SesionDePrueba.abrir(base, rol, contexto);
    try {
      return await trabajo(s);
    } finally {
      await s.cerrar();
    }
  };

  /** Un traspaso en curso (lo inserta el dueño). Devuelve su id. */
  const traspasoDeBase = async (
    e: Escena,
    entrante: string,
    opciones: { origen?: "GERENTE" | "PLATAFORMA"; vence?: Date } = {},
  ): Promise<string> => {
    const origen = opciones.origen ?? "GERENTE";
    const { rows } = await dueno.query<{ id: string }>(
      `insert into traspaso_gerencia (empresa_id, origen, propuesto_por, saliente_persona_id,
                                      entrante_persona_id, propuesto_en, vence_en)
       values ($1, $2, $3, $3, $4, $5, $6) returning id`,
      [
        e.empresa.empresa,
        origen,
        origen === "GERENTE" ? e.gerente : null,
        entrante,
        PROPUESTO_EN,
        opciones.vence ?? VENCE_EN,
      ],
    );
    return rows[0]?.id as string;
  };

  /** Acepta y cambia los roles, como lo haría el entrante, pero con el dueño (queda confirmado). */
  const traspasarDeBase = async (e: Escena, id: string, saliente: string, entrante: string) => {
    await dueno.query("begin");
    try {
      await dueno.query(
        "update traspaso_gerencia set estado = 'ACEPTADO', resuelto_en = $2 where id = $1",
        [id, PROPUESTO_EN],
      );
      await dueno.query(
        "update membresia set rol = 'ADMINISTRADOR' where empresa_id = $1 and persona_id = $2",
        [e.empresa.empresa, saliente],
      );
      await dueno.query(
        "update membresia set rol = 'GERENTE' where empresa_id = $1 and persona_id = $2",
        [e.empresa.empresa, entrante],
      );
      await dueno.query("commit");
    } catch (error) {
      await dueno.query("rollback");
      throw error;
    }
  };

  const estadoDelTraspaso = async (id: string) =>
    (
      await consultar<{ estado: string }>("select estado from traspaso_gerencia where id = $1", [
        id,
      ])
    )[0]?.estado;
  const rolDe = async (e: Escena, persona: string) =>
    (
      await consultar<{ rol: string; activo: boolean }>(
        "select rol, activo from membresia where empresa_id = $1 and persona_id = $2",
        [e.empresa.empresa, persona],
      )
    )[0];
  const gerentesActivos = async (e: Escena) =>
    (
      await consultar<{ persona_id: string }>(
        "select persona_id from membresia where empresa_id = $1 and rol = 'GERENTE' and activo",
        [e.empresa.empresa],
      )
    ).map((f) => f.persona_id);

  /** Todo lo que haga el trabajo se deshace: el dueño prueba una cosa a la vez sobre el mismo traspaso. */
  const sinConfirmar = async <T>(trabajo: () => Promise<T>): Promise<T> => {
    await dueno.query("begin");
    try {
      return await trabajo();
    } finally {
      await dueno.query("rollback");
    }
  };
  const intento = async (texto: string, parametros: unknown[] = []): Promise<Intento> => {
    await dueno.query("savepoint intento");
    try {
      const r = await dueno.query(texto, parametros);
      await dueno.query("release savepoint intento");
      return { ok: true, filas: r.rowCount ?? 0, rows: r.rows as Record<string, unknown>[] };
    } catch (error) {
      await dueno.query("rollback to savepoint intento");
      const e = error as { code?: string; constraint?: string; message?: string };
      return {
        ok: false,
        codigo: e.code ?? "?",
        restriccion: e.constraint,
        mensaje: e.message ?? "",
      };
    }
  };

  // Las tres sentencias de una aceptación, como las manda el código (sin savepoints).
  const aceptar = (s: SesionDePrueba, id: string, ahora: Date = PROPUESTO_EN, saliente?: string) =>
    s.directo(
      saliente === undefined
        ? "update traspaso_gerencia set estado = 'ACEPTADO', resuelto_en = $2 where id = $1"
        : "update traspaso_gerencia set estado = 'ACEPTADO', resuelto_en = $2, saliente_persona_id = $3 where id = $1",
      saliente === undefined ? [id, ahora] : [id, ahora, saliente],
    );
  const cambiarRol = (s: SesionDePrueba, e: Escena, persona: string, rol: string) =>
    s.directo("update membresia set rol = $3 where empresa_id = $1 and persona_id = $2", [
      e.empresa.empresa,
      persona,
      rol,
    ]);

  // ===============================================================================================
  // 1. Catálogo
  // ===============================================================================================
  describe("catálogo", () => {
    it("traspaso_gerencia existe con exactamente estas columnas, en este orden", async () => {
      const columnas = await consultar<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'traspaso_gerencia' order by ordinal_position`,
      );
      expect(columnas.map((c) => c.column_name)).toEqual([
        "id",
        "empresa_id",
        "origen",
        "propuesto_por",
        "saliente_persona_id",
        "entrante_persona_id",
        "estado",
        "propuesto_en",
        "vence_en",
        "resuelto_en",
        "motivo",
        "creado_en",
        "actualizado_en",
        "version",
      ]);
    });

    it("RLS activo y forzado, clave foránea a empresa, ningún privilegio para PUBLIC y dueña ajena a los roles limitados", async () => {
      const [tabla] = await consultar<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        dueno: string;
      }>(
        `select c.relrowsecurity, c.relforcerowsecurity, r.rolname as dueno
         from pg_class c join pg_roles r on r.oid = c.relowner
         where c.oid = 'public.traspaso_gerencia'::regclass`,
      );
      expect(tabla?.relrowsecurity).toBe(true);
      expect(tabla?.relforcerowsecurity).toBe(true);
      expect(ROLES).not.toContain(tabla?.dueno);
      const fk = await consultar<{ conname: string; destino: string }>(
        `select conname, confrelid::regclass::text as destino from pg_constraint
         where conrelid = 'public.traspaso_gerencia'::regclass and contype = 'f' order by 1`,
      );
      expect(fk).toEqual([
        { conname: "traspaso_gerencia_empresa_id_fkey", destino: "empresa" },
        { conname: "traspaso_gerencia_entrante_fkey", destino: "membresia" },
        { conname: "traspaso_gerencia_propuesto_por_fkey", destino: "persona" },
        { conname: "traspaso_gerencia_saliente_fkey", destino: "membresia" },
      ]);
      expect(
        await consultar(
          `select 1 from information_schema.table_privileges
           where table_schema = 'public' and table_name = 'traspaso_gerencia' and grantee = 'PUBLIC'`,
        ),
      ).toEqual([]);
    });

    it("las restricciones y los índices únicos de traspaso_gerencia son exactamente estos", async () => {
      const restricciones = await consultar<{ conname: string; contype: string }>(
        // Postgres 18 registra cada NOT NULL como restricción propia (contype 'n'); Postgres 16 no.
        // Se excluyen para que la lista sea la misma en ambas versiones.
        `select conname, contype from pg_constraint
         where conrelid = 'public.traspaso_gerencia'::regclass and contype <> 'n' order by 1`,
      );
      expect(restricciones.map((r) => `${r.conname}:${r.contype}`)).toEqual([
        "traspaso_gerencia_aceptado_ck:c",
        "traspaso_gerencia_aceptado_completo:t", // la restricción diferida (un disparador)
        "traspaso_gerencia_distintos_ck:c",
        "traspaso_gerencia_empresa_id_fkey:f",
        "traspaso_gerencia_entrante_fkey:f",
        "traspaso_gerencia_estado_ck:c",
        "traspaso_gerencia_motivo_ck:c",
        "traspaso_gerencia_origen_ck:c",
        "traspaso_gerencia_pkey:p",
        "traspaso_gerencia_propuesto_por_fkey:f",
        "traspaso_gerencia_resolucion_ck:c",
        "traspaso_gerencia_saliente_fkey:f",
        "traspaso_gerencia_vence_ck:c",
      ]);
      const indices = await consultar<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes
         where schemaname = 'public' and tablename = 'traspaso_gerencia' order by 1`,
      );
      expect(indices.map((i) => i.indexname)).toEqual([
        "traspaso_gerencia_empresa_ix",
        "traspaso_gerencia_en_curso_uk",
        "traspaso_gerencia_pkey",
      ]);
      // Un solo traspaso en curso por empresa: única parcial que incluye empresa_id.
      expect(indices[1]?.indexdef).toMatch(
        /CREATE UNIQUE INDEX traspaso_gerencia_en_curso_uk .*\(empresa_id\) WHERE \(estado = 'PROPUESTO'/,
      );
    });

    it("las políticas de traspaso_gerencia son exactamente estas (una abierta de más sumaría acceso)", async () => {
      const politicas = await consultar<{ p: string }>(
        `select format('%s:%s:%s:%s', policyname, cmd, permissive, array_to_string(roles, '+')) as p
         from pg_policies where schemaname = 'public' and tablename = 'traspaso_gerencia' order by 1`,
      );
      expect(politicas.map((f) => f.p)).toEqual(
        [
          "traspaso_gerencia_app_alta:INSERT:PERMISSIVE:zuluhub_app",
          "traspaso_gerencia_app_cancelar:UPDATE:PERMISSIVE:zuluhub_app",
          "traspaso_gerencia_app_leer:SELECT:PERMISSIVE:zuluhub_app",
          "traspaso_gerencia_app_responder:UPDATE:PERMISSIVE:zuluhub_app",
          "traspaso_gerencia_plataforma_admin_alta:INSERT:RESTRICTIVE:zuluhub_plataforma",
          "traspaso_gerencia_plataforma_admin_cambiar:UPDATE:RESTRICTIVE:zuluhub_plataforma",
          "traspaso_gerencia_plataforma_alta:INSERT:PERMISSIVE:zuluhub_plataforma",
          "traspaso_gerencia_plataforma_cancelar:UPDATE:PERMISSIVE:zuluhub_plataforma",
          "traspaso_gerencia_plataforma_con_actor:SELECT:RESTRICTIVE:zuluhub_plataforma",
          "traspaso_gerencia_plataforma_leer:SELECT:PERMISSIVE:zuluhub_plataforma",
        ].sort(),
      );
    });

    it("las políticas de la aplicación de 0005 nombran su propio contexto, exigen empresa_operable y evalúan el contexto una sola vez: (SELECT app_*())", async () => {
      const politicas = await consultar<{
        policyname: string;
        cmd: string;
        qual: string | null;
        with_check: string | null;
      }>(
        `select policyname, cmd, qual, with_check from pg_policies
         where schemaname = 'public' and 'zuluhub_app' = any (roles)
           and (tablename = 'traspaso_gerencia' or policyname in
                ('membresia_app_traspasar', 'asignacion_sucursal_app_alta', 'asignacion_sucursal_app_reactivar'))
         order by 1`,
      );
      expect(politicas).toHaveLength(7);
      for (const p of politicas) {
        const texto = `${p.qual ?? ""} ${p.with_check ?? ""}`;
        if (p.cmd !== "SELECT") {
          // El WITH CHECK de las permisivas se suma (OR): cada uno tiene que nombrar su contexto.
          expect(p.with_check, `${p.policyname}: WITH CHECK`).toContain("app_empresa_id()");
          expect(p.with_check, `${p.policyname}: WITH CHECK`).toContain("empresa_operable(");
        }
        const total = (
          texto.match(/app_(empresa_id|persona_id|tenant_id|token_invitacion)\(\)/g) ?? []
        ).length;
        const conSelect = (
          texto.match(/SELECT app_(empresa_id|persona_id|tenant_id|token_invitacion)\(\)/g) ?? []
        ).length;
        expect(conSelect, p.policyname).toBe(total);
        expect(total, p.policyname).toBeGreaterThan(0);
      }
      // Proponer y responder nombran a la persona del contexto (propone el gerente, responde el entrante).
      const porNombre = new Map(politicas.map((p) => [p.policyname, p]));
      expect(porNombre.get("traspaso_gerencia_app_alta")?.with_check).toMatch(
        /propuesto_por = \( SELECT app_persona_id\(\)/,
      );
      expect(porNombre.get("traspaso_gerencia_app_responder")?.with_check).toMatch(
        /entrante_persona_id = \( SELECT app_persona_id\(\)/,
      );
      expect(porNombre.get("traspaso_gerencia_app_responder")?.qual).toMatch(
        /entrante_persona_id = \( SELECT app_persona_id\(\)/,
      );
      // El cambio de rol de una membresía exige el traspaso aceptado en la transacción, en USING y en CHECK.
      for (const parte of ["qual", "with_check"] as const) {
        const texto = porNombre.get("membresia_app_traspasar")?.[parte] ?? "";
        expect(texto, parte).toContain("traspaso_gerencia");
        expect(texto, parte).toContain("'ACEPTADO'");
        expect(texto, parte).toMatch(/xmin = \(?pg_current_xact_id\(\)\)?::xid/);
      }
    });

    it("las políticas de traspaso_gerencia no miran membresia (sin ciclos con membresia_app_traspasar)", async () => {
      const miran = await consultar<{ policyname: string }>(
        `select policyname from pg_policies
         where schemaname = 'public' and tablename = 'traspaso_gerencia'
           and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'membresia|asignacion|sucursal'`,
      );
      expect(miran).toEqual([]);
    });

    it("las políticas no forman ciclos: leer, actualizar e insertar en las tablas relacionadas se planifica con cada rol", async () => {
      const e = await armar();
      const sentencias = [
        "select count(*) from membresia",
        "select count(*) from asignacion_sucursal",
        "select count(*) from traspaso_gerencia",
        "select count(*) from sucursal",
        "update membresia set activo = activo where false",
        "update asignacion_sucursal set activa = activa where false",
        "update traspaso_gerencia set motivo = motivo where false",
        "update sucursal set activa = activa where false",
        `insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id)
           select empresa_id, persona_id, sucursal_id from asignacion_sucursal where false`,
        `insert into traspaso_gerencia (empresa_id, origen, entrante_persona_id, propuesto_en, vence_en)
           select empresa_id, 'PLATAFORMA', entrante_persona_id, propuesto_en, vence_en
           from traspaso_gerencia where false`,
      ];
      const contextos: ["zuluhub_app" | "zuluhub_plataforma", Contexto][] = [
        ["zuluhub_app", comoPersona(e, e.gerente)],
        ["zuluhub_app", comoPersona(e, null)],
        ["zuluhub_plataforma", comoPlataforma()],
      ];
      for (const [rol, contexto] of contextos) {
        await conRol(rol, contexto, async (s) => {
          for (const texto of sentencias) {
            const r = await s.intentar(texto);
            // Puede faltar un permiso (42501), pero jamás una recursión de políticas (42P17).
            if (!r.ok) expect(r.mensaje, `${rol}: ${texto}`).not.toMatch(/infinite recursion/);
            if (!r.ok) expect(r.codigo, `${rol}: ${texto}`).not.toBe("42P17");
          }
        });
      }
    });

    it("las funciones nuevas: search_path fijo, sin SECURITY DEFINER, volátiles, y nadie las ejecuta a mano", async () => {
      const funciones = await consultar<{
        proname: string;
        prosecdef: boolean;
        provolatile: string;
        proconfig: string[] | null;
        retorno: string;
      }>(
        `select p.proname, p.prosecdef, p.provolatile, p.proconfig, p.prorettype::regtype::text as retorno
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1) order by 1`,
        [[...FUNCIONES_NUEVAS]],
      );
      expect(funciones.map((f) => f.proname)).toEqual([...FUNCIONES_NUEVAS].sort());
      for (const f of funciones) {
        expect(f.prosecdef, f.proname).toBe(false);
        expect(f.proconfig, f.proname).toContain(SEARCH_PATH_FIJO);
        expect(f.retorno, f.proname).toBe("trigger");
        // Volátiles: tienen que ver lo que la misma sentencia ya escribió (varias filas de un UPDATE).
        expect(f.provolatile, f.proname).toBe("v");
        for (const rol of ROLES) {
          const { rows } = await dueno.query<{ puede: boolean }>(
            `select has_function_privilege($1, $2::regprocedure, 'EXECUTE') as puede`,
            [rol, `public.${f.proname}()`],
          );
          expect(rows[0]?.puede, `${rol} ejecuta ${f.proname}`).toBe(false);
        }
      }
      // La única SECURITY DEFINER sigue siendo contexto_firmado.
      expect(
        (
          await consultar<{ proname: string }>(
            "select proname from pg_proc where pronamespace = 'public'::regnamespace and prosecdef",
          )
        ).map((f) => f.proname),
      ).toEqual(["contexto_firmado"]);
    });

    it("los disparadores de 0005 son exactamente estos, activos, con su momento y sus eventos", async () => {
      const disparadores = await consultar<{ d: string }>(
        `select format('%s.%s:%s:%s', c.relname, t.tgname,
                       case when pg_get_triggerdef(t.oid) ~ 'BEFORE' then 'antes' else 'despues' end,
                       t.tgenabled) as d
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where not t.tgisinternal and t.tgfoid = any (
           select p.oid from pg_proc p where p.proname = any($1))
         order by 1`,
        [[...FUNCIONES_NUEVAS]],
      );
      expect(disparadores.map((f) => f.d)).toEqual([
        "membresia.membresia_cambio:antes:O",
        "sucursal.sucursal_baja:antes:O",
        "sucursal.sucursal_baja_serializar:antes:O",
        "traspaso_gerencia.traspaso_gerencia_aceptado_completo:despues:O",
        "traspaso_gerencia.traspaso_gerencia_alta:antes:O",
        "traspaso_gerencia.traspaso_gerencia_cambio:antes:O",
      ]);
      const definiciones = await consultar<{ nombre: string; def: string }>(
        `select t.tgname as nombre, pg_get_triggerdef(t.oid) as def from pg_trigger t
         where t.tgname in ('membresia_cambio', 'sucursal_baja', 'sucursal_baja_serializar',
                            'traspaso_gerencia_aceptado_completo',
                            'traspaso_gerencia_alta', 'traspaso_gerencia_cambio',
                            'traspaso_gerencia_version', 'membresia_version')
         order by 1`,
      );
      const def = (n: string) => definiciones.find((d) => d.nombre === n)?.def ?? "";
      expect(def("membresia_cambio")).toContain("BEFORE UPDATE ON public.membresia FOR EACH ROW");
      expect(def("sucursal_baja")).toContain(
        "BEFORE UPDATE OF activa ON public.sucursal FOR EACH ROW",
      );
      expect(def("sucursal_baja_serializar")).toContain(
        "BEFORE UPDATE OF activa ON public.sucursal FOR EACH STATEMENT",
      );
      expect(def("sucursal_baja")).toMatch(/WHEN \(\(old\.activa AND \(NOT new\.activa\)\)\)/i);
      expect(def("traspaso_gerencia_alta")).toContain("BEFORE INSERT ON public.traspaso_gerencia");
      expect(def("traspaso_gerencia_cambio")).toContain(
        "BEFORE UPDATE ON public.traspaso_gerencia",
      );
      // La restricción diferida: AL CONFIRMAR, solo al pasar a ACEPTADO.
      const [diferido] = await consultar<{
        tgdeferrable: boolean;
        tginitdeferred: boolean;
        tgconstraint: string;
      }>(
        `select tgdeferrable, tginitdeferred, tgconstraint::int as tgconstraint from pg_trigger
         where tgname = 'traspaso_gerencia_aceptado_completo'`,
      );
      expect(diferido).toMatchObject({ tgdeferrable: true, tginitdeferred: true });
      expect(diferido?.tgconstraint).toBeGreaterThan(0);
      expect(def("traspaso_gerencia_aceptado_completo")).toContain("AFTER UPDATE ON");
      expect(def("traspaso_gerencia_aceptado_completo")).toMatch(/WHEN .*ACEPTADO/);
      // Los disparadores de validación se llaman antes que los de versión (orden alfabético).
      expect("membresia_cambio" < "membresia_version").toBe(true);
      expect("traspaso_gerencia_cambio" < "traspaso_gerencia_version").toBe(true);
      expect(def("traspaso_gerencia_version")).toContain("fijar_version_y_fecha");
    });

    it("toda restricción que lanza un disparador de la base tiene su traducción declarada (ninguna se escapa)", async () => {
      const cuerpos = await consultar<{ proname: string; cuerpo: string }>(
        `select p.proname, pg_get_functiondef(p.oid) as cuerpo from pg_proc p
         where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
           and p.proname = any($1)`,
        [[...FUNCIONES_NUEVAS]],
      );
      const lanzadas = new Set<string>();
      for (const { cuerpo } of cuerpos) {
        for (const m of cuerpo.matchAll(/CONSTRAINT = '([a-z0-9_]+)'/g))
          lanzadas.add(m[1] as string);
      }
      expect(lanzadas.size).toBe(11);
      const declaradas = new Set([
        ...Object.keys(ERRORES_DE_IDENTIDAD_POR_RESTRICCION),
        ...Object.keys(ERRORES_DE_EMPRESAS_POR_RESTRICCION),
        ...Object.keys(ERRORES_DE_TENANT_POR_RESTRICCION),
      ]);
      expect([...lanzadas].filter((n) => !declaradas.has(n)).sort()).toEqual([]);
    });

    it("la unicidad del nombre de sucursal usa un orden ICU no determinista y no depende del locale", async () => {
      const [colacion] = await consultar<{
        collprovider: string;
        collisdeterministic: boolean;
        colllocale: string | null;
        colliculocale: string | null;
      }>(
        `select collprovider, collisdeterministic,
                to_jsonb(c)->>'colllocale' as colllocale, to_jsonb(c)->>'colliculocale' as colliculocale
         from pg_collation c where collname = 'sucursal_nombre_ci' and collnamespace = 'public'::regnamespace`,
      );
      expect(colacion).toMatchObject({ collprovider: "i", collisdeterministic: false });
      expect(colacion?.colllocale ?? colacion?.colliculocale).toBe("und-u-ks-level2");
      const [indice] = await consultar<{ indexdef: string }>(
        `select indexdef from pg_indexes where indexname = 'sucursal_nombre_ci_uk'`,
      );
      expect(indice?.indexdef).toMatch(
        /CREATE UNIQUE INDEX sucursal_nombre_ci_uk ON public\.sucursal .*\(empresa_id, nombre COLLATE sucursal_nombre_ci\)/,
      );
      // El de 0001 se conserva (no se borra nada): lo nuevo es más estricto o igual.
      expect(
        await consultar(`select 1 from pg_indexes where indexname = 'sucursal_nombre_uk'`),
      ).toHaveLength(1);
      // La base de las pruebas es UTF8 con locale C (el peor caso para lower()): se confirma acá.
      const [baseDeDatos] = await consultar<{ enc: string; ctype: string }>(
        `select pg_encoding_to_char(encoding) as enc, datctype as ctype from pg_database
         where datname = current_database()`,
      );
      expect(baseDeDatos).toEqual({ enc: "UTF8", ctype: "C" });
    });
  });

  // ===============================================================================================
  // 2. Restricciones y máquina de estados del traspaso: lo que la base impide, aun al dueño
  // ===============================================================================================
  describe("restricciones del traspaso", () => {
    const insertar = (
      e: Escena,
      o: {
        origen: string;
        propuestoPor: string | null;
        saliente: string | null;
        entrante: string;
        propuestoEn?: Date;
        venceEn?: Date;
        estado?: string;
        resueltoEn?: Date | null;
        motivo?: string | null;
      },
    ) =>
      dueno.query(
        `insert into traspaso_gerencia (empresa_id, origen, propuesto_por, saliente_persona_id,
                                        entrante_persona_id, propuesto_en, vence_en, estado, resuelto_en, motivo)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          e.empresa.empresa,
          o.origen,
          o.propuestoPor,
          o.saliente,
          o.entrante,
          o.propuestoEn ?? PROPUESTO_EN,
          o.venceEn ?? VENCE_EN,
          o.estado ?? "PROPUESTO",
          o.resueltoEn ?? null,
          o.motivo ?? null,
        ],
      );
    const falla = (consulta: Promise<unknown>, code: string, constraint: string) =>
      expect(consulta).rejects.toMatchObject({ code, constraint });
    const delGerente = (e: Escena, entrante: string) => ({
      origen: "GERENTE",
      propuestoPor: e.gerente,
      saliente: e.gerente,
      entrante,
    });
    const deLaPlataforma = (entrante: string, saliente: string | null = null) => ({
      origen: "PLATAFORMA",
      propuestoPor: null,
      saliente,
      entrante,
    });

    it("el origen, quien propone y el saliente se corresponden: GERENTE con quien propone y ese es el saliente; PLATAFORMA sin quien propone (el CHECK no deja pasar el NULL)", async () => {
      const e = await armar();
      // Sin quien propone, el disparador de alta (que corre antes que los CHECK) ya lo rechaza.
      await falla(
        insertar(e, { ...delGerente(e, e.operador), propuestoPor: null }),
        "23514",
        "traspaso_saliente_no_es_gerente",
      );
      // Saliente NULL: con `=` el CHECK daría NULL y dejaría pasar la fila.
      await falla(
        insertar(e, { ...delGerente(e, e.operador), saliente: null }),
        "23514",
        "traspaso_gerencia_origen_ck",
      );
      await falla(
        insertar(e, { ...delGerente(e, e.operador), saliente: e.admin }),
        "23514",
        "traspaso_gerencia_origen_ck",
      );
      await falla(
        insertar(e, { ...deLaPlataforma(e.operador), propuestoPor: e.gerente }),
        "23514",
        "traspaso_gerencia_origen_ck",
      );
      await falla(
        insertar(e, { ...deLaPlataforma(e.operador), origen: "OTRO" }),
        "23514",
        "traspaso_gerencia_origen_ck",
      );
      await insertar(e, deLaPlataforma(e.operador));
      expect(
        await consultar("select 1 from traspaso_gerencia where empresa_id = $1", [
          e.empresa.empresa,
        ]),
      ).toHaveLength(1);
    });

    it("el estado, el saliente distinto del entrante, el vencimiento y la fecha de resolución tienen sus controles", async () => {
      const e = await armar();
      await falla(
        insertar(e, { ...deLaPlataforma(e.operador), estado: "ANULADO", resueltoEn: PROPUESTO_EN }),
        "23514",
        "traspaso_gerencia_estado_ck",
      );
      await falla(
        insertar(e, deLaPlataforma(e.admin, e.admin)),
        "23514",
        "traspaso_gerencia_distintos_ck",
      );
      await falla(
        insertar(e, { ...deLaPlataforma(e.operador), venceEn: PROPUESTO_EN }),
        "23514",
        "traspaso_gerencia_vence_ck",
      );
      // Resuelto <=> con fecha de resolución, y no antes de la propuesta.
      await falla(
        insertar(e, { ...deLaPlataforma(e.operador), resueltoEn: PROPUESTO_EN }),
        "23514",
        "traspaso_gerencia_resolucion_ck",
      );
      await falla(
        insertar(e, { ...deLaPlataforma(e.operador), estado: "RECHAZADO" }),
        "23514",
        "traspaso_gerencia_resolucion_ck",
      );
      await falla(
        insertar(e, {
          ...deLaPlataforma(e.operador),
          estado: "RECHAZADO",
          resueltoEn: new Date(PROPUESTO_EN.getTime() - 1000),
        }),
        "23514",
        "traspaso_gerencia_resolucion_ck",
      );
      // Una aceptación no puede fecharse en el vencimiento ni después, y deja anotado al saliente.
      await falla(
        insertar(e, {
          ...delGerente(e, e.operador),
          estado: "ACEPTADO",
          resueltoEn: VENCE_EN,
        }),
        "23514",
        "traspaso_gerencia_aceptado_ck",
      );
      await falla(
        insertar(e, {
          ...deLaPlataforma(e.operador),
          estado: "ACEPTADO",
          resueltoEn: PROPUESTO_EN,
        }),
        "23514",
        "traspaso_gerencia_aceptado_ck",
      );
    });

    it("el motivo es una clave en mayúsculas (hasta 80 caracteres) y solo existe en un traspaso resuelto", async () => {
      const e = await armar();
      const resuelto = (motivo: string | null) => ({
        ...deLaPlataforma(e.operador),
        estado: "CANCELADO",
        resueltoEn: PROPUESTO_EN,
        motivo,
      });
      for (const malo of [
        "vencido",
        "VENCIDO por tiempo",
        "1VENCIDO",
        " VENCIDO",
        "",
        "A".repeat(81),
        "Ñ",
      ]) {
        await sinConfirmar(() =>
          falla(insertar(e, resuelto(malo)), "23514", "traspaso_gerencia_motivo_ck"),
        );
      }
      await falla(
        insertar(e, { ...deLaPlataforma(e.operador), motivo: "VENCIDO" }),
        "23514",
        "traspaso_gerencia_motivo_ck",
      );
      await sinConfirmar(async () => {
        await insertar(e, resuelto("A".repeat(80)));
        await insertar(e, resuelto("ENTRANTE_DADO_DE_BAJA"));
        await insertar(e, resuelto(null));
      });
    });

    it("solo se traspasa a un miembro de ESTA empresa: uno de otra empresa (aun del mismo tenant) no, por la clave compuesta", async () => {
      const e = await armar();
      const otra = await armar({ tenant: e.empresa.tenant });
      await falla(
        insertar(e, delGerente(e, otra.operador)),
        "23503",
        "traspaso_gerencia_entrante_fkey",
      );
      await falla(
        insertar(e, deLaPlataforma(otra.operador)),
        "23503",
        "traspaso_gerencia_entrante_fkey",
      );
      // Y quien no es miembro de ninguna empresa tampoco.
      const suelta = await crearPersonaDeBase(dueno);
      await falla(
        insertar(e, deLaPlataforma(suelta.id)),
        "23503",
        "traspaso_gerencia_entrante_fkey",
      );
    });

    it("un solo traspaso en curso por empresa; resuelto el anterior se puede proponer otro; otra empresa tiene el suyo", async () => {
      const e = await armar();
      const otra = await armar();
      const primero = await traspasoDeBase(e, e.operador);
      await falla(insertar(e, delGerente(e, e.otro)), "23505", "traspaso_gerencia_en_curso_uk");
      await falla(insertar(e, deLaPlataforma(e.admin)), "23505", "traspaso_gerencia_en_curso_uk");
      await traspasoDeBase(otra, otra.operador);
      await dueno.query(
        "update traspaso_gerencia set estado = 'CANCELADO', resuelto_en = $2, motivo = 'VENCIDO' where id = $1",
        [primero, PROPUESTO_EN],
      );
      const segundo = await traspasoDeBase(e, e.otro);
      await dueno.query(
        "update traspaso_gerencia set estado = 'RECHAZADO', resuelto_en = $2 where id = $1",
        [segundo, PROPUESTO_EN],
      );
      await traspasoDeBase(e, e.admin);
      expect(
        await consultar("select 1 from traspaso_gerencia where empresa_id = $1", [
          e.empresa.empresa,
        ]),
      ).toHaveLength(3);
    });

    it("al proponer: el entrante es un miembro activo que no es el gerente (y con la persona activa), y propone el gerente VIGENTE", async () => {
      const e = await armar();
      const inactivo = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa.empresa, inactivo.id, "OPERADOR", false);
      const dada = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa.empresa, dada.id, "ADMINISTRADOR");
      await dueno.query("update persona set activo_global = false where id = $1", [dada.id]);

      await falla(insertar(e, delGerente(e, inactivo.id)), "23514", "traspaso_entrante_inactivo");
      await falla(insertar(e, deLaPlataforma(inactivo.id)), "23514", "traspaso_entrante_inactivo");
      await falla(insertar(e, delGerente(e, dada.id)), "23514", "traspaso_entrante_inactivo");
      await falla(
        insertar(e, deLaPlataforma(e.gerente)),
        "23514",
        "traspaso_entrante_es_el_gerente",
      );
      // Al gerente no se le propone a sí mismo (lo dice el entrante, antes que el CHECK).
      await falla(
        insertar(e, delGerente(e, e.gerente)),
        "23514",
        "traspaso_entrante_es_el_gerente",
      );
      // Propone el gerente vigente: ni un administrador, ni un operador, ni un ex gerente.
      for (const quien of [e.admin, e.operador]) {
        await falla(
          insertar(e, {
            origen: "GERENTE",
            propuestoPor: quien,
            saliente: quien,
            entrante: e.otro,
          }),
          "23514",
          "traspaso_saliente_no_es_gerente",
        );
      }
      const primero = await traspasoDeBase(e, e.operador);
      await traspasarDeBase(e, primero, e.gerente, e.operador);
      await falla(
        insertar(e, { ...delGerente(e, e.otro) }),
        "23514",
        "traspaso_saliente_no_es_gerente",
      );
      // El gerente nuevo sí.
      await insertar(e, {
        origen: "GERENTE",
        propuestoPor: e.operador,
        saliente: e.operador,
        entrante: e.otro,
      });
    });

    it("la máquina de estados permite exactamente las transiciones del dominio, y un traspaso resuelto queda congelado", async () => {
      // Un traspaso en cada estado, cada uno en su empresa.
      const fixtures = new Map<string, { e: Escena; id: string }>();
      for (const estado of ESTADOS) {
        const e = await armar();
        const id = await traspasoDeBase(e, e.operador);
        if (estado === "ACEPTADO") await traspasarDeBase(e, id, e.gerente, e.operador);
        else if (estado !== "PROPUESTO") {
          await dueno.query(
            "update traspaso_gerencia set estado = $2, resuelto_en = $3 where id = $1",
            [id, estado, PROPUESTO_EN],
          );
        }
        fixtures.set(estado, { e, id });
      }
      for (const desde of ESTADOS) {
        for (const hacia of ESTADOS) {
          if (desde === hacia) continue;
          const { id } = fixtures.get(desde) as { e: Escena; id: string };
          const permitida = (TRANSICIONES_DE_TRASPASO[desde] ?? []).includes(hacia);
          await sinConfirmar(async () => {
            const r = await intento(
              "update traspaso_gerencia set estado = $2, resuelto_en = $3 where id = $1",
              [id, hacia, hacia === "PROPUESTO" ? null : PROPUESTO_EN],
            );
            if (permitida) filas(r, 1);
            else check(r, "traspaso_gerencia_transicion_invalida");
          });
          expect(await estadoDelTraspaso(id), `${desde} → ${hacia} no deja huella`).toBe(desde);
        }
      }
      // Congelado: ni la fecha, ni el motivo, ni el saliente cambian en uno resuelto.
      for (const estado of ["RECHAZADO", "CANCELADO", "ACEPTADO"] as const) {
        const { e, id } = fixtures.get(estado) as { e: Escena; id: string };
        await sinConfirmar(async () => {
          check(
            await intento("update traspaso_gerencia set resuelto_en = $2 where id = $1", [
              id,
              new Date(PROPUESTO_EN.getTime() + 1000),
            ]),
            "traspaso_gerencia_resuelto_inmutable",
          );
          check(
            await intento("update traspaso_gerencia set motivo = 'OTRO' where id = $1", [id]),
            "traspaso_gerencia_resuelto_inmutable",
          );
          check(
            await intento("update traspaso_gerencia set saliente_persona_id = $2 where id = $1", [
              id,
              e.admin,
            ]),
            "traspaso_gerencia_resuelto_inmutable",
          );
        });
      }
    });

    it("los datos de emisión no se cambian nunca, uno por uno; el saliente solo se completa al aceptar, una vez", async () => {
      const e = await armar();
      const otra = await armar();
      const id = await traspasoDeBase(e, e.operador);
      const cambios: [string, unknown][] = [
        ["id", "11111111-1111-4111-8111-111111111111"],
        ["empresa_id", otra.empresa.empresa],
        ["origen", "PLATAFORMA"],
        ["propuesto_por", e.admin],
        ["entrante_persona_id", e.otro],
        ["propuesto_en", new Date(PROPUESTO_EN.getTime() + 1000)],
        ["vence_en", new Date(VENCE_EN.getTime() + 1000)],
        // Una fecha lejana y fija (no `new Date()`): el valor nuevo tiene que ser siempre distinto del guardado.
        ["creado_en", new Date("2000-01-01T00:00:00.000Z")],
        ["saliente_persona_id", e.admin],
      ];
      for (const [columna, valor] of cambios) {
        await sinConfirmar(async () => {
          const r = await intento(`update traspaso_gerencia set ${columna} = $2 where id = $1`, [
            id,
            valor,
          ]);
          // El nombre de la columna va en el mensaje: si alguna vez no se rechaza, se sabe cuál fue.
          expect(r.ok, `el cambio de la columna ${columna} tenía que rechazarse`).toBe(false);
          check(r, "traspaso_gerencia_inmutable");
        });
      }
      // El de un traspaso de plataforma: solo al aceptar, y tiene que ser el gerente vigente.
      const plat = await armar();
      const idPlat = await traspasoDeBase(plat, plat.operador, { origen: "PLATAFORMA" });
      await sinConfirmar(async () => {
        check(
          await intento("update traspaso_gerencia set saliente_persona_id = $2 where id = $1", [
            idPlat,
            plat.gerente,
          ]),
          "traspaso_gerencia_inmutable",
        );
        check(
          await intento(
            `update traspaso_gerencia set estado = 'CANCELADO', resuelto_en = $3, saliente_persona_id = $2
             where id = $1`,
            [idPlat, plat.gerente, PROPUESTO_EN],
          ),
          "traspaso_gerencia_inmutable",
        );
        // Aceptar nombrando como saliente a quien no es el gerente (un administrador): no.
        check(
          await intento(
            `update traspaso_gerencia set estado = 'ACEPTADO', resuelto_en = $3, saliente_persona_id = $2
             where id = $1`,
            [idPlat, plat.admin, PROPUESTO_EN],
          ),
          "traspaso_saliente_no_es_gerente",
        );
        // Nombrando al gerente, pasa (y como falta cambiar los roles, se deshace sin confirmar).
        filas(
          await intento(
            `update traspaso_gerencia set estado = 'ACEPTADO', resuelto_en = $3, saliente_persona_id = $2
             where id = $1`,
            [idPlat, plat.gerente, PROPUESTO_EN],
          ),
          1,
        );
      });
      // Aceptar sin saliente (plataforma, sin completarlo) o con el entrante ya apagado: no.
      await sinConfirmar(async () => {
        check(
          await intento(
            "update traspaso_gerencia set estado = 'ACEPTADO', resuelto_en = $2 where id = $1",
            [idPlat, PROPUESTO_EN],
          ),
          "traspaso_saliente_no_es_gerente",
        );
      });
    });

    it("al aceptar, el entrante sigue siendo un miembro activo con la persona activa (pudo cambiar desde la propuesta)", async () => {
      const e = await armar();
      const id = await traspasoDeBase(e, e.operador);
      const aceptarDirecto = () =>
        intento(
          "update traspaso_gerencia set estado = 'ACEPTADO', resuelto_en = $2 where id = $1",
          [id, PROPUESTO_EN],
        );
      await sinConfirmar(async () => {
        await dueno.query(
          "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
          [e.empresa.empresa, e.operador],
        );
        check(await aceptarDirecto(), "traspaso_entrante_inactivo");
      });
      await sinConfirmar(async () => {
        await dueno.query("update persona set activo_global = false where id = $1", [e.operador]);
        check(await aceptarDirecto(), "traspaso_entrante_inactivo");
      });
      // Un entrante que ya es el gerente (no puede pasar, pero la base lo cierra igual): ver el test de
      // membresía; acá el control: con todo en orden, la aceptación pasa el disparador.
      await sinConfirmar(async () => filas(await aceptarDirecto(), 1));
    });

    it("cada UPDATE sube la versión y la fecha del traspaso", async () => {
      const e = await armar();
      const id = await traspasoDeBase(e, e.operador);
      const antes = (
        await consultar<{ version: number; actualizado_en: Date }>(
          "select version, actualizado_en from traspaso_gerencia where id = $1",
          [id],
        )
      )[0];
      expect(antes?.version).toBe(1);
      await dueno.query(
        "update traspaso_gerencia set estado = 'RECHAZADO', resuelto_en = $2 where id = $1",
        [id, PROPUESTO_EN],
      );
      const despues = (
        await consultar<{ version: number; actualizado_en: Date }>(
          "select version, actualizado_en from traspaso_gerencia where id = $1",
          [id],
        )
      )[0];
      expect(despues?.version).toBe(2);
      expect((despues?.actualizado_en ?? new Date(0)).getTime()).toBeGreaterThanOrEqual(
        (antes?.actualizado_en ?? new Date(0)).getTime(),
      );
    });
  });

  // ===============================================================================================
  // 3. Membresía: el rol cambia solo por traspaso, y el gerente activo no se apaga
  // ===============================================================================================
  describe("membresía: el rol solo cambia al aceptar un traspaso", () => {
    const ROLES_DE_PRUEBA = ["GERENTE", "ADMINISTRADOR", "OPERADOR"] as const;

    it("sin traspaso, ningún cambio de rol entra (los seis pares, aun para el dueño)", async () => {
      const e = await armar();
      const de = { GERENTE: e.gerente, ADMINISTRADOR: e.admin, OPERADOR: e.operador };
      for (const actual of ROLES_DE_PRUEBA) {
        for (const nuevo of ROLES_DE_PRUEBA) {
          if (actual === nuevo) continue;
          await sinConfirmar(async () => {
            check(
              await intento(
                "update membresia set rol = $3 where empresa_id = $1 and persona_id = $2",
                [e.empresa.empresa, de[actual], nuevo],
              ),
              "membresia_rol_sin_traspaso",
            );
          });
        }
      }
      expect(await rolDe(e, e.operador)).toEqual({ rol: "OPERADOR", activo: true });
    });

    it("con un traspaso PROPUESTO, RECHAZADO o CANCELADO tampoco: solo vale uno ACEPTADO", async () => {
      for (const estado of ["PROPUESTO", "RECHAZADO", "CANCELADO"]) {
        const e = await armar();
        const id = await traspasoDeBase(e, e.operador);
        if (estado !== "PROPUESTO") {
          await dueno.query(
            "update traspaso_gerencia set estado = $2, resuelto_en = $3 where id = $1",
            [id, estado, PROPUESTO_EN],
          );
        }
        await sinConfirmar(async () => {
          check(
            await intento(
              "update membresia set rol = 'GERENTE' where empresa_id = $1 and persona_id = $2",
              [e.empresa.empresa, e.operador],
            ),
            "membresia_rol_sin_traspaso",
          );
          check(
            await intento(
              "update membresia set rol = 'ADMINISTRADOR' where empresa_id = $1 and persona_id = $2",
              [e.empresa.empresa, e.gerente],
            ),
            "membresia_rol_sin_traspaso",
          );
        });
      }
    });

    it("con un traspaso aceptado en OTRA transacción tampoco: un traspaso viejo no se reutiliza", async () => {
      const e = await armar();
      const id = await traspasoDeBase(e, e.operador);
      await traspasarDeBase(e, id, e.gerente, e.operador);
      expect(await gerentesActivos(e)).toEqual([e.operador]);
      for (const [persona, nuevo] of [
        [e.operador, "ADMINISTRADOR"], // el gerente nuevo no vuelve atrás
        [e.operador, "OPERADOR"],
        [e.gerente, "GERENTE"], // el ex gerente no recupera la gerencia
        [e.gerente, "OPERADOR"],
        [e.admin, "GERENTE"],
      ] as const) {
        await sinConfirmar(async () => {
          check(
            await intento(
              "update membresia set rol = $3 where empresa_id = $1 and persona_id = $2",
              [e.empresa.empresa, persona, nuevo],
            ),
            "membresia_rol_sin_traspaso",
          );
        });
      }
    });

    it("dentro de la transacción que acepta: el saliente baja a ADMINISTRADOR y el entrante sube a GERENTE; nada más (nunca a OPERADOR, nunca un tercero)", async () => {
      const e = await armar();
      const id = await traspasoDeBase(e, e.admin); // el entrante es el administrador
      const casos: {
        descripcion: string;
        persona: string;
        nuevo: string;
        /** Hay que bajar antes al saliente (el índice parcial no deja dos gerentes ni un instante). */
        bajarAntes: boolean;
        permitido: boolean;
      }[] = [
        {
          descripcion: "el saliente baja a administrador",
          persona: e.gerente,
          nuevo: "ADMINISTRADOR",
          bajarAntes: false,
          permitido: true,
        },
        {
          descripcion: "el saliente NO baja a operador",
          persona: e.gerente,
          nuevo: "OPERADOR",
          bajarAntes: false,
          permitido: false,
        },
        {
          descripcion: "el entrante sube a gerente",
          persona: e.admin,
          nuevo: "GERENTE",
          bajarAntes: true,
          permitido: true,
        },
        {
          descripcion: "el entrante NO baja a operador",
          persona: e.admin,
          nuevo: "OPERADOR",
          bajarAntes: true,
          permitido: false,
        },
        {
          descripcion: "un tercero NO sube a gerente",
          persona: e.operador,
          nuevo: "GERENTE",
          bajarAntes: true,
          permitido: false,
        },
        {
          descripcion: "un tercero NO sube a administrador",
          persona: e.operador,
          nuevo: "ADMINISTRADOR",
          bajarAntes: true,
          permitido: false,
        },
        {
          descripcion: "otro operador NO sube a administrador",
          persona: e.otro,
          nuevo: "ADMINISTRADOR",
          bajarAntes: true,
          permitido: false,
        },
      ];
      for (const c of casos) {
        await conApp(e, e.admin, async (s) => {
          filas(await aceptar(s, id), 1);
          if (c.bajarAntes) filas(await cambiarRol(s, e, e.gerente, "ADMINISTRADOR"), 1);
          const r = await s.intentar(
            "update membresia set rol = $3 where empresa_id = $1 and persona_id = $2",
            [e.empresa.empresa, c.persona, c.nuevo],
          );
          if (c.permitido) filas(r, 1);
          else check(r, "membresia_rol_sin_traspaso");
        });
      }
      // Ya cambiados, no se vuelve atrás ni se invierte: el gerente nuevo no vuelve a administrador, y
      // el ex gerente no recupera la gerencia.
      await conApp(e, e.admin, async (s) => {
        filas(await aceptar(s, id), 1);
        filas(await cambiarRol(s, e, e.gerente, "ADMINISTRADOR"), 1);
        filas(await cambiarRol(s, e, e.admin, "GERENTE"), 1);
        check(
          await s.intentar(
            "update membresia set rol = 'ADMINISTRADOR' where empresa_id = $1 and persona_id = $2",
            [e.empresa.empresa, e.admin],
          ),
          "membresia_rol_sin_traspaso",
        );
        check(
          await s.intentar(
            "update membresia set rol = 'GERENTE' where empresa_id = $1 and persona_id = $2",
            [e.empresa.empresa, e.gerente],
          ),
          "membresia_rol_sin_traspaso",
        );
      });
    });

    it("nunca a OPERADOR: ni el saliente en la transacción de la aceptación, ni nadie, y el rol de un miembro apagado tampoco cambia", async () => {
      const e = await armar();
      const apagado = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa.empresa, apagado.id, "OPERADOR", false);
      // La política de apagar deja pasar la fila de un miembro apagado: lo frena el disparador.
      await conApp(e, e.admin, async (s) => {
        check(
          await s.directo(
            "update membresia set rol = 'ADMINISTRADOR' where empresa_id = $1 and persona_id = $2",
            [e.empresa.empresa, apagado.id],
          ),
          "membresia_rol_sin_traspaso",
        );
      });
      // Y con un traspaso aceptado cuyo entrante fuera ese miembro apagado, el cambio no vale (inactivo).
      await sinConfirmar(async () => {
        check(
          await intento(
            "update membresia set rol = 'GERENTE' where empresa_id = $1 and persona_id = $2",
            [e.empresa.empresa, apagado.id],
          ),
          "membresia_rol_sin_traspaso",
        );
      });
    });

    it("un invitado que reactiva a un miembro apagado conserva su rol: aunque la invitación traiga otro, ni la política ni el disparador lo cambian", async () => {
      const e = await armar();
      const persona = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa.empresa, persona.id, "OPERADOR", false);
      const inv = await crearInvitacionDeBase(dueno, {
        tenant: e.empresa.tenant,
        email: persona.email,
      });
      await incluirEmpresa(dueno, inv, e.empresa.empresa, "ADMINISTRADOR");
      await aceptarDeBase(dueno, inv, persona.id);
      const contexto = {
        tipo: "INVITACION",
        tokenHash: inv.tokenHash,
        usuarioAuth: null,
        ahora: PROPUESTO_EN,
      } as const;
      await conRol("zuluhub_app", contexto, async (s) => {
        // Solo `activo`: el WITH CHECK exige el rol de la invitación y la membresía tiene otro.
        denegado(
          await s.intentar("update membresia set activo = true where persona_id = $1", [
            persona.id,
          ]),
        );
        // Con el rol de la invitación también: el disparador (0005) lo frena.
        check(
          await s.intentar(
            "update membresia set activo = true, rol = 'ADMINISTRADOR' where persona_id = $1",
            [persona.id],
          ),
          "membresia_rol_sin_traspaso",
        );
      });
      expect(await rolDe(e, persona.id)).toEqual({ rol: "OPERADOR", activo: false });
    });

    it("el gerente activo no se apaga: error para el dueño (antes lo cuidaba solo la política); 0 filas para la aplicación; un administrador sí", async () => {
      const e = await armar();
      await sinConfirmar(async () => {
        check(
          await intento(
            "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
            [e.empresa.empresa, e.gerente],
          ),
          "membresia_gerente_no_se_apaga",
        );
      });
      // Ni siquiera junto con otros cambios (el rol, por ejemplo).
      await sinConfirmar(async () => {
        check(
          await intento(
            "update membresia set activo = false, rol = 'ADMINISTRADOR' where empresa_id = $1 and persona_id = $2",
            [e.empresa.empresa, e.gerente],
          ),
          "membresia_gerente_no_se_apaga",
        );
      });
      await conApp(e, e.admin, async (s) => {
        filas(
          await s.intentar("update membresia set activo = false where persona_id = $1", [
            e.gerente,
          ]),
          0,
        );
        // Control positivo: a un administrador y a un operador sí se los apaga.
        filas(
          await s.intentar("update membresia set activo = false where persona_id = $1", [
            e.operador,
          ]),
          1,
        );
      });
      expect((await rolDe(e, e.gerente))?.activo).toBe(true);
      // El gerente puede dejar de ser gerente, pero solo por traspaso: después, como administrador, se lo apaga.
      const id = await traspasoDeBase(e, e.admin);
      await traspasarDeBase(e, id, e.gerente, e.admin);
      await dueno.query(
        "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
        [e.empresa.empresa, e.gerente],
      );
      expect(await rolDe(e, e.gerente)).toEqual({ rol: "ADMINISTRADOR", activo: false });
    });

    it("si la aceptación usa un savepoint, el cambio de rol no entra (falla cerrado): el xmin del traspaso es el de la subtransacción", async () => {
      const e = await armar();
      const id = await traspasoDeBase(e, e.operador);
      await conApp(e, e.operador, async (s) => {
        // `intentar` envuelve en un savepoint: el xmin del traspaso es el de la subtransacción.
        filas(
          await s.intentar(
            "update traspaso_gerencia set estado = 'ACEPTADO', resuelto_en = $2 where id = $1",
            [id, PROPUESTO_EN],
          ),
          1,
        );
        // El saliente (gerente): la política no le deja ver la fila a quien no tiene el traspaso de esta
        // transacción, así que son 0 filas; el entrante (que la política sí deja ver): el disparador.
        filas(await cambiarRol(s, e, e.gerente, "ADMINISTRADOR"), 0);
        check(await cambiarRol(s, e, e.operador, "GERENTE"), "membresia_rol_sin_traspaso");
      });
    });

    it("dos barreras independientes: sin el disparador, la política sola impide que la aplicación cambie un rol fuera de la aceptación", async () => {
      if (base === null) return;
      const aparte = await crearBaseAparte(base);
      const duenoAparte = new pg.Client({ connectionString: aparte.base.dueno });
      await duenoAparte.connect();
      try {
        await duenoAparte.query("alter table membresia disable trigger membresia_cambio");
        const entornoAparte = crearEntornoDePrueba(aparte.base);
        try {
          const empresa = await crearEmpresaActiva(entornoAparte);
          const crear = async (rol: RolDePrueba) => {
            const p = await crearPersonaDeBase(duenoAparte);
            await crearMembresiaDeBase(duenoAparte, empresa.empresa, p.id, rol);
            return p.id;
          };
          const gerente = await crear("GERENTE");
          const admin = await crear("ADMINISTRADOR");
          const operador = await crear("OPERADOR");
          const contexto = comoEmpresa(empresa.empresa, personaId(admin));
          const rol = async (persona: string) =>
            (
              await duenoAparte.query<{ rol: string }>(
                "select rol from membresia where persona_id = $1",
                [persona],
              )
            ).rows[0]?.rol;
          // Sin traspaso: la política (el WITH CHECK pide el traspaso) lo rechaza.
          const s1 = await SesionDePrueba.abrir(aparte.base, "zuluhub_app", contexto);
          try {
            denegado(
              await s1.intentar("update membresia set rol = 'GERENTE' where persona_id = $1", [
                operador,
              ]),
            );
            filas(
              await s1.intentar("update membresia set rol = 'OPERADOR' where persona_id = $1", [
                gerente,
              ]),
              0,
            );
          } finally {
            await s1.cerrar();
          }
          // Con un traspaso aceptado en la transacción, la política deja pasar solo a las dos personas.
          const { rows } = await duenoAparte.query<{ id: string }>(
            `insert into traspaso_gerencia (empresa_id, origen, propuesto_por, saliente_persona_id,
                                            entrante_persona_id, propuesto_en, vence_en)
             values ($1, 'GERENTE', $2, $2, $3, $4, $5) returning id`,
            [empresa.empresa, gerente, admin, PROPUESTO_EN, VENCE_EN],
          );
          const s2 = await SesionDePrueba.abrir(aparte.base, "zuluhub_app", contexto);
          try {
            filas(
              await s2.directo(
                "update traspaso_gerencia set estado = 'ACEPTADO', resuelto_en = $2 where id = $1",
                [rows[0]?.id, PROPUESTO_EN],
              ),
              1,
            );
            denegado(
              await s2.intentar("update membresia set rol = 'GERENTE' where persona_id = $1", [
                operador,
              ]),
            );
            filas(
              await s2.intentar(
                "update membresia set rol = 'ADMINISTRADOR' where persona_id = $1",
                [gerente],
              ),
              1,
            );
            filas(
              await s2.intentar("update membresia set rol = 'GERENTE' where persona_id = $1", [
                admin,
              ]),
              1,
            );
            expect((await s2.confirmar()).ok).toBe(true);
          } finally {
            await s2.cerrar();
          }
          expect(await rol(admin)).toBe("GERENTE");
          expect(await rol(gerente)).toBe("ADMINISTRADOR");
        } finally {
          await entornoAparte.cerrar();
        }
      } finally {
        await duenoAparte.end();
        await aparte.destruir();
      }
    });
  });

  // ===============================================================================================
  // 4. El traspaso con los roles reales: quién puede qué
  // ===============================================================================================
  describe("el traspaso: quién puede qué", () => {
    const proponerSql = `insert into traspaso_gerencia (empresa_id, origen, propuesto_por, saliente_persona_id,
                                                       entrante_persona_id, propuesto_en, vence_en)
                         values ($1, 'GERENTE', $2, $2, $3, $4, $5)`;

    describe("proponer", () => {
      it("lo propone el gerente, a su nombre; la base anota quién y cuándo", async () => {
        const e = await armar();
        await conApp(e, e.gerente, async (s) => {
          filas(
            await s.intentar(proponerSql, [
              e.empresa.empresa,
              e.gerente,
              e.operador,
              PROPUESTO_EN,
              VENCE_EN,
            ]),
            1,
          );
          const { rows } = (await s.intentar(
            "select estado, propuesto_por, saliente_persona_id, version from traspaso_gerencia",
          )) as Extract<Intento, { ok: true }>;
          expect(rows).toEqual([
            {
              estado: "PROPUESTO",
              propuesto_por: e.gerente,
              saliente_persona_id: e.gerente,
              version: 1,
            },
          ]);
        });
      });

      it("no lo propone un administrador, un operador ni un ex gerente, ni nadie a nombre del gerente, ni con origen PLATAFORMA", async () => {
        const e = await armar();
        for (const quien of [e.admin, e.operador]) {
          await conApp(e, quien, async (s) => {
            check(
              await s.intentar(proponerSql, [
                e.empresa.empresa,
                quien,
                e.otro,
                PROPUESTO_EN,
                VENCE_EN,
              ]),
              "traspaso_saliente_no_es_gerente",
            );
            // A nombre del gerente verdadero: la política exige que sea la persona del contexto.
            denegado(
              await s.intentar(proponerSql, [
                e.empresa.empresa,
                e.gerente,
                e.otro,
                PROPUESTO_EN,
                VENCE_EN,
              ]),
            );
          });
        }
        await conApp(e, null, async (s) => {
          denegado(
            await s.intentar(proponerSql, [
              e.empresa.empresa,
              e.gerente,
              e.otro,
              PROPUESTO_EN,
              VENCE_EN,
            ]),
          );
        });
        await conApp(e, e.gerente, async (s) => {
          denegado(
            await s.intentar(
              `insert into traspaso_gerencia (empresa_id, origen, entrante_persona_id, propuesto_en, vence_en)
               values ($1, 'PLATAFORMA', $2, $3, $4)`,
              [e.empresa.empresa, e.operador, PROPUESTO_EN, VENCE_EN],
            ),
          );
        });
        // El ex gerente (ya administrador) tampoco.
        const id = await traspasoDeBase(e, e.operador);
        await traspasarDeBase(e, id, e.gerente, e.operador);
        await conApp(e, e.gerente, async (s) => {
          check(
            await s.intentar(proponerSql, [
              e.empresa.empresa,
              e.gerente,
              e.otro,
              PROPUESTO_EN,
              VENCE_EN,
            ]),
            "traspaso_saliente_no_es_gerente",
          );
        });
      });

      it("las columnas que la base fija sola no se eligen: id, estado, resolución, motivo, fechas de registro y versión", async () => {
        const e = await armar();
        for (const [columna, valor] of [
          ["id", "11111111-1111-4111-8111-111111111111"],
          ["estado", "ACEPTADO"],
          ["resuelto_en", PROPUESTO_EN],
          ["motivo", "VENCIDO"],
          ["creado_en", PROPUESTO_EN],
          ["actualizado_en", PROPUESTO_EN],
          ["version", 7],
        ] as const) {
          await conApp(e, e.gerente, async (s) => {
            denegado(
              await s.intentar(
                `insert into traspaso_gerencia (empresa_id, origen, propuesto_por, saliente_persona_id,
                                                entrante_persona_id, propuesto_en, vence_en, ${columna})
                 values ($1, 'GERENTE', $2, $2, $3, $4, $5, $6)`,
                [e.empresa.empresa, e.gerente, e.operador, PROPUESTO_EN, VENCE_EN, valor],
              ),
            );
          });
        }
      });

      it("a un miembro de otra empresa no (clave compuesta), a un inactivo tampoco, y solo uno en curso", async () => {
        const e = await armar();
        const b = await armar();
        const inactivo = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, e.empresa.empresa, inactivo.id, "OPERADOR", false);
        await conApp(e, e.gerente, async (s) => {
          referencia(
            await s.intentar(proponerSql, [
              e.empresa.empresa,
              e.gerente,
              b.operador,
              PROPUESTO_EN,
              VENCE_EN,
            ]),
            "traspaso_gerencia_entrante_fkey",
          );
          check(
            await s.intentar(proponerSql, [
              e.empresa.empresa,
              e.gerente,
              inactivo.id,
              PROPUESTO_EN,
              VENCE_EN,
            ]),
            "traspaso_entrante_inactivo",
          );
          filas(
            await s.intentar(proponerSql, [
              e.empresa.empresa,
              e.gerente,
              e.operador,
              PROPUESTO_EN,
              VENCE_EN,
            ]),
            1,
          );
          clave(
            await s.intentar(proponerSql, [
              e.empresa.empresa,
              e.gerente,
              e.otro,
              PROPUESTO_EN,
              VENCE_EN,
            ]),
            "traspaso_gerencia_en_curso_uk",
          );
        });
      });
    });

    describe("responder (aceptar o rechazar): solo el entrante", () => {
      it("el entrante acepta: el traspaso, el saliente y el entrante cambian juntos, y queda exactamente un gerente", async () => {
        const e = await armar();
        const id = await traspasoDeBase(e, e.operador);
        const versiones = async () =>
          Object.fromEntries(
            (
              await consultar<{ persona_id: string; version: number }>(
                "select persona_id, version from membresia where empresa_id = $1",
                [e.empresa.empresa],
              )
            ).map((f) => [f.persona_id, f.version]),
          );
        const antes = await versiones();
        await conApp(e, e.operador, async (s) => {
          filas(await aceptar(s, id), 1);
          filas(await cambiarRol(s, e, e.gerente, "ADMINISTRADOR"), 1);
          filas(await cambiarRol(s, e, e.operador, "GERENTE"), 1);
          expect((await s.confirmar()).ok).toBe(true);
        });
        expect(await gerentesActivos(e)).toEqual([e.operador]);
        expect(await rolDe(e, e.gerente)).toEqual({ rol: "ADMINISTRADOR", activo: true });
        expect(await rolDe(e, e.admin)).toEqual({ rol: "ADMINISTRADOR", activo: true });
        const despues = await versiones();
        expect(despues[e.gerente]).toBe((antes[e.gerente] ?? 0) + 1);
        expect(despues[e.operador]).toBe((antes[e.operador] ?? 0) + 1);
        expect(despues[e.admin]).toBe(antes[e.admin]);
        const [t] = await consultar<{
          estado: string;
          version: number;
          saliente_persona_id: string;
        }>("select estado, version, saliente_persona_id from traspaso_gerencia where id = $1", [
          id,
        ]);
        expect(t).toEqual({ estado: "ACEPTADO", version: 2, saliente_persona_id: e.gerente });
      });

      it("solo el entrante responde: el gerente, un administrador u otro operador no aceptan ni rechazan (la política lo rechaza)", async () => {
        const e = await armar();
        const id = await traspasoDeBase(e, e.operador);
        for (const quien of [e.gerente, e.admin, e.otro]) {
          await conApp(e, quien, async (s) => {
            denegado(await aceptar(s, id));
          });
          await conApp(e, quien, async (s) => {
            denegado(
              await s.directo(
                "update traspaso_gerencia set estado = 'RECHAZADO', resuelto_en = $2 where id = $1",
                [id, PROPUESTO_EN],
              ),
            );
          });
        }
        await conApp(e, null, async (s) => {
          denegado(await aceptar(s, id));
        });
        expect(await estadoDelTraspaso(id)).toBe("PROPUESTO");
      });

      it("el entrante rechaza; rechazar o aceptar otra vez no hace nada (0 filas) y ya no se puede aceptar", async () => {
        const e = await armar();
        const id = await traspasoDeBase(e, e.operador);
        await conApp(e, e.operador, async (s) => {
          filas(
            await s.directo(
              "update traspaso_gerencia set estado = 'RECHAZADO', resuelto_en = $2, motivo = 'RECHAZADO_POR_EL_ENTRANTE' where id = $1",
              [id, PROPUESTO_EN],
            ),
            1,
          );
          filas(await aceptar(s, id), 0);
          filas(
            await s.directo(
              "update traspaso_gerencia set estado = 'RECHAZADO', resuelto_en = $2 where id = $1",
              [id, PROPUESTO_EN],
            ),
            0,
          );
          expect((await s.confirmar()).ok).toBe(true);
        });
        expect(await estadoDelTraspaso(id)).toBe("RECHAZADO");
        expect(await gerentesActivos(e)).toEqual([e.gerente]);
      });

      it("no se acepta a partir del vencimiento (la fecha de la aceptación tiene que ser anterior)", async () => {
        const e = await armar();
        const id = await traspasoDeBase(e, e.operador);
        await conApp(e, e.operador, async (s) => {
          check(await aceptar(s, id, VENCE_EN), "traspaso_gerencia_aceptado_ck");
        });
        await conApp(e, e.operador, async (s) => {
          check(await aceptar(s, id, DESPUES_DEL_VENCIMIENTO), "traspaso_gerencia_aceptado_ck");
        });
        await conApp(e, e.operador, async (s) => {
          filas(await aceptar(s, id, new Date(VENCE_EN.getTime() - 1)), 1);
        });
      });

      it("al aceptar, el entrante apagado o el saliente que ya no es el gerente lo frena el disparador", async () => {
        const e = await armar();
        const id = await traspasoDeBase(e, e.operador);
        await dueno.query(
          "update membresia set activo = false where empresa_id = $1 and persona_id = $2",
          [e.empresa.empresa, e.operador],
        );
        // El entrante apagado ni siquiera ve su traspaso como miembro activo: aceptar da error.
        await conApp(e, e.operador, async (s) => {
          check(await aceptar(s, id), "traspaso_entrante_inactivo");
        });
        await dueno.query(
          "update membresia set activo = true where empresa_id = $1 and persona_id = $2",
          [e.empresa.empresa, e.operador],
        );
        // Traspaso de plataforma: el entrante completa como saliente a quien NO es el gerente.
        const plat = await armar();
        const idPlat = await traspasoDeBase(plat, plat.operador, { origen: "PLATAFORMA" });
        await conApp(plat, plat.operador, async (s) => {
          check(
            await aceptar(s, idPlat, PROPUESTO_EN, plat.admin),
            "traspaso_saliente_no_es_gerente",
          );
        });
        await conApp(plat, plat.operador, async (s) => {
          check(await aceptar(s, idPlat), "traspaso_saliente_no_es_gerente");
        });
      });
    });

    describe("atomicidad: al confirmar, el traspaso aceptado y el cambio de roles van juntos", () => {
      it("aceptar sin cambiar los roles no se confirma (y no queda nada)", async () => {
        const e = await armar();
        const id = await traspasoDeBase(e, e.operador);
        await conApp(e, e.operador, async (s) => {
          filas(await aceptar(s, id), 1);
          check(await s.confirmar(), "traspaso_aceptado_incompleto");
        });
        expect(await estadoDelTraspaso(id)).toBe("PROPUESTO");
        expect(await gerentesActivos(e)).toEqual([e.gerente]);
      });

      it("bajar al saliente sin subir al entrante (la empresa quedaría sin gerente) no se confirma", async () => {
        const e = await armar();
        const id = await traspasoDeBase(e, e.operador);
        await conApp(e, e.operador, async (s) => {
          filas(await aceptar(s, id), 1);
          filas(await cambiarRol(s, e, e.gerente, "ADMINISTRADOR"), 1);
          check(await s.confirmar(), "traspaso_aceptado_incompleto");
        });
        expect(await estadoDelTraspaso(id)).toBe("PROPUESTO");
        expect(await gerentesActivos(e)).toEqual([e.gerente]);
        expect(await rolDe(e, e.gerente)).toEqual({ rol: "GERENTE", activo: true });
      });

      it("subir al entrante antes de bajar al saliente choca con el índice de un solo gerente", async () => {
        const e = await armar();
        const id = await traspasoDeBase(e, e.operador);
        await conApp(e, e.operador, async (s) => {
          filas(await aceptar(s, id), 1);
          clave(await cambiarRol(s, e, e.operador, "GERENTE"), "membresia_gerente_uk");
        });
        expect(await gerentesActivos(e)).toEqual([e.gerente]);
      });

      it("aceptar y apagar al ex gerente en la misma transacción no se confirma; apagar al nuevo gerente, tampoco", async () => {
        const e = await armar();
        const id = await traspasoDeBase(e, e.operador);
        await conApp(e, e.operador, async (s) => {
          filas(await aceptar(s, id), 1);
          filas(await cambiarRol(s, e, e.gerente, "ADMINISTRADOR"), 1);
          filas(await cambiarRol(s, e, e.operador, "GERENTE"), 1);
          filas(
            await s.directo("update membresia set activo = false where persona_id = $1", [
              e.gerente,
            ]),
            1,
          );
          check(await s.confirmar(), "traspaso_aceptado_incompleto");
        });
        await conApp(e, e.operador, async (s) => {
          filas(await aceptar(s, id), 1);
          filas(await cambiarRol(s, e, e.gerente, "ADMINISTRADOR"), 1);
          filas(await cambiarRol(s, e, e.operador, "GERENTE"), 1);
          check(
            await s.intentar("update membresia set activo = false where persona_id = $1", [
              e.operador,
            ]),
            "membresia_gerente_no_se_apaga",
          );
        });
        expect(await gerentesActivos(e)).toEqual([e.gerente]);
        expect(await estadoDelTraspaso(id)).toBe("PROPUESTO");
      });

      it("si falla un paso (forzado), no queda nada: ni el traspaso aceptado, ni el cambio del saliente", async () => {
        const e = await armar();
        const id = await traspasoDeBase(e, e.operador);
        await expect(
          entorno.ejecutar({ contexto: comoPersona(e, e.operador) }, async ({ db }) => {
            await sql`update traspaso_gerencia set estado = 'ACEPTADO', resuelto_en = ${PROPUESTO_EN}
                      where id = ${id}`.execute(db);
            await sql`update membresia set rol = 'ADMINISTRADOR'
                      where empresa_id = ${e.empresa.empresa} and persona_id = ${e.gerente}`.execute(
              db,
            );
            throw new Error("falla forzada antes de subir al entrante");
          }),
        ).rejects.toThrow("falla forzada");
        expect(await estadoDelTraspaso(id)).toBe("PROPUESTO");
        expect(await gerentesActivos(e)).toEqual([e.gerente]);
        expect(await rolDe(e, e.gerente)).toEqual({ rol: "GERENTE", activo: true });
      });

      it("el recorrido completo por el adaptador (serializable): acepta y deja un solo gerente", async () => {
        const e = await armar();
        const id = await traspasoDeBase(e, e.operador);
        const r = await entorno.ejecutar(
          { contexto: comoPersona(e, e.operador) },
          async ({ db }) => {
            const { rows } = await sql<{ rol: string; persona_id: string }>`
            select rol, persona_id from membresia where rol = 'GERENTE' and activo`.execute(db);
            const saliente = rows[0]?.persona_id as string;
            await sql`update traspaso_gerencia set estado = 'ACEPTADO', resuelto_en = ${PROPUESTO_EN}
                    where id = ${id}`.execute(db);
            await sql`update membresia set rol = 'ADMINISTRADOR'
                    where empresa_id = ${e.empresa.empresa} and persona_id = ${saliente}`.execute(
              db,
            );
            await sql`update membresia set rol = 'GERENTE'
                    where empresa_id = ${e.empresa.empresa} and persona_id = ${e.operador}`.execute(
              db,
            );
            return ok(saliente);
          },
        );
        expect(r).toEqual({ ok: true, valor: e.gerente });
        expect(await gerentesActivos(e)).toEqual([e.operador]);
      });

      it("el recorrido incompleto por el adaptador devuelve el error de la restricción diferida (Check)", async () => {
        const e = await armar();
        const id = await traspasoDeBase(e, e.operador);
        const r = await entorno.ejecutar(
          { contexto: comoPersona(e, e.operador) },
          async ({ db }) => {
            await sql`update traspaso_gerencia set estado = 'ACEPTADO', resuelto_en = ${PROPUESTO_EN}
                    where id = ${id}`.execute(db);
            return ok(null);
          },
        );
        expect(r).toEqual({
          ok: false,
          error: { tipo: "Check", restriccion: "traspaso_aceptado_incompleto" },
        });
        expect(await estadoDelTraspaso(id)).toBe("PROPUESTO");
      });
    });

    describe("cancelar", () => {
      it("cancela un gerente, un administrador o el sistema; un operador no; y cancelar dos veces no hace nada", async () => {
        const e = await armar();
        const cancelar = (s: SesionDePrueba, id: string) =>
          s.directo(
            "update traspaso_gerencia set estado = 'CANCELADO', resuelto_en = $2, motivo = 'CANCELADO_POR_LA_EMPRESA' where id = $1",
            [id, PROPUESTO_EN],
          );
        const id = await traspasoDeBase(e, e.operador);
        // Un operador que no es el entrante, y el propio entrante operador: no.
        await conApp(e, e.otro, async (s) => {
          check(await cancelar(s, id), "traspaso_cancela_sin_permiso");
        });
        await conApp(e, e.operador, async (s) => {
          check(await cancelar(s, id), "traspaso_cancela_sin_permiso");
        });
        expect(await estadoDelTraspaso(id)).toBe("PROPUESTO");
        for (const quien of [e.gerente, e.admin, null]) {
          await conApp(e, quien, async (s) => {
            filas(await cancelar(s, id), 1);
            filas(await cancelar(s, id), 0);
            await s.deshacer();
          });
        }
        await conApp(e, e.gerente, async (s) => {
          filas(await cancelar(s, id), 1);
          expect((await s.confirmar()).ok).toBe(true);
        });
        expect(await estadoDelTraspaso(id)).toBe("CANCELADO");
        // Y ya cancelado no se acepta: 0 filas.
        await conApp(e, e.operador, async (s) => {
          filas(await aceptar(s, id), 0);
        });
      });

      it("el entrante que es administrador también puede cancelar (equivale a rechazar)", async () => {
        const e = await armar();
        const id = await traspasoDeBase(e, e.admin);
        await conApp(e, e.admin, async (s) => {
          filas(
            await s.directo(
              "update traspaso_gerencia set estado = 'CANCELADO', resuelto_en = $2 where id = $1",
              [id, PROPUESTO_EN],
            ),
            1,
          );
        });
      });
    });

    describe("la plataforma", () => {
      const proponerPlat = `insert into traspaso_gerencia (empresa_id, origen, entrante_persona_id, propuesto_en, vence_en)
                            values ($1, 'PLATAFORMA', $2, $3, $4)`;

      it("un ADMIN propone sin conocer al gerente, lee los traspasos y cancela los suyos; no acepta ni rechaza ni nombra al saliente", async () => {
        const e = await armar();
        await conRol("zuluhub_plataforma", comoPlataforma(), async (s) => {
          filas(
            await s.intentar(proponerPlat, [e.empresa.empresa, e.operador, PROPUESTO_EN, VENCE_EN]),
            1,
          );
          const { rows } = (await s.intentar(
            "select origen, propuesto_por, saliente_persona_id, estado from traspaso_gerencia where empresa_id = $1",
            [e.empresa.empresa],
          )) as Extract<Intento, { ok: true }>;
          expect(rows).toEqual([
            {
              origen: "PLATAFORMA",
              propuesto_por: null,
              saliente_persona_id: null,
              estado: "PROPUESTO",
            },
          ]);
          // No acepta (el disparador pide al gerente vigente como saliente, que no puede nombrar) ni
          // rechaza (la política solo le deja cancelar).
          noEntra(
            await s.intentar("update traspaso_gerencia set estado = 'ACEPTADO', resuelto_en = $1", [
              PROPUESTO_EN,
            ]),
          );
          denegado(
            await s.intentar(
              "update traspaso_gerencia set estado = 'RECHAZADO', resuelto_en = $1",
              [PROPUESTO_EN],
            ),
          );
          // No nombra al saliente ni elige a quien propone (sin permiso de columna).
          denegado(
            await s.intentar("update traspaso_gerencia set saliente_persona_id = $1", [e.gerente]),
          );
          denegado(
            await s.intentar(
              `insert into traspaso_gerencia (empresa_id, origen, propuesto_por, entrante_persona_id, propuesto_en, vence_en)
               values ($1, 'PLATAFORMA', $2, $3, $4, $5)`,
              [e.empresa.empresa, e.gerente, e.otro, PROPUESTO_EN, VENCE_EN],
            ),
          );
          // Con origen GERENTE no (el disparador pide al gerente vigente; la política, PLATAFORMA).
          noEntra(
            await s.intentar(
              `insert into traspaso_gerencia (empresa_id, origen, entrante_persona_id, propuesto_en, vence_en)
               values ($1, 'GERENTE', $2, $3, $4)`,
              [e.empresa.empresa, e.otro, PROPUESTO_EN, VENCE_EN],
            ),
          );
          filas(
            await s.intentar(
              "update traspaso_gerencia set estado = 'CANCELADO', resuelto_en = $2, motivo = 'CANCELADO_POR_LA_PLATAFORMA' where empresa_id = $1",
              [e.empresa.empresa, PROPUESTO_EN],
            ),
            1,
          );
          await s.deshacer();
        });
      });

      it("el SOPORTE lee pero no propone ni cancela; 'sistema' lee y no escribe; sin actor no ve ni escribe nada", async () => {
        const e = await armar();
        await traspasoDeBase(e, e.operador);
        const soporte = comoPlataforma({ tipo: "ADMIN", id: SOPORTE_DE_PRUEBA });
        const sistema = comoPlataforma({ tipo: "SISTEMA", proceso: "barrido" });
        for (const contexto of [soporte, sistema]) {
          await conRol("zuluhub_plataforma", contexto, async (s) => {
            const { rows } = (await s.intentar(
              "select id from traspaso_gerencia where empresa_id = $1",
              [e.empresa.empresa],
            )) as Extract<Intento, { ok: true }>;
            expect(rows).toHaveLength(1);
            denegado(
              await s.intentar(proponerPlat, [e.empresa.empresa, e.otro, PROPUESTO_EN, VENCE_EN]),
            );
            filas(
              await s.intentar(
                "update traspaso_gerencia set estado = 'CANCELADO', resuelto_en = $2 where empresa_id = $1",
                [e.empresa.empresa, PROPUESTO_EN],
              ),
              0,
            );
          });
        }
        // Sin contexto firmado (un rol de plataforma sin actor): 0 filas y nada se escribe.
        await conRol("zuluhub_plataforma", null, async (s) => {
          filas(await s.intentar("select id from traspaso_gerencia"), 0);
          denegado(
            await s.intentar(proponerPlat, [e.empresa.empresa, e.otro, PROPUESTO_EN, VENCE_EN]),
          );
        });
        // Un ADMIN dado de baja tampoco.
        const baja = "aaaaaaaa-0000-4000-8000-0000000000ff";
        await dueno.query(
          "insert into admin_plataforma (id, email, rol, activo) values ($1, 'baja-traspaso@prueba.test', 'ADMIN', false) on conflict do nothing",
          [baja],
        );
        await conRol(
          "zuluhub_plataforma",
          comoPlataforma({ tipo: "ADMIN", id: adminPlataformaId(baja) }),
          async (s) => {
            filas(await s.intentar("select id from traspaso_gerencia"), 0);
            denegado(
              await s.intentar(proponerPlat, [e.empresa.empresa, e.otro, PROPUESTO_EN, VENCE_EN]),
            );
          },
        );
      });

      it("no propone a quien ya es el gerente ni a un miembro apagado; ni lee ni toca las membresías por esta vía", async () => {
        const e = await armar();
        const apagado = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, e.empresa.empresa, apagado.id, "OPERADOR", false);
        await conRol("zuluhub_plataforma", comoPlataforma(), async (s) => {
          check(
            await s.intentar(proponerPlat, [e.empresa.empresa, e.gerente, PROPUESTO_EN, VENCE_EN]),
            "traspaso_entrante_es_el_gerente",
          );
          check(
            await s.intentar(proponerPlat, [e.empresa.empresa, apagado.id, PROPUESTO_EN, VENCE_EN]),
            "traspaso_entrante_inactivo",
          );
          // Las membresías: solo 4 columnas (0004), y ningún cambio, tampoco del rol.
          denegado(await s.intentar("select * from membresia"));
          denegado(await s.intentar("update membresia set rol = 'GERENTE'"));
          denegado(await s.intentar("update membresia set activo = false"));
        });
      });

      it("el recorrido de plataforma completo: propone, el entrante acepta nombrando al gerente vigente como saliente, y queda un solo gerente", async () => {
        const e = await armar();
        await conRol("zuluhub_plataforma", comoPlataforma(), async (s) => {
          filas(
            await s.intentar(proponerPlat, [e.empresa.empresa, e.admin, PROPUESTO_EN, VENCE_EN]),
            1,
          );
          expect((await s.confirmar()).ok).toBe(true);
        });
        const id = (
          await consultar<{ id: string }>(
            "select id from traspaso_gerencia where empresa_id = $1",
            [e.empresa.empresa],
          )
        )[0]?.id as string;
        await conApp(e, e.admin, async (s) => {
          filas(await aceptar(s, id, PROPUESTO_EN, e.gerente), 1);
          filas(await cambiarRol(s, e, e.gerente, "ADMINISTRADOR"), 1);
          filas(await cambiarRol(s, e, e.admin, "GERENTE"), 1);
          expect((await s.confirmar()).ok).toBe(true);
        });
        expect(await gerentesActivos(e)).toEqual([e.admin]);
        expect(await rolDe(e, e.gerente)).toEqual({ rol: "ADMINISTRADOR", activo: true });
        const [t] = await consultar<{ saliente_persona_id: string; estado: string }>(
          "select saliente_persona_id, estado from traspaso_gerencia where id = $1",
          [id],
        );
        expect(t).toEqual({ saliente_persona_id: e.gerente, estado: "ACEPTADO" });
      });
    });

    describe("aislamiento y roles sin acceso", () => {
      it("la empresa A no lee, propone, responde, cancela ni cambia roles en B (ni en C, del mismo tenant)", async () => {
        const a = await armar();
        const c = await armar({ tenant: a.empresa.tenant });
        const b = await armar();
        const idB = await traspasoDeBase(b, b.operador);
        const idC = await traspasoDeBase(c, c.operador);
        const idA = await traspasoDeBase(a, a.operador);
        await conApp(a, a.gerente, async (s) => {
          const { rows } = (await s.intentar("select id from traspaso_gerencia")) as Extract<
            Intento,
            { ok: true }
          >;
          expect(rows).toEqual([{ id: idA }]);
          for (const id of [idB, idC]) {
            filas(
              await s.intentar(
                "update traspaso_gerencia set estado = 'CANCELADO', resuelto_en = $2 where id = $1",
                [id, PROPUESTO_EN],
              ),
              0,
            );
          }
          // Proponer en B desde A: ni el disparador (no ve al gerente de B) ni la política (otra empresa).
          noEntra(
            await s.intentar(proponerSql, [
              b.empresa.empresa,
              b.gerente,
              b.otro,
              PROPUESTO_EN,
              VENCE_EN,
            ]),
          );
          // El entrante de B no puede aceptar con el contexto de A.
          filas(
            await s.intentar("update membresia set activo = false where persona_id = $1", [
              b.operador,
            ]),
            0,
          );
        });
        // Quien es entrante en B no acepta desde A (no es miembro de A): su contexto de A no lo ve.
        await conApp(a, b.operador, async (s) => {
          filas(await aceptar(s, idB), 0);
          // El de A sí lo ve, pero no es su entrante: la política no deja que lo acepte.
          denegado(await aceptar(s, idA));
        });
        for (const id of [idA, idB, idC]) expect(await estadoDelTraspaso(id)).toBe("PROPUESTO");
      });

      it("con la empresa o su tenant suspendidos no se propone, ni se responde, ni se cancela, ni cambia un rol", async () => {
        for (const que of ["empresa", "tenant"] as const) {
          const e = await armar();
          const id = await traspasoDeBase(e, e.operador);
          if (que === "empresa") {
            await dueno.query(
              "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
              [e.empresa.empresa],
            );
          } else {
            await dueno.query(
              "update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
              [e.empresa.tenant],
            );
          }
          await conApp(e, e.operador, async (s) => {
            filas(await aceptar(s, id), 0);
            filas(
              await s.directo(
                "update traspaso_gerencia set estado = 'RECHAZADO', resuelto_en = $2 where id = $1",
                [id, PROPUESTO_EN],
              ),
              0,
            );
          });
          await conApp(e, e.gerente, async (s) => {
            filas(
              await s.directo(
                "update traspaso_gerencia set estado = 'CANCELADO', resuelto_en = $2 where id = $1",
                [id, PROPUESTO_EN],
              ),
              0,
            );
          });
          await dueno.query(
            "update traspaso_gerencia set estado = 'CANCELADO', resuelto_en = $2 where id = $1",
            [id, PROPUESTO_EN],
          );
          await conApp(e, e.gerente, async (s) => {
            denegado(
              await s.intentar(proponerSql, [
                e.empresa.empresa,
                e.gerente,
                e.otro,
                PROPUESTO_EN,
                VENCE_EN,
              ]),
            );
            // Un cambio de rol (aun sin traspaso) ni siquiera ve la fila para actualizarla.
            filas(
              await s.intentar("update membresia set rol = 'ADMINISTRADOR' where persona_id = $1", [
                e.gerente,
              ]),
              0,
            );
          });
        }
      });

      it("el grupo, los trabajos y la autenticación no tocan traspaso_gerencia (42501), ni la plataforma ni nadie lo borra", async () => {
        const e = await armar();
        await traspasoDeBase(e, e.operador);
        const propietario = await crearPropietario(entorno, e.empresa.tenant);
        const intentos = [
          "select * from traspaso_gerencia",
          "update traspaso_gerencia set motivo = motivo",
          "delete from traspaso_gerencia",
          `insert into traspaso_gerencia (empresa_id, origen, entrante_persona_id, propuesto_en, vence_en)
           values ('${e.empresa.empresa}', 'PLATAFORMA', '${e.otro}', now(), now() + interval '1 day')`,
        ];
        for (const [rol, contexto] of [
          ["zuluhub_grupo", comoGrupo(e.empresa.tenant, propietario)],
          ["zuluhub_trabajos", comoTrabajos()],
        ] as const) {
          await conRol(rol, contexto, async (s) => {
            for (const texto of intentos) denegado(await s.intentar(texto));
          });
        }
        const autenticacion = new pg.Client({ connectionString: base?.autenticacion });
        await autenticacion.connect();
        try {
          for (const texto of intentos) {
            await expect(autenticacion.query(texto), texto).rejects.toMatchObject({
              code: "42501",
            });
          }
        } finally {
          await autenticacion.end();
        }
        await conApp(e, e.gerente, async (s) => {
          denegado(await s.intentar("delete from traspaso_gerencia"));
        });
        await conRol("zuluhub_plataforma", comoPlataforma(), async (s) => {
          denegado(await s.intentar("delete from traspaso_gerencia"));
          denegado(await s.intentar("truncate traspaso_gerencia"));
        });
      });

      it("sin contexto firmado, la aplicación ve 0 filas de traspaso_gerencia y no escribe", async () => {
        const e = await armar();
        await traspasoDeBase(e, e.operador);
        await conRol("zuluhub_app", null, async (s) => {
          filas(await s.intentar("select * from traspaso_gerencia"), 0);
          noEntra(
            await s.intentar(proponerSql, [
              e.empresa.empresa,
              e.gerente,
              e.otro,
              PROPUESTO_EN,
              VENCE_EN,
            ]),
          );
          filas(await s.intentar("update traspaso_gerencia set motivo = motivo"), 0);
        });
      });
    });
  });

  // ===============================================================================================
  // 5. Asignaciones desde la empresa
  // ===============================================================================================
  describe("asignaciones: la empresa asigna y reasigna", () => {
    const asignar = (s: SesionDePrueba, e: Escena, persona: string, sucursal: string) =>
      s.intentar(
        "insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id) values ($1, $2, $3)",
        [e.empresa.empresa, persona, sucursal],
      );
    const reactivar = (s: SesionDePrueba, e: Escena, persona: string, sucursal: string) =>
      s.intentar(
        `update asignacion_sucursal set activa = true
         where empresa_id = $1 and persona_id = $2 and sucursal_id = $3`,
        [e.empresa.empresa, persona, sucursal],
      );
    /** Otra sucursal de la empresa (activa o no), creada por el dueño. */
    const otraSucursal = async (e: Escena, nombre: string, activa = true): Promise<string> => {
      const { rows } = await dueno.query<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
        [e.empresa.empresa, nombre],
      );
      const id = rows[0]?.id as string;
      if (!activa) {
        await dueno.query("update sucursal set activa = false where id = $1", [id]);
      }
      return id;
    };

    it("asigna a un miembro activo a una sucursal activa de su empresa; repetirlo choca con la clave", async () => {
      const e = await armar();
      await conApp(e, e.gerente, async (s) => {
        filas(await asignar(s, e, e.operador, e.sucursal), 1);
        clave(await asignar(s, e, e.operador, e.sucursal), "asignacion_sucursal_pkey");
      });
      await conApp(e, e.admin, async (s) => {
        filas(await asignar(s, e, e.otro, e.sucursal), 1);
      });
      // El sistema (contexto sin persona) también: la política no mira quién.
      await conApp(e, null, async (s) => {
        filas(await asignar(s, e, e.gerente, e.sucursal), 1);
      });
    });

    it("no asigna a quien no es miembro, a un miembro apagado, a uno de otra empresa, ni a una sucursal inactiva o ajena", async () => {
      const e = await armar();
      const b = await armar();
      const apagado = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa.empresa, apagado.id, "OPERADOR", false);
      const suelta = await crearPersonaDeBase(dueno);
      const inactiva = await otraSucursal(e, "Cerrada", false);
      await conApp(e, e.gerente, async (s) => {
        denegado(await asignar(s, e, apagado.id, e.sucursal));
        denegado(await asignar(s, e, suelta.id, e.sucursal));
        denegado(await asignar(s, e, b.operador, e.sucursal));
        denegado(await asignar(s, e, e.operador, inactiva));
        denegado(await asignar(s, e, e.operador, b.sucursal));
        // En la empresa de otro: la política exige la empresa del contexto.
        denegado(
          await s.intentar(
            "insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id) values ($1, $2, $3)",
            [b.empresa.empresa, b.operador, b.sucursal],
          ),
        );
        // Y las columnas que fija la base no se eligen.
        denegado(
          await s.intentar(
            "insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id, activa) values ($1, $2, $3, false)",
            [e.empresa.empresa, e.operador, e.sucursal],
          ),
        );
      });
    });

    it("reactiva una asignación apagada solo si el miembro y la sucursal siguen activos; apagarla sigue como antes", async () => {
      const e = await armar();
      const segunda = await otraSucursal(e, "Norte");
      const apagado = await crearPersonaDeBase(dueno);
      await crearMembresiaDeBase(dueno, e.empresa.empresa, apagado.id, "OPERADOR", false);
      await crearAsignacionDeBase(dueno, e.empresa.empresa, e.operador, e.sucursal, false);
      await crearAsignacionDeBase(dueno, e.empresa.empresa, e.operador, segunda, false);
      await crearAsignacionDeBase(dueno, e.empresa.empresa, apagado.id, e.sucursal, false);
      await dueno.query("update sucursal set activa = false where id = $1", [segunda]);
      await conApp(e, e.gerente, async (s) => {
        filas(await reactivar(s, e, e.operador, e.sucursal), 1);
        // La sucursal quedó inactiva: no se reactiva la asignación (se reactiva primero la sucursal).
        denegado(await reactivar(s, e, e.operador, segunda));
        // El miembro está apagado: tampoco.
        denegado(await reactivar(s, e, apagado.id, e.sucursal));
        // Apagar: como antes.
        filas(
          await s.intentar(
            "update asignacion_sucursal set activa = false where persona_id = $1 and sucursal_id = $2",
            [e.operador, e.sucursal],
          ),
          1,
        );
        // El sistema reactiva igual; y reactivar una activa no cambia nada (ya estaba).
        filas(await reactivar(s, e, e.operador, e.sucursal), 1);
        filas(await reactivar(s, e, e.operador, e.sucursal), 1);
      });
    });

    it("desactivar una sucursal no apaga las asignaciones: al reactivarla la gente vuelve como estaba", async () => {
      const e = await armar();
      const segunda = await otraSucursal(e, "Norte");
      await crearAsignacionDeBase(dueno, e.empresa.empresa, e.operador, segunda);
      await conApp(e, e.gerente, async (s) => {
        filas(await s.intentar("update sucursal set activa = false where id = $1", [segunda]), 1);
        const { rows } = (await s.intentar(
          "select activa from asignacion_sucursal where persona_id = $1",
          [e.operador],
        )) as Extract<Intento, { ok: true }>;
        expect(rows).toEqual([{ activa: true }]);
      });
    });

    it("con la empresa o su tenant suspendidos no se asigna ni se reactiva", async () => {
      for (const que of ["empresa", "tenant"] as const) {
        const e = await armar();
        await crearAsignacionDeBase(dueno, e.empresa.empresa, e.operador, e.sucursal, false);
        await dueno.query(
          `update ${que} set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1`,
          [que === "empresa" ? e.empresa.empresa : e.empresa.tenant],
        );
        await conApp(e, e.gerente, async (s) => {
          denegado(await asignar(s, e, e.otro, e.sucursal));
          filas(await reactivar(s, e, e.operador, e.sucursal), 0);
        });
      }
    });

    it("el contexto de invitación no usa las políticas de la empresa: solo las sucursales de su invitación", async () => {
      const e = await armar();
      const segunda = await otraSucursal(e, "Norte");
      const persona = await crearPersonaDeBase(dueno);
      const inv = await crearInvitacionDeBase(dueno, {
        tenant: e.empresa.tenant,
        email: persona.email,
      });
      await incluirEmpresa(dueno, inv, e.empresa.empresa, "OPERADOR", [e.sucursal]);
      await aceptarDeBase(dueno, inv, persona.id);
      await crearMembresiaDeBase(dueno, e.empresa.empresa, persona.id, "OPERADOR");
      const contexto = {
        tipo: "INVITACION",
        tokenHash: inv.tokenHash,
        usuarioAuth: null,
        ahora: PROPUESTO_EN,
      } as const;
      await conRol("zuluhub_app", contexto, async (s) => {
        // La sucursal que la invitación no lista: denegada, aunque la empresa sí la podría asignar.
        denegado(await asignar(s, e, persona.id, segunda));
        filas(await asignar(s, e, persona.id, e.sucursal), 1);
      });
    });

    it("el grupo y los trabajos siguen sin ver ni tocar las asignaciones; la plataforma tampoco", async () => {
      const e = await armar();
      await crearAsignacionDeBase(dueno, e.empresa.empresa, e.operador, e.sucursal);
      const propietario = await crearPropietario(entorno, e.empresa.tenant);
      for (const [rol, contexto] of [
        ["zuluhub_grupo", comoGrupo(e.empresa.tenant, propietario)],
        ["zuluhub_trabajos", comoTrabajos()],
        ["zuluhub_plataforma", comoPlataforma()],
      ] as const) {
        await conRol(rol, contexto, async (s) => {
          denegado(await s.intentar("select * from asignacion_sucursal"));
          denegado(await asignar(s, e, e.otro, e.sucursal));
          denegado(await s.intentar("update asignacion_sucursal set activa = true"));
        });
      }
    });
  });

  // ===============================================================================================
  // 6. Sucursales: nombre sin depender del locale, largo, caracteres y «nunca sin una activa»
  // ===============================================================================================
  describe("sucursales", () => {
    const alta = (e: Escena, nombre: string) =>
      dueno.query("insert into sucursal (empresa_id, nombre) values ($1, $2)", [
        e.empresa.empresa,
        nombre,
      ]);
    const altaConIntento = (e: Escena, nombre: string) =>
      intento("insert into sucursal (empresa_id, nombre) values ($1, $2)", [
        e.empresa.empresa,
        nombre,
      ]);
    const sucursales = async (e: Escena) =>
      (
        await consultar<{ id: string }>(
          "select id from sucursal where empresa_id = $1 order by nombre",
          [e.empresa.empresa],
        )
      ).map((f) => f.id);

    it("«CAFÉ» y «café» son el mismo nombre aunque el servidor tenga locale C (lower() no lo vería); «café» y «cafe» no", async () => {
      const e = await armar();
      expect((await consultar<{ l: string }>("select lower('CAFÉ') as l"))[0]?.l).toBe("cafÉ");
      await alta(e, "CAFÉ");
      await sinConfirmar(async () => {
        clave(await altaConIntento(e, "café"), "sucursal_nombre_ci_uk");
        clave(await altaConIntento(e, "Café"), "sucursal_nombre_ci_uk");
        // Con la É en mayúscula, el índice de 0001 también lo ve (lower('CAFÉ') = lower('cafÉ') en C).
        const mitad = await altaConIntento(e, "cafÉ");
        expect(mitad.ok).toBe(false);
        if (!mitad.ok) {
          expect(mitad.codigo).toBe("23505");
          expect(["sucursal_nombre_uk", "sucursal_nombre_ci_uk"]).toContain(mitad.restriccion);
        }
        // El mismo nombre escrito con la É descompuesta (E + acento combinado): también es el mismo.
        clave(await altaConIntento(e, "CAFE\u0301"), "sucursal_nombre_ci_uk");
        // Un carácter invisible en el medio no hace otro nombre.
        clave(await altaConIntento(e, "CA\u200bFÉ"), "sucursal_nombre_ci_uk");
        // Un acento distinto, sí es otro nombre.
        filas(await altaConIntento(e, "cafe"), 1);
        filas(await altaConIntento(e, "Cafés"), 1);
      });
      // Con la misma letra de mayúscula y minúscula de ASCII, el índice de 0001 también lo ve.
      await alta(e, "Norte");
      await sinConfirmar(async () => {
        const r = await altaConIntento(e, "NORTE");
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.codigo).toBe("23505");
          expect(["sucursal_nombre_uk", "sucursal_nombre_ci_uk"]).toContain(r.restriccion);
        }
      });
      // Otra empresa puede usar el mismo nombre.
      const otra = await armar();
      await alta(otra, "CAFÉ");
    });

    it("el nombre tiene hasta 100 caracteres (no bytes) y ningún carácter de control", async () => {
      const e = await armar();
      await sinConfirmar(async () => {
        filas(await altaConIntento(e, "a".repeat(100)), 1);
        check(await altaConIntento(e, "b".repeat(101)), "sucursal_nombre_largo_ck");
        // Cien «ñ» son 200 bytes: se cuentan caracteres.
        filas(await altaConIntento(e, "ñ".repeat(100)), 1);
        check(await altaConIntento(e, "ñ".repeat(101)), "sucursal_nombre_largo_ck");
        for (const malo of [
          "uno\tdos",
          "uno\ndos",
          "uno\rdos",
          "uno\u0000dos".replace("\u0000", "\u0001"),
          "uno\u007fdos",
          "uno\u0085dos",
          "uno\u009fdos",
        ]) {
          check(await altaConIntento(e, malo), "sucursal_nombre_control_ck");
        }
        // Lo que no es de control entra: signos, acentos, el espacio ancho, emojis.
        for (const bueno of [
          "Local 1 - Centro",
          "Ñandú & Hijos",
          "Sucursal Nº 3",
          "Depósito\u00a0Sur",
          "Tienda 🏪",
        ]) {
          filas(await altaConIntento(e, bueno), 1);
        }
      });
    });

    it("la empresa nunca queda sin una sucursal activa: la última no se desactiva (ni sola ni en un UPDATE de todas)", async () => {
      const e = await armar();
      const [unica] = await sucursales(e);
      await sinConfirmar(async () => {
        check(
          await intento("update sucursal set activa = false where id = $1", [unica]),
          "sucursal_ultima_activa",
        );
      });
      const segunda = (
        await dueno.query<{ id: string }>(
          "insert into sucursal (empresa_id, nombre) values ($1, 'Norte') returning id",
          [e.empresa.empresa],
        )
      ).rows[0]?.id as string;
      const tercera = (
        await dueno.query<{ id: string }>(
          "insert into sucursal (empresa_id, nombre) values ($1, 'Sur') returning id",
          [e.empresa.empresa],
        )
      ).rows[0]?.id as string;
      await sinConfirmar(async () => {
        // De a una: las dos primeras sí, la última no.
        filas(await intento("update sucursal set activa = false where id = $1", [segunda]), 1);
        filas(await intento("update sucursal set activa = false where id = $1", [tercera]), 1);
        check(
          await intento("update sucursal set activa = false where id = $1", [unica]),
          "sucursal_ultima_activa",
        );
        // Desactivar una ya inactiva, cambiar el nombre y reactivar no tocan la regla.
        filas(await intento("update sucursal set activa = false where id = $1", [tercera]), 1);
        filas(
          await intento("update sucursal set nombre = 'Casa matriz' where id = $1", [unica]),
          1,
        );
        filas(await intento("update sucursal set activa = true where id = $1", [segunda]), 1);
      });
      // Un UPDATE de todas a la vez: falla al llegar a la última, y no se desactiva ninguna.
      await sinConfirmar(async () => {
        check(
          await intento("update sucursal set activa = false where empresa_id = $1", [
            e.empresa.empresa,
          ]),
          "sucursal_ultima_activa",
        );
      });
      expect(
        Number(
          (
            await consultar<{ n: string }>(
              "select count(*) as n from sucursal where empresa_id = $1 and activa",
              [e.empresa.empresa],
            )
          )[0]?.n,
        ),
      ).toBe(3);
    });

    it("con el rol de la aplicación pasa lo mismo, y la regla se cuenta por empresa", async () => {
      const e = await armar();
      const otra = await armar();
      const [unica] = await sucursales(e);
      await conApp(e, e.gerente, async (s) => {
        check(
          await s.intentar("update sucursal set activa = false where id = $1", [unica]),
          "sucursal_ultima_activa",
        );
        // Las sucursales de otra empresa no son «otras activas» de esta (ni se ven).
        filas(
          await s.intentar("update sucursal set activa = false where id = $1", [
            (await sucursales(otra))[0],
          ]),
          0,
        );
      });
      // Control positivo: con una segunda sucursal se puede.
      await alta(e, "Norte");
      await conApp(e, e.gerente, async (s) => {
        filas(await s.intentar("update sucursal set activa = false where id = $1", [unica]), 1);
      });
    });

    it("el bloqueo de la fila de empresa no está al alcance de la aplicación (por eso la regla usa un bloqueo consultivo)", async () => {
      const e = await armar();
      await conApp(e, e.gerente, async (s) => {
        // Bloquear la fila exige también pasar la política de UPDATE de empresa, que no hay para el
        // contexto operativo: no devuelve la fila (y ensancharla sería dar permisos que nadie pidió).
        filas(
          await s.intentar("select id from empresa where id = $1 for update", [e.empresa.empresa]),
          0,
        );
        filas(
          await s.intentar("select id from empresa where id = $1 for share", [e.empresa.empresa]),
          0,
        );
        // Leerla, sí.
        filas(await s.intentar("select id from empresa where id = $1", [e.empresa.empresa]), 1);
      });
    });

    it("el alta de una sucursal por el repositorio devuelve la existente aunque difiera en mayúsculas y acentos de forma (sin depender del locale)", async () => {
      const e = await armar();
      const r = await entorno.ejecutar(
        { contexto: comoPersona(e, e.gerente) },
        async ({ sucursales: repo }) => {
          const primera = await repo.crearSiNoExiste(e.empresa.empresa, "Depósito ÑANDÚ");
          const segunda = await repo.crearSiNoExiste(e.empresa.empresa, "depósito ñandú");
          return ok({ primera, segunda });
        },
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.primera.creada).toBe(true);
      expect(r.valor.segunda.creada).toBe(false);
      expect(r.valor.segunda.sucursal.id).toBe(r.valor.primera.sucursal.id);
      expect(r.valor.segunda.sucursal.nombre).toBe("Depósito ÑANDÚ");
    });
  });

  // ===============================================================================================
  // 7. Compatibilidad hacia atrás: 0005 sobre una base con datos de 0001 a 0004
  // ===============================================================================================
  describe("0005 sobre una base con datos de 0001 a 0004", () => {
    const REAL = join(import.meta.dirname, "../../migraciones");
    const TABLAS = [
      "tenant",
      "empresa",
      "sucursal",
      "persona",
      "membresia_tenant",
      "membresia",
      "asignacion_sucursal",
      "invitacion",
      "invitacion_empresa",
      "invitacion_sucursal",
      "trabajo",
      "auditoria_empresa",
      "auditoria_plataforma",
      "admin_plataforma",
      "referencia_de_error",
    ] as const;

    /** Una carpeta con solo estas migraciones (copiadas de la real). */
    const carpetaCon = async (archivos: readonly string[]): Promise<string> => {
      const carpeta = await mkdtemp(join(tmpdir(), "zuluhub-mig-0005-"));
      for (const archivo of archivos) await copyFile(join(REAL, archivo), join(carpeta, archivo));
      return carpeta;
    };
    const HASTA_0004 = [
      "0001_base.sql",
      "0002_identidad.sql",
      "0003_trabajos.sql",
      "0004_plataforma.sql",
    ] as const;

    /** Una base aparte con 0001 a 0004 aplicadas y la clave de contexto. */
    const baseConDatos = async (archivos: readonly string[] = HASTA_0004) => {
      if (base === null) throw new Error("sin base");
      const aparte = await crearBaseAparte(base, { migrar: false });
      const carpeta = await carpetaCon(archivos);
      await aplicarMigraciones(aparte.base.dueno, carpeta);
      await instalarClaveDeContexto(aparte.base.dueno, base.clave);
      if (archivos.includes("0004_plataforma.sql")) await sembrarAdminsDePrueba(aparte.base.dueno);
      const cliente = new pg.Client({ connectionString: aparte.base.dueno });
      await cliente.connect();
      return {
        aparte,
        cliente,
        carpeta,
        cerrar: async () => {
          await cliente.end().catch(() => undefined);
          await rm(carpeta, { recursive: true, force: true });
          await aparte.destruir();
        },
      };
    };

    const huella = async (c: pg.Client): Promise<Record<string, string>> => {
      const r: Record<string, string> = {};
      for (const tabla of TABLAS) {
        const { rows } = await c.query<{ h: string }>(
          `select coalesce(md5(string_agg(t::text, '|' order by t::text)), '-') as h from ${tabla} t`,
        );
        r[tabla] = rows[0]?.h as string;
      }
      return r;
    };

    /** Datos "reales" de una empresa: gerente, administrador, operadores (uno apagado), asignaciones, una invitación... */
    const sembrar = async (c: pg.Client) => {
      const un = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
        ((await c.query<T>(texto, p)).rows[0] ?? {}) as T;
      const tenant = (
        await un<{ id: string }>("insert into tenant (nombre) values ('previo') returning id")
      ).id;
      const empresa = (
        await un<{ id: string }>(
          `insert into empresa (tenant_id, cuit, razon_social, estado) values ($1, $2, 'previa', 'ACTIVE') returning id`,
          [tenant, cuitAlAzar()],
        )
      ).id;
      const sucursales: string[] = [];
      for (const nombre of ["Casa central", "Café", "Cafe", "Sucursal Ñandú"]) {
        sucursales.push(
          (
            await un<{ id: string }>(
              "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
              [empresa, nombre],
            )
          ).id,
        );
      }
      await c.query("update sucursal set activa = false where id = $1", [sucursales[3]]);
      const personas: string[] = [];
      for (const [rol, activo] of [
        ["GERENTE", true],
        ["ADMINISTRADOR", true],
        ["OPERADOR", true],
        ["OPERADOR", false],
      ] as const) {
        const p = await crearPersonaDeBase(c);
        await crearMembresiaDeBase(c, empresa, p.id, rol, activo);
        personas.push(p.id);
      }
      await crearAsignacionDeBase(c, empresa, personas[2] as string, sucursales[0] as string);
      await crearAsignacionDeBase(
        c,
        empresa,
        personas[2] as string,
        sucursales[1] as string,
        false,
      );
      const inv = await crearInvitacionDeBase(c, { tenant });
      await incluirEmpresa(c, inv, empresa, "OPERADOR", [sucursales[0] as string]);
      await c.query(
        `insert into auditoria_empresa (empresa_id, accion, entidad, entidad_id) values ($1, 'PRUEBA', 'x', 'y')`,
        [empresa],
      );
      await c.query(
        `insert into trabajo (empresa_id, tipo, clave_idempotencia) values ($1, 'mantenimiento', 'clave-previa')`,
        [empresa],
      );
      return { tenant, empresa, sucursales, personas, inv };
    };

    it(
      "no cambia ni un dato existente, lo que cada rol ve y escribe sigue igual, y lo nuevo funciona sobre esos datos",
      { timeout: 60_000 },
      async () => {
        if (base === null) return;
        const previa = await baseConDatos();
        try {
          const datos = await sembrar(previa.cliente);
          const antes = await huella(previa.cliente);
          // Solo hasta 0005: las migraciones posteriores (0006 fiscal) tienen sus propias pruebas.
          const hasta0005 = await carpetaCon([...HASTA_0004, "0005_administracion.sql"]);
          const r = await aplicarMigraciones(previa.aparte.base.dueno, hasta0005).finally(() =>
            rm(hasta0005, { recursive: true, force: true }),
          );
          expect(r.aplicadas).toEqual(["0005_administracion.sql"]);
          expect(await huella(previa.cliente)).toEqual(antes);

          const [gerente, admin, operador, apagado] = datos.personas as [
            string,
            string,
            string,
            string,
          ];
          const contexto = comoEmpresa(datos.empresa as never, personaId(gerente));
          // La aplicación sigue leyendo y escribiendo lo suyo.
          const app = await SesionDePrueba.abrir(previa.aparte.base, "zuluhub_app", contexto);
          try {
            filas(await app.intentar("select * from membresia"), 4);
            filas(await app.intentar("select * from sucursal"), 4);
            filas(await app.intentar("select * from asignacion_sucursal"), 2);
            filas(
              await app.intentar("update membresia set activo = false where persona_id = $1", [
                operador,
              ]),
              1,
            );
            filas(
              await app.intentar("update sucursal set nombre = 'Casa matriz' where id = $1", [
                datos.sucursales[0],
              ]),
              1,
            );
            filas(
              await app.intentar("insert into sucursal (empresa_id, nombre) values ($1, 'Norte')", [
                datos.empresa,
              ]),
              1,
            );
            // Las sucursales «Café» y «Cafe» que ya existían siguen ahí (son nombres distintos).
            filas(await app.intentar("select 1 from sucursal where nombre in ('Café', 'Cafe')"), 2);
          } finally {
            await app.cerrar();
          }
          // Los demás roles, igual que antes.
          const prop = await crearPropietarioEnBase(previa.cliente, datos.tenant);
          await conRolEn(
            previa.aparte.base,
            "zuluhub_grupo",
            comoGrupo(datos.tenant as never, personaId(prop)),
            async (s) => {
              filas(await s.intentar("select * from sucursal"), 4);
              denegado(await s.intentar("select * from membresia"));
              denegado(await s.intentar("select * from traspaso_gerencia"));
            },
          );
          await conRolEn(previa.aparte.base, "zuluhub_plataforma", comoPlataforma(), async (s) => {
            filas(await s.intentar("select * from empresa"), 1);
            denegado(await s.intentar("select * from sucursal"));
            filas(await s.intentar("select * from traspaso_gerencia"), 0);
          });

          // Y lo nuevo anda sobre esos datos: un traspaso de punta a punta.
          const propuesta = await SesionDePrueba.abrir(previa.aparte.base, "zuluhub_app", contexto);
          try {
            filas(
              await propuesta.intentar(
                `insert into traspaso_gerencia (empresa_id, origen, propuesto_por, saliente_persona_id,
                                                entrante_persona_id, propuesto_en, vence_en)
                 values ($1, 'GERENTE', $2, $2, $3, $4, $5)`,
                [datos.empresa, gerente, admin, PROPUESTO_EN, VENCE_EN],
              ),
              1,
            );
            expect((await propuesta.confirmar()).ok).toBe(true);
          } finally {
            await propuesta.cerrar();
          }
          const acepta = await SesionDePrueba.abrir(
            previa.aparte.base,
            "zuluhub_app",
            comoEmpresa(datos.empresa as never, personaId(admin)),
          );
          try {
            filas(
              await acepta.directo(
                "update traspaso_gerencia set estado = 'ACEPTADO', resuelto_en = $1 where empresa_id = $2",
                [PROPUESTO_EN, datos.empresa],
              ),
              1,
            );
            filas(
              await acepta.directo(
                "update membresia set rol = 'ADMINISTRADOR' where persona_id = $1",
                [gerente],
              ),
              1,
            );
            filas(
              await acepta.directo("update membresia set rol = 'GERENTE' where persona_id = $1", [
                admin,
              ]),
              1,
            );
            expect((await acepta.confirmar()).ok).toBe(true);
          } finally {
            await acepta.cerrar();
          }
          const { rows } = await previa.cliente.query<{ persona_id: string }>(
            "select persona_id from membresia where empresa_id = $1 and rol = 'GERENTE' and activo",
            [datos.empresa],
          );
          expect(rows.map((f) => f.persona_id)).toEqual([admin]);
          expect(apagado).toBeTruthy();
        } finally {
          await previa.cerrar();
        }
      },
    );

    it(
      "se frena ANTES de tocar nada, con un mensaje claro, si hay nombres de más de 100 caracteres, con caracteres de control o repetidos salvo mayúsculas",
      { timeout: 60_000 },
      async () => {
        if (base === null) return;
        const casos: [string, string[], RegExp][] = [
          [
            "un nombre de 101 caracteres",
            ["a".repeat(101)],
            /1 sucursales con un nombre de más de 100 caracteres/,
          ],
          ["un nombre con un tabulador", ["uno\tdos"], /1 sucursales con caracteres de control/],
          [
            "«CAFÉ» y «café» en la misma empresa",
            ["CAFÉ", "café"],
            /1 pares de sucursales .* mismo nombre salvo mayúsculas/,
          ],
        ];
        for (const [que, nombres, mensaje] of casos) {
          const previa = await baseConDatos();
          try {
            const datos = await sembrar(previa.cliente);
            // Se borra el «Café» y «Cafe» sembrados (no entran en los casos) y se arma el caso.
            await previa.cliente.query("delete from asignacion_sucursal where empresa_id = $1", [
              datos.empresa,
            ]);
            await previa.cliente.query("delete from invitacion_sucursal where empresa_id = $1", [
              datos.empresa,
            ]);
            await previa.cliente.query("delete from sucursal where nombre in ('Café', 'Cafe')");
            for (const nombre of nombres) {
              await previa.cliente.query(
                "insert into sucursal (empresa_id, nombre) values ($1, $2)",
                [datos.empresa, nombre],
              );
            }
            const antes = await huella(previa.cliente);
            await expect(aplicarMigraciones(previa.aparte.base.dueno, REAL), que).rejects.toThrow(
              mensaje,
            );
            expect(await huella(previa.cliente), que).toEqual(antes);
            const { rows } = await previa.cliente.query<{ nombre: string }>(
              "select nombre from migracion order by 1",
            );
            expect(rows.map((f) => f.nombre)).toEqual(HASTA_0004);
            expect(
              (await previa.cliente.query("select to_regclass('public.traspaso_gerencia') as t"))
                .rows[0],
            ).toEqual({ t: null });
            expect(
              (
                await previa.cliente.query(
                  "select 1 from pg_collation where collname = 'sucursal_nombre_ci'",
                )
              ).rowCount,
            ).toBe(0);
          } finally {
            await previa.cerrar();
          }
        }
      },
    );

    it(
      "se frena si falta 0004 (la plataforma no tendría el actor firmado) o si la base no es UTF8",
      { timeout: 60_000 },
      async () => {
        if (base === null) return;
        // Sin 0004: se aplican 0001 a 0003 y después 0005 sola.
        const sinCuarta = await baseConDatos([
          "0001_base.sql",
          "0002_identidad.sql",
          "0003_trabajos.sql",
        ]);
        try {
          const carpeta = await carpetaCon([
            "0001_base.sql",
            "0002_identidad.sql",
            "0003_trabajos.sql",
            "0005_administracion.sql",
          ]);
          try {
            await expect(aplicarMigraciones(sinCuarta.aparte.base.dueno, carpeta)).rejects.toThrow(
              /0005 necesita 0004_plataforma aplicada antes/,
            );
          } finally {
            await rm(carpeta, { recursive: true, force: true });
          }
        } finally {
          await sinCuarta.cerrar();
        }
        // Una base SQL_ASCII (la codificación por defecto de algunos servidores locales).
        const admin = new pg.Client({ connectionString: base.admin });
        await admin.connect();
        const nombre = `zuluhub_it_ascii_${Date.now().toString(36)}`;
        try {
          await admin.query(
            `CREATE DATABASE ${nombre} TEMPLATE template0 ENCODING 'SQL_ASCII' LC_COLLATE 'C' LC_CTYPE 'C'`,
          );
          const url = new URL(base.dueno);
          url.pathname = `/${nombre}`;
          await expect(aplicarMigraciones(url.toString(), REAL)).rejects.toThrow(
            /necesita una base UTF8/,
          );
        } finally {
          await admin.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
          await admin.end();
        }
      },
    );

    it("el archivo de 0005 sigue siendo el que se probó (el historial no se reescribe)", async () => {
      const sql = await readFile(join(REAL, "0005_administracion.sql"), "utf8");
      expect(sql).toContain("CREATE TABLE traspaso_gerencia");
      expect(sql.length).toBeGreaterThan(5000);
    });
  });

  // ---- apoyo de la compatibilidad (sobre otra base) ------------------------------------------------

  const crearPropietarioEnBase = async (c: pg.Client, tenant: string): Promise<string> => {
    const p = await crearPersonaDeBase(c);
    await c.query(
      "insert into membresia_tenant (persona_id, tenant_id, rol) values ($1, $2, 'PROPIETARIO')",
      [p.id, tenant],
    );
    return p.id;
  };
  const conRolEn = async <T>(
    b: NonNullable<typeof base>,
    rol: "zuluhub_app" | "zuluhub_grupo" | "zuluhub_trabajos" | "zuluhub_plataforma",
    contexto: Contexto | null,
    trabajo: (s: SesionDePrueba) => Promise<T>,
  ): Promise<T> => {
    const s = await SesionDePrueba.abrir(b, rol, contexto);
    try {
      return await trabajo(s);
    } finally {
      await s.cerrar();
    }
  };
});
