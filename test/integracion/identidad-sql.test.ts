import { randomUUID } from "node:crypto";
import { sql, type RawBuilder } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Contexto } from "../../src/contexto/contexto";
import {
  emailDesdeTexto,
  TRANSICIONES_DE_INVITACION,
  type EstadoGuardado,
} from "../../src/modulos/identidad/publico";
import {
  COLUMNAS_DE_IDENTIDAD,
  ERRORES_DE_IDENTIDAD_POR_RESTRICCION,
} from "../../src/modulos/identidad/persistencia/esquema";
import { ok } from "../../src/primitivas/resultado/resultado";
import {
  AHORA_DE_PRUEBA,
  comoEmpresa,
  comoGrupo,
  comoInvitacion,
  comoPlataforma,
  comoTrabajos,
  crearEmpresaActiva,
  crearEmpresaEnAlta,
  crearEntornoDePrueba,
  crearPropietario,
  type EmpresaDePrueba,
} from "./entorno";
import {
  EMITIDA_EN,
  VENCE_EN,
  aceptarDeBase,
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  emailAlAzar,
  hashDeToken,
  incluirEmpresa,
  revocarDeBase,
  sucursalDe,
  tokenAlAzar,
  type InvitacionDePrueba,
  type RolDePrueba,
} from "./fixtures-identidad";

/**
 * H3, tramo 1: la migración 0002 (membresías, asignaciones, invitaciones) contra una base real.
 * Cuatro bloques: el catálogo (lo que la base DECLARA), las restricciones (lo que la base IMPIDE aun
 * al dueño), la máquina de estados de la invitación, y el aislamiento por contexto firmado (lo que
 * cada rol limitado ve y escribe, incluido el contexto de INVITACION).
 */

const base = inject("baseDePruebas");

type Entorno = ReturnType<typeof crearEntornoDePrueba>;
type Fila = Record<string, unknown>;

const DENEGADO = { ok: false, error: { tipo: "AccesoDenegado" } } as const;
const unicidad = (restriccion: string) =>
  ({ ok: false, error: { tipo: "Unicidad", restriccion } }) as const;

const TABLAS_NUEVAS = [
  "membresia",
  "asignacion_sucursal",
  "invitacion",
  "invitacion_empresa",
  "invitacion_sucursal",
] as const;
const ROLES = ["zuluhub_app", "zuluhub_grupo", "zuluhub_trabajos", "zuluhub_plataforma"] as const;

/** Una columna cualquiera de cada tabla, para probar que un rol sin permiso no puede actualizarla. */
const COLUMNA_CUALQUIERA: Readonly<Record<(typeof TABLAS_NUEVAS)[number], string>> = {
  membresia: "activo",
  asignacion_sucursal: "activa",
  invitacion: "estado",
  invitacion_empresa: "rol",
  invitacion_sucursal: "empresa_id",
};

/**
 * Restricciones que lanzan los disparadores (no están en el catálogo), por la función que las lanza:
 * 0002 (invitación) y 0005 (traspaso y membresía).
 */
const DISPARADORES_DE_IDENTIDAD: Readonly<Record<string, readonly string[]>> = {
  invitacion_validar_cambio: [
    "invitacion_transicion_invalida",
    "invitacion_inmutable",
    "invitacion_resuelta_inmutable",
  ],
  membresia_validar_cambio: ["membresia_gerente_no_se_apaga", "membresia_rol_sin_traspaso"],
  traspaso_gerencia_validar_alta: [
    "traspaso_entrante_inactivo",
    "traspaso_entrante_es_el_gerente",
    "traspaso_saliente_no_es_gerente",
  ],
  traspaso_gerencia_validar_cambio: [
    "traspaso_gerencia_inmutable",
    "traspaso_gerencia_resuelto_inmutable",
    "traspaso_gerencia_transicion_invalida",
    "traspaso_saliente_no_es_gerente",
    "traspaso_entrante_inactivo",
    "traspaso_entrante_es_el_gerente",
    "traspaso_cancela_sin_permiso",
  ],
  traspaso_gerencia_verificar_aceptado: ["traspaso_aceptado_incompleto"],
};
const RESTRICCIONES_DE_DISPARADORES_DE_IDENTIDAD = [
  ...new Set(Object.values(DISPARADORES_DE_IDENTIDAD).flat()),
];

describe.skipIf(base === null)("identidad: la migración 0002 contra una base real", () => {
  let entorno: Entorno;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    entorno = crearEntornoDePrueba(base);
    dueno = new pg.Client({ connectionString: base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
  });

  const filas = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;

  // ---- utilidades de contexto firmado -------------------------------------------------------

  /** Lee con un contexto firmado; si la base rechaza la consulta, la prueba falla con el motivo. */
  const leer = async (contexto: Contexto, consulta: RawBuilder<Fila>): Promise<Fila[]> => {
    const r = await entorno.ejecutar({ contexto }, async ({ db }) =>
      ok((await consulta.execute(db)).rows),
    );
    if (!r.ok) throw new Error(`falló la lectura: ${JSON.stringify(r.error)}`);
    return r.valor;
  };
  const leerUna = async (contexto: Contexto, columna: string, consulta: RawBuilder<Fila>) =>
    (await leer(contexto, consulta)).map((f) => f[columna]);

  /** Escribe con un contexto firmado y devuelve ok(filas afectadas) o el error de persistencia. */
  const escribir = (contexto: Contexto, consulta: RawBuilder<unknown>) =>
    entorno.ejecutar({ contexto }, async ({ db }) => {
      const r = await consulta.execute(db);
      return ok(Number(r.numAffectedRows ?? 0));
    });

  const contar = async (contexto: Contexto, tabla: string): Promise<number> => {
    const r = await entorno.ejecutar({ contexto }, async ({ db }) => {
      const { rows } = await sql<{
        n: number;
      }>`select count(*)::int as n from ${sql.table(tabla)}`.execute(db);
      return ok(rows[0]?.n ?? -1);
    });
    if (!r.ok) throw new Error(`no se pudo contar ${tabla}: ${JSON.stringify(r.error)}`);
    return r.valor;
  };

  // ---- escenarios -----------------------------------------------------------------------------

  /** Una invitación de usuario a una empresa (con su sucursal), emitida por el dueño de la base. */
  const invitarUsuario = async (
    empresa: EmpresaDePrueba,
    rol: RolDePrueba = "OPERADOR",
    conSucursal = true,
  ) => {
    const inv = await crearInvitacionDeBase(dueno, { tenant: empresa.tenant });
    const sucursal = await sucursalDe(dueno, empresa.empresa);
    await incluirEmpresa(dueno, inv, empresa.empresa, rol, conSucursal ? [sucursal] : []);
    return { inv, sucursal };
  };

  /** Una empresa en alta con la invitación al gerente ya emitida. */
  const invitarGerente = async () => {
    const empresa = await crearEmpresaEnAlta(entorno);
    const inv = await crearInvitacionDeBase(dueno, {
      tenant: empresa.tenant,
      tipo: "ALTA_GERENTE",
    });
    await incluirEmpresa(dueno, inv, empresa.empresa, "GERENTE");
    return { empresa, inv };
  };

  /** El primer paso de quien acepta: da de alta su persona y marca la invitación como aceptada. */
  const aceptarComoInvitado = async (
    inv: InvitacionDePrueba,
    aceptadaEn: Date = AHORA_DE_PRUEBA,
  ): Promise<string> => {
    const r = await entorno.ejecutar(
      { contexto: comoInvitacion(inv.tokenHash) },
      async ({ db }) => {
        const { rows } = await sql<{ id: string }>`
        insert into persona (email) values (${inv.email}) returning id`.execute(db);
        const persona = rows[0]?.id as string;
        const res = await sql`
        update invitacion set estado = 'ACEPTADA', aceptada_por = ${persona}, aceptada_en = ${aceptadaEn}
        where token_hash = ${inv.tokenHash} and estado = 'PENDIENTE'`.execute(db);
        if (Number(res.numAffectedRows) !== 1) throw new Error("no se pudo aceptar la invitación");
        return ok(persona);
      },
    );
    if (!r.ok) throw new Error(`no se pudo aceptar: ${JSON.stringify(r.error)}`);
    return r.valor;
  };

  const altaDeMembresia = (
    inv: InvitacionDePrueba,
    empresa: string,
    persona: string,
    rol: string,
  ) =>
    escribir(
      comoInvitacion(inv.tokenHash),
      sql`insert into membresia (empresa_id, persona_id, rol, invitacion_id)
          values (${empresa}, ${persona}, ${rol}, ${inv.id})`,
    );

  // =============================================================================================
  // 1. Catálogo
  // =============================================================================================
  describe("catálogo", () => {
    it("las columnas de cada tabla coinciden con COLUMNAS_DE_IDENTIDAD", async () => {
      for (const [tabla, esperadas] of Object.entries(COLUMNAS_DE_IDENTIDAD)) {
        const reales = (
          await filas<{ column_name: string }>(
            `select column_name from information_schema.columns
             where table_schema = 'public' and table_name = $1 order by ordinal_position`,
            [tabla],
          )
        ).map((c) => c.column_name);
        expect(reales, tabla).toEqual([...esperadas]);
      }
    });

    it("toda restricción de las tablas de identidad tiene su traducción declarada, y no sobra ninguna", async () => {
      const tablas = ["persona", ...TABLAS_NUEVAS, "traspaso_gerencia"];
      const reales = await filas<{ nombre: string }>(
        `select conname as nombre from pg_constraint
         where conrelid = any($1::text[]::regclass[]) and contype in ('p', 'u', 'c', 'f', 'x')
         union
         select indexname as nombre from pg_indexes
         where schemaname = 'public' and tablename = any($1)
           and indexdef like 'CREATE UNIQUE INDEX%' and indexname not like '%pkey' and indexname not like '%_key'`,
        [tablas],
      );
      const existentes = new Set(reales.map((r) => r.nombre));
      const declaradas = new Set(Object.keys(ERRORES_DE_IDENTIDAD_POR_RESTRICCION));
      expect([...existentes].filter((n) => !declaradas.has(n)).sort(), "sin traducción").toEqual(
        [],
      );
      expect(
        [...declaradas].filter(
          (n) => !existentes.has(n) && !RESTRICCIONES_DE_DISPARADORES_DE_IDENTIDAD.includes(n),
        ),
        "traducciones de restricciones que no existen",
      ).toEqual([]);
      // Las restricciones de los disparadores existen de verdad: figuran en el cuerpo de la función
      // que las lanza (y cada nombre de la lista figura en alguna).
      for (const [funcion, nombres] of Object.entries(DISPARADORES_DE_IDENTIDAD)) {
        const { rows } = await dueno.query<{ cuerpo: string }>(
          `select pg_get_functiondef($1::regproc) as cuerpo`,
          [`public.${funcion}`],
        );
        for (const nombre of nombres) {
          expect(rows[0]?.cuerpo, `${funcion}: ${nombre}`).toContain(`'${nombre}'`);
        }
      }
    });

    it("RLS activo y forzado en las tablas nuevas, y las que tienen empresa_id apuntan a empresa", async () => {
      const tablas = await filas<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `select relname, relrowsecurity, relforcerowsecurity from pg_class
         where relnamespace = 'public'::regnamespace and relname = any($1) order by 1`,
        [[...TABLAS_NUEVAS]],
      );
      expect(tablas.map((t) => t.relname)).toEqual([...TABLAS_NUEVAS].sort());
      for (const t of tablas) {
        expect(t.relrowsecurity, `${t.relname}: RLS activo`).toBe(true);
        expect(t.relforcerowsecurity, `${t.relname}: RLS forzado`).toBe(true);
      }
      const sinFk = await filas<{ tabla: string }>(
        `select c.table_name as tabla from information_schema.columns c
         where c.table_schema = 'public' and c.column_name = 'empresa_id' and c.table_name = any($1)
           and not exists (
             select 1 from pg_constraint k
             where k.conrelid = format('public.%I', c.table_name)::regclass
               and k.contype = 'f' and k.confrelid = 'public.empresa'::regclass)`,
        [[...TABLAS_NUEVAS]],
      );
      expect(sinFk).toEqual([]);
    });

    it("las políticas de las tablas nuevas son exactamente estas: ninguna de más (una política abierta sumaría acceso)", async () => {
      const politicas = await filas<{ p: string }>(
        `select format('%s.%s:%s:%s', tablename, policyname, cmd, array_to_string(roles, '+')) as p
         from pg_policies
         where schemaname = 'public'
           and (tablename = any($1)
                or policyname ~ '(_invitado_|persona_miembros_app)')
         order by 1`,
        [[...TABLAS_NUEVAS]],
      );
      expect(politicas.map((f) => f.p)).toEqual(
        [
          "asignacion_sucursal.asignacion_sucursal_app_alta:INSERT:zuluhub_app", // 0005
          "asignacion_sucursal.asignacion_sucursal_app_apagar:UPDATE:zuluhub_app",
          "asignacion_sucursal.asignacion_sucursal_app_leer:SELECT:zuluhub_app",
          "asignacion_sucursal.asignacion_sucursal_app_reactivar:UPDATE:zuluhub_app", // 0005
          "asignacion_sucursal.asignacion_sucursal_invitado_alta:INSERT:zuluhub_app",
          "asignacion_sucursal.asignacion_sucursal_invitado_leer:SELECT:zuluhub_app",
          "asignacion_sucursal.asignacion_sucursal_invitado_reactivar:UPDATE:zuluhub_app",
          "auditoria_empresa.auditoria_empresa_invitado_alta:INSERT:zuluhub_app",
          "empresa.empresa_invitado_activar:UPDATE:zuluhub_app",
          "empresa.empresa_invitado_leer:SELECT:zuluhub_app",
          "invitacion.invitacion_app_alta:INSERT:zuluhub_app",
          "invitacion.invitacion_app_leer:SELECT:zuluhub_app",
          "invitacion.invitacion_app_revocar:UPDATE:zuluhub_app",
          "invitacion.invitacion_invitado_aceptar:UPDATE:zuluhub_app",
          "invitacion.invitacion_invitado_leer:SELECT:zuluhub_app",
          "invitacion.invitacion_plataforma_alta:INSERT:zuluhub_plataforma",
          "invitacion.invitacion_plataforma_cambiar:UPDATE:zuluhub_plataforma",
          "invitacion.invitacion_plataforma_con_actor:SELECT:zuluhub_plataforma",
          "invitacion.invitacion_plataforma_leer:SELECT:zuluhub_plataforma",
          "invitacion.invitacion_plataforma_quien_cambia:UPDATE:zuluhub_plataforma",
          "invitacion.invitacion_plataforma_quien_emite:INSERT:zuluhub_plataforma",
          "invitacion_empresa.invitacion_empresa_app_alta:INSERT:zuluhub_app",
          "invitacion_empresa.invitacion_empresa_app_leer:SELECT:zuluhub_app",
          "invitacion_empresa.invitacion_empresa_invitado_leer:SELECT:zuluhub_app",
          "invitacion_empresa.invitacion_empresa_plataforma_alta:INSERT:zuluhub_plataforma",
          "invitacion_empresa.invitacion_empresa_plataforma_con_actor:SELECT:zuluhub_plataforma",
          "invitacion_empresa.invitacion_empresa_plataforma_leer:SELECT:zuluhub_plataforma",
          "invitacion_empresa.invitacion_empresa_plataforma_quien_emite:INSERT:zuluhub_plataforma",
          "invitacion_sucursal.invitacion_sucursal_app_alta:INSERT:zuluhub_app",
          "invitacion_sucursal.invitacion_sucursal_app_leer:SELECT:zuluhub_app",
          "invitacion_sucursal.invitacion_sucursal_invitado_leer:SELECT:zuluhub_app",
          "membresia.membresia_app_apagar:UPDATE:zuluhub_app",
          "membresia.membresia_app_leer:SELECT:zuluhub_app",
          "membresia.membresia_app_traspasar:UPDATE:zuluhub_app", // 0005
          "membresia.membresia_invitado_alta:INSERT:zuluhub_app",
          "membresia.membresia_invitado_leer:SELECT:zuluhub_app",
          "membresia.membresia_invitado_reactivar:UPDATE:zuluhub_app",
          "membresia.membresia_plataforma_con_actor:SELECT:zuluhub_plataforma",
          "membresia.membresia_plataforma_leer:SELECT:zuluhub_plataforma",
          "persona.persona_invitado_alta:INSERT:zuluhub_app",
          "persona.persona_invitado_leer:SELECT:zuluhub_app",
          "persona.persona_miembros_app:SELECT:zuluhub_app",
          "referencia_de_error.referencia_de_error_invitado_alta:INSERT:zuluhub_app",
          "tenant.tenant_invitado_leer:SELECT:zuluhub_app",
        ].sort(),
      );
    });

    it("toda política de alta o cambio del contexto OPERATIVO sobre las tablas nuevas exige empresa_operable y nombra a la empresa del contexto en su WITH CHECK", async () => {
      const politicas = await filas<{
        tablename: string;
        policyname: string;
        qual: string | null;
        with_check: string | null;
      }>(
        `select tablename, policyname, qual, with_check from pg_policies
         where schemaname = 'public' and tablename = any($1) and 'zuluhub_app' = any(roles)
           and cmd in ('INSERT', 'UPDATE', 'ALL') and policyname not like '%\\_invitado\\_%'
         order by 1, 2`,
        [[...TABLAS_NUEVAS]],
      );
      expect(politicas.map((p) => p.policyname)).toEqual([
        "asignacion_sucursal_app_alta", // 0005
        "asignacion_sucursal_app_apagar",
        "asignacion_sucursal_app_reactivar", // 0005
        "invitacion_app_alta",
        "invitacion_app_revocar",
        "invitacion_empresa_app_alta",
        "invitacion_sucursal_app_alta",
        "membresia_app_apagar",
        "membresia_app_traspasar", // 0005
      ]);
      for (const p of politicas) {
        // El WITH CHECK de las políticas permisivas se suma (OR) entre todas las de la tabla: si
        // una no nombra su contexto, deja pasar la fila de cualquier otro contexto.
        expect(p.with_check, `${p.policyname}: WITH CHECK`).toContain("app_empresa_id()");
        expect(p.with_check, `${p.policyname}: WITH CHECK`).toContain("empresa_operable(");
        expect(`${p.qual ?? ""} ${p.with_check ?? ""}`, p.policyname).toContain(
          "empresa_operable(",
        );
      }
    });

    it("toda política de alta o cambio del contexto de INVITACION exige la aceptación y la empresa en condiciones", async () => {
      const politicas = await filas<{ tablename: string; policyname: string; chequeo: string }>(
        `select tablename, policyname, coalesce(with_check, qual, '') as chequeo from pg_policies
         where schemaname = 'public' and policyname like '%\\_invitado\\_%'
           and cmd in ('INSERT', 'UPDATE') and tablename in ('membresia', 'asignacion_sucursal', 'auditoria_empresa')
         order by 1, 2`,
      );
      expect(politicas.length).toBe(5);
      for (const p of politicas) {
        expect(p.chequeo, p.policyname).toContain("invitacion_aceptada_en(");
        expect(p.chequeo, p.policyname).toMatch(/invitacion_opera_en\(|empresa_operable\(/);
        expect(p.chequeo, p.policyname).toContain("app_token_invitacion()");
      }
    });

    it("las políticas evalúan el contexto una sola vez por sentencia: (SELECT app_*()), nunca la función suelta", async () => {
      const todas = await filas<{ policyname: string; texto: string }>(
        `select policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as texto
         from pg_policies
         where schemaname = 'public' and (tablename = any($1) or policyname ~ '(_invitado_|persona_miembros_app)')`,
        [[...TABLAS_NUEVAS]],
      );
      expect(todas.length).toBeGreaterThan(20);
      for (const p of todas) {
        const total = (
          p.texto.match(/app_(empresa_id|token_invitacion|persona_id|tenant_id)\(\)/g) ?? []
        ).length;
        const conSelect = (
          p.texto.match(/SELECT app_(empresa_id|token_invitacion|persona_id|tenant_id)\(\)/g) ?? []
        ).length;
        expect(conSelect, p.policyname).toBe(total);
      }
    });

    it("las funciones nuevas: search_path fijo, sin SECURITY DEFINER y EXECUTE solo para la aplicación (las de apoyo)", async () => {
      const funciones = await filas<{
        proname: string;
        prosecdef: boolean;
        proconfig: string[] | null;
      }>(
        `select proname, prosecdef, proconfig from pg_proc
         where pronamespace = 'public'::regnamespace
           and proname in ('invitacion_validar_cambio', 'invitacion_aceptada_en', 'invitacion_opera_en')
         order by 1`,
      );
      expect(funciones.map((f) => f.proname)).toEqual([
        "invitacion_aceptada_en",
        "invitacion_opera_en",
        "invitacion_validar_cambio",
      ]);
      for (const f of funciones) {
        expect(f.prosecdef, f.proname).toBe(false);
        expect(f.proconfig, f.proname).toContain("search_path=pg_catalog, public, pg_temp");
      }
      for (const [firma, esperado] of [
        ["invitacion_aceptada_en(text, uuid, uuid, text)", { app: true, otros: false }],
        ["invitacion_opera_en(text, uuid)", { app: true, otros: false }],
        ["invitacion_validar_cambio()", { app: false, otros: false }],
      ] as const) {
        for (const rol of ROLES) {
          const { rows } = await dueno.query<{ puede: boolean }>(
            `select has_function_privilege($1, $2::regprocedure, 'EXECUTE') as puede`,
            [rol, `public.${firma}`],
          );
          expect(rows[0]?.puede, `${rol} ejecuta ${firma}`).toBe(
            rol === "zuluhub_app" ? esperado.app : esperado.otros,
          );
        }
      }
    });

    it("las migraciones no agregaron claves ni contraseñas: la tabla de claves de contexto sigue cerrada", async () => {
      const abiertos = await filas(
        `select 1 from information_schema.table_privileges
         where table_schema = 'public' and table_name = 'contexto_clave' and grantee = any($1)`,
        [[...ROLES]],
      );
      expect(abiertos).toEqual([]);
    });

    it("el disparador de la invitación permite exactamente las transiciones del dominio", async () => {
      const estados: EstadoGuardado[] = ["PENDIENTE", "ACEPTADA", "REVOCADA"];
      const { tenant, empresa } = await crearEmpresaActiva(entorno);
      for (const desde of estados) {
        for (const hacia of estados) {
          if (desde === hacia) continue;
          const persona = await crearPersonaDeBase(dueno);
          const inv = await crearInvitacionDeBase(dueno, { tenant, email: persona.email });
          await incluirEmpresa(dueno, inv, empresa);
          if (desde === "ACEPTADA") await aceptarDeBase(dueno, inv, persona.id);
          if (desde === "REVOCADA") await revocarDeBase(dueno, inv);
          let permitida = true;
          try {
            await dueno.query(
              `update invitacion set estado = $2, aceptada_por = $3, aceptada_en = $4,
                 revocada_en = $5, motivo_revocacion = $6 where id = $1`,
              [
                inv.id,
                hacia,
                hacia === "ACEPTADA" ? persona.id : null,
                hacia === "ACEPTADA" ? AHORA_DE_PRUEBA : null,
                hacia === "REVOCADA" ? AHORA_DE_PRUEBA : null,
                hacia === "REVOCADA" ? "prueba" : null,
              ],
            );
          } catch (error) {
            expect(error, `${desde} → ${hacia}`).toMatchObject({
              code: "23514",
              constraint: "invitacion_transicion_invalida",
            });
            permitida = false;
          }
          expect(permitida, `${desde} → ${hacia}`).toBe(
            TRANSICIONES_DE_INVITACION[desde].includes(hacia),
          );
        }
      }
    });

    it("la regla de email de TypeScript y el CHECK de la base coinciden (la base nunca acepta lo que TypeScript rechaza)", async () => {
      const candidatos = [
        "ana@x.com",
        "  Ana@X.com ",
        "a@b",
        "@b",
        "a@",
        "@",
        "@@",
        "@a@",
        "sinarroba",
        "a@@b",
        "a@b@c",
        "ñandú@café.com.ar",
        "A@B.COM",
        "",
        " ",
        "a b@c.com",
        "a@b c.com",
        "\ta@b.com\t",
        "a@b.com\n",
      ];
      for (const texto of candidatos) {
        const ts = emailDesdeTexto(texto);
        const normalizado = texto.trim().toLowerCase();
        for (const tabla of ["persona", "invitacion"] as const) {
          // Se prueba el CHECK real: se inserta (en una transacción que se deshace) lo normalizado.
          await dueno.query("begin");
          let acepta = true;
          try {
            if (tabla === "persona") {
              await dueno.query("insert into persona (email) values ($1)", [normalizado]);
            } else {
              const { rows: t } = await dueno.query<{ id: string }>(
                "insert into tenant (nombre) values ('email') returning id",
              );
              await dueno.query(
                `insert into invitacion (id, tenant_id, tipo, email, token_hash, emitida_en, vence_en)
                 values ($1, $2, 'USUARIO', $3, $4, $5, $6)`,
                [
                  randomUUID(),
                  t[0]?.id,
                  normalizado,
                  tokenAlAzar().tokenHash,
                  EMITIDA_EN,
                  VENCE_EN,
                ],
              );
            }
          } catch (error) {
            expect(error).toMatchObject({ code: "23514" });
            acepta = false;
          } finally {
            await dueno.query("rollback");
          }
          if (ts.ok) {
            expect(acepta, `${tabla}: ${JSON.stringify(texto)} es válido para TypeScript`).toBe(
              true,
            );
            expect(ts.valor).toBe(normalizado);
          } else if (!/\s/.test(normalizado)) {
            // Sin blancos internos, las dos reglas rechazan lo mismo. (Con blancos internos,
            // TypeScript es más estricto a propósito.)
            expect(acepta, `${tabla}: ${JSON.stringify(texto)} es inválido para TypeScript`).toBe(
              false,
            );
          }
        }
      }
      // Y el CHECK de la invitación es el mismo texto que el de la persona.
      const defs = await filas<{ conname: string; def: string }>(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint
         where conname in ('persona_email_ck', 'invitacion_email_ck')`,
      );
      expect(new Set(defs.map((d) => d.def)).size).toBe(1);
    });
  });

  // =============================================================================================
  // 2. Restricciones: lo que la base impide, aun al dueño
  // =============================================================================================
  describe("restricciones", () => {
    const falla = (consulta: Promise<unknown>, code: string, constraint?: string) =>
      expect(consulta).rejects.toMatchObject(
        constraint === undefined ? { code } : { code, constraint },
      );

    let empresa: EmpresaDePrueba;
    let otra: EmpresaDePrueba; // de otro tenant
    beforeAll(async () => {
      if (base === null) return;
      empresa = await crearEmpresaActiva(entorno);
      otra = await crearEmpresaActiva(entorno);
    });

    describe("membresía y asignación", () => {
      it("asignar una sucursal a quien no es miembro de la empresa se rechaza (R2)", async () => {
        const persona = await crearPersonaDeBase(dueno);
        const sucursal = await sucursalDe(dueno, empresa.empresa);
        await falla(
          dueno.query(
            "insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id) values ($1, $2, $3)",
            [empresa.empresa, persona.id, sucursal],
          ),
          "23503",
          "asignacion_sucursal_membresia_fkey",
        );
      });

      it("ser miembro de OTRA empresa tampoco habilita asignar sucursales de esta", async () => {
        const persona = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, otra.empresa, persona.id);
        await falla(
          dueno.query(
            "insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id) values ($1, $2, $3)",
            [empresa.empresa, persona.id, await sucursalDe(dueno, empresa.empresa)],
          ),
          "23503",
          "asignacion_sucursal_membresia_fkey",
        );
      });

      it("asignar una sucursal de otra empresa se rechaza", async () => {
        const persona = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, empresa.empresa, persona.id);
        await falla(
          dueno.query(
            "insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id) values ($1, $2, $3)",
            [empresa.empresa, persona.id, await sucursalDe(dueno, otra.empresa)],
          ),
          "23503",
          "asignacion_sucursal_sucursal_fkey",
        );
      });

      it("una asignación válida entra, y repetirla choca con la clave", async () => {
        const persona = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, empresa.empresa, persona.id);
        const sucursal = await sucursalDe(dueno, empresa.empresa);
        const alta = () =>
          dueno.query(
            "insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id) values ($1, $2, $3)",
            [empresa.empresa, persona.id, sucursal],
          );
        await alta();
        await falla(alta(), "23505", "asignacion_sucursal_pkey");
      });

      it("dos gerentes activos en una empresa se rechazan; uno apagado no cuenta", async () => {
        const e = await crearEmpresaActiva(entorno);
        const p1 = await crearPersonaDeBase(dueno);
        const p2 = await crearPersonaDeBase(dueno);
        const p3 = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, e.empresa, p1.id, "GERENTE", false);
        await crearMembresiaDeBase(dueno, e.empresa, p2.id, "GERENTE");
        await falla(
          crearMembresiaDeBase(dueno, e.empresa, p3.id, "GERENTE"),
          "23505",
          "membresia_gerente_uk",
        );
        // Reactivar al apagado tampoco se puede mientras haya otro gerente activo.
        await falla(
          dueno.query(
            "update membresia set activo = true where empresa_id = $1 and persona_id = $2",
            [e.empresa, p1.id],
          ),
          "23505",
          "membresia_gerente_uk",
        );
        // En otra empresa, otro gerente sí puede.
        await crearMembresiaDeBase(dueno, otra.empresa, p3.id, "GERENTE");
      });

      it("una persona tiene una sola membresía por empresa, con un rol conocido", async () => {
        const persona = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, empresa.empresa, persona.id);
        await falla(
          crearMembresiaDeBase(dueno, empresa.empresa, persona.id, "ADMINISTRADOR"),
          "23505",
          "membresia_pkey",
        );
        const otraPersona = await crearPersonaDeBase(dueno);
        await falla(
          dueno.query(
            "insert into membresia (empresa_id, persona_id, rol) values ($1, $2, 'DUENO')",
            [empresa.empresa, otraPersona.id],
          ),
          "23514",
          "membresia_rol_ck",
        );
        await falla(
          dueno.query(
            "insert into membresia (empresa_id, persona_id, rol, invitacion_id) values ($1, $2, 'OPERADOR', $3)",
            [empresa.empresa, otraPersona.id, randomUUID()],
          ),
          "23503",
          "membresia_invitacion_id_fkey",
        );
      });
    });

    describe("invitaciones", () => {
      it("una invitación con una empresa de otro tenant se rechaza", async () => {
        const inv = await crearInvitacionDeBase(dueno, { tenant: empresa.tenant });
        await falla(
          incluirEmpresa(dueno, inv, otra.empresa),
          "23503",
          "invitacion_empresa_empresa_tenant_fkey",
        );
      });

      it("una invitación puede incluir varias empresas del mismo tenant", async () => {
        const c = await crearEmpresaActiva(entorno, { tenant: empresa.tenant });
        const inv = await crearInvitacionDeBase(dueno, { tenant: empresa.tenant });
        await incluirEmpresa(dueno, inv, empresa.empresa, "OPERADOR");
        await incluirEmpresa(dueno, inv, c.empresa, "ADMINISTRADOR");
        const { rows } = await dueno.query<{ n: number }>(
          "select count(*)::int as n from invitacion_empresa where invitacion_id = $1",
          [inv.id],
        );
        expect(rows[0]?.n).toBe(2);
        await falla(incluirEmpresa(dueno, inv, c.empresa), "23505", "invitacion_empresa_pkey");
      });

      it("dos invitaciones pendientes para la misma empresa y el mismo email se rechazan; otro email o una revocada, no", async () => {
        const e = await crearEmpresaActiva(entorno);
        const email = emailAlAzar("dup");
        const primera = await crearInvitacionDeBase(dueno, { tenant: e.tenant, email });
        await incluirEmpresa(dueno, primera, e.empresa);
        const segunda = await crearInvitacionDeBase(dueno, { tenant: e.tenant, email });
        await falla(
          incluirEmpresa(dueno, segunda, e.empresa),
          "23505",
          "invitacion_empresa_pendiente_uk",
        );
        // Otro email: sí.
        const distinta = await crearInvitacionDeBase(dueno, { tenant: e.tenant });
        await incluirEmpresa(dueno, distinta, e.empresa);
        // Revocada la primera, el índice de pendientes se libera (la copia del estado la sigue sola).
        await revocarDeBase(dueno, primera);
        await incluirEmpresa(dueno, segunda, e.empresa);
        // El mismo email en OTRA empresa nunca choca.
        const enOtra = await crearInvitacionDeBase(dueno, { tenant: otra.tenant, email });
        await incluirEmpresa(dueno, enOtra, otra.empresa);
      });

      it("el estado de invitacion_empresa sigue al de la invitación (cascada) y por eso la aceptada también libera el índice", async () => {
        const e = await crearEmpresaActiva(entorno);
        const persona = await crearPersonaDeBase(dueno);
        const inv = await crearInvitacionDeBase(dueno, { tenant: e.tenant, email: persona.email });
        await incluirEmpresa(dueno, inv, e.empresa);
        const c = await crearEmpresaActiva(entorno, { tenant: e.tenant });
        await incluirEmpresa(dueno, inv, c.empresa);
        const estados = async () =>
          (
            await filas<{ estado: string }>(
              "select estado from invitacion_empresa where invitacion_id = $1",
              [inv.id],
            )
          ).map((f) => f.estado);
        expect(await estados()).toEqual(["PENDIENTE", "PENDIENTE"]);
        await aceptarDeBase(dueno, inv, persona.id);
        expect(await estados()).toEqual(["ACEPTADA", "ACEPTADA"]);
        const otraInv = await crearInvitacionDeBase(dueno, {
          tenant: e.tenant,
          email: persona.email,
        });
        await incluirEmpresa(dueno, otraInv, e.empresa);

        const rev = await crearInvitacionDeBase(dueno, { tenant: e.tenant });
        await incluirEmpresa(dueno, rev, e.empresa);
        await revocarDeBase(dueno, rev);
        const { rows } = await dueno.query<{ estado: string }>(
          "select estado from invitacion_empresa where invitacion_id = $1",
          [rev.id],
        );
        expect(rows).toEqual([{ estado: "REVOCADA" }]);
      });

      it("dos altas pendientes para la misma empresa se rechazan aunque cambie el email; revocada la primera, la segunda entra", async () => {
        const { empresa: enAlta, inv: primera } = await invitarGerente();
        const segunda = await crearInvitacionDeBase(dueno, {
          tenant: primera.tenant,
          tipo: "ALTA_GERENTE",
        });
        await falla(
          incluirEmpresa(dueno, segunda, enAlta.empresa, "GERENTE"),
          "23505",
          "invitacion_empresa_gerente_uk",
        );
        await revocarDeBase(dueno, primera);
        await incluirEmpresa(dueno, segunda, enAlta.empresa, "GERENTE");
      });

      it("el rol GERENTE solo entra por el alta, y el alta solo invita al gerente", async () => {
        const usuario = await crearInvitacionDeBase(dueno, { tenant: empresa.tenant });
        await falla(
          incluirEmpresa(dueno, usuario, empresa.empresa, "GERENTE"),
          "23514",
          "invitacion_gerente_solo_en_alta",
        );
        const e = await crearEmpresaEnAlta(entorno);
        const alta = await crearInvitacionDeBase(dueno, { tenant: e.tenant, tipo: "ALTA_GERENTE" });
        await falla(
          incluirEmpresa(dueno, alta, e.empresa, "ADMINISTRADOR"),
          "23514",
          "invitacion_alta_solo_gerente",
        );
        await falla(
          dueno.query(
            `insert into invitacion_empresa (invitacion_id, empresa_id, tenant_id, rol, email, token_hash, tipo)
             values ($1, $2, $3, 'SUPERVISOR', $4, $5, 'USUARIO')`,
            [usuario.id, empresa.empresa, usuario.tenant, usuario.email, usuario.tokenHash],
          ),
          "23514",
          "invitacion_empresa_rol_ck",
        );
      });

      it("las copias de tenant, email, token, tipo y estado no pueden mentir sobre la cabecera", async () => {
        const inv = await crearInvitacionDeBase(dueno, { tenant: empresa.tenant });
        const insertar = (cambios: Partial<Record<string, string>>) => {
          const v = {
            tenant: inv.tenant,
            email: inv.email,
            hash: inv.tokenHash,
            tipo: inv.tipo,
            estado: "PENDIENTE",
            rol: "OPERADOR",
            ...cambios,
          };
          return dueno.query(
            `insert into invitacion_empresa (invitacion_id, empresa_id, tenant_id, rol, email, token_hash, estado, tipo)
             values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [inv.id, empresa.empresa, v.tenant, v.rol, v.email, v.hash, v.estado, v.tipo],
          );
        };
        await falla(
          insertar({ email: emailAlAzar("otro") }),
          "23503",
          "invitacion_empresa_copias_fkey",
        );
        await falla(
          insertar({ hash: hashDeToken("otro token") }),
          "23503",
          "invitacion_empresa_copias_fkey",
        );
        // (Con el rol GERENTE para que el tipo ALTA_GERENTE pase los CHECK y llegue a la FK.)
        await falla(
          insertar({ tipo: "ALTA_GERENTE", rol: "GERENTE" }),
          "23503",
          "invitacion_empresa_copias_fkey",
        );
        await falla(insertar({ estado: "ACEPTADA" }), "23503", "invitacion_empresa_estado_fkey");
        await falla(insertar({ estado: "REVOCADA" }), "23503", "invitacion_empresa_estado_fkey");
        // El tenant de la copia: la cabecera dice otro, y la empresa tampoco es de ese tenant.
        await expect(insertar({ tenant: otra.tenant })).rejects.toMatchObject({ code: "23503" });
        // La copia fiel entra.
        await insertar({});
      });

      it("el estado copiado no se puede cambiar a mano para que deje de coincidir", async () => {
        const { inv } = await invitarUsuario(empresa);
        await falla(
          dueno.query(
            "update invitacion_empresa set estado = 'REVOCADA' where invitacion_id = $1",
            [inv.id],
          ),
          "23503",
          "invitacion_empresa_estado_fkey",
        );
      });

      it("los datos de la cabecera tienen sus controles: token, email, tipo, estado, vencimiento", async () => {
        const insertar = (c: {
          id?: string;
          tenant?: string;
          tipo?: string;
          email?: string;
          hash?: string;
          estado?: string;
          emitida?: Date;
          vence?: Date;
          emitidaPor?: string | null;
        }) =>
          dueno.query(
            `insert into invitacion (id, tenant_id, tipo, email, token_hash, estado, emitida_en, vence_en, emitida_por)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              c.id ?? randomUUID(),
              c.tenant ?? empresa.tenant,
              c.tipo ?? "USUARIO",
              c.email ?? emailAlAzar(),
              c.hash ?? tokenAlAzar().tokenHash,
              c.estado ?? "PENDIENTE",
              c.emitida ?? EMITIDA_EN,
              c.vence ?? VENCE_EN,
              c.emitidaPor ?? null,
            ],
          );
        for (const hash of ["abc", hashDeToken("x").toUpperCase(), `${hashDeToken("x")}0`, ""]) {
          await falla(insertar({ hash }), "23514", "invitacion_token_hash_ck");
        }
        for (const email of ["Mayus@x.com", " a@b.com", "sinarroba", "a@", "@b", ""]) {
          await falla(insertar({ email }), "23514", "invitacion_email_ck");
        }
        await falla(insertar({ tipo: "OTRO" }), "23514", "invitacion_tipo_ck");
        await falla(insertar({ estado: "VENCIDA" }), "23514", "invitacion_estado_ck");
        await falla(insertar({ vence: EMITIDA_EN }), "23514", "invitacion_vence_ck");
        await falla(
          insertar({ vence: new Date(EMITIDA_EN.getTime() - 1000) }),
          "23514",
          "invitacion_vence_ck",
        );
        await falla(insertar({ tenant: randomUUID() }), "23503", "invitacion_tenant_id_fkey");
        await falla(insertar({ emitidaPor: randomUUID() }), "23503", "invitacion_emitida_por_fkey");
        const { tokenHash } = tokenAlAzar();
        const id = randomUUID();
        await insertar({ id, hash: tokenHash });
        await falla(insertar({ hash: tokenHash }), "23505", "invitacion_token_hash_uk");
        await falla(insertar({ id }), "23505", "invitacion_pkey");
      });

      it("la aceptación exige persona, fecha y estado juntos; la persona es la del email de la invitación y a tiempo", async () => {
        const persona = await crearPersonaDeBase(dueno);
        const inv = await crearInvitacionDeBase(dueno, {
          tenant: empresa.tenant,
          email: persona.email,
        });
        const actualizar = (campos: string, valores: unknown[]) =>
          dueno.query(`update invitacion set ${campos} where id = $1`, [inv.id, ...valores]);
        await falla(actualizar("estado = 'ACEPTADA'", []), "23514", "invitacion_aceptacion_ck");
        await falla(
          actualizar("estado = 'ACEPTADA', aceptada_por = $2", [persona.id]),
          "23514",
          "invitacion_aceptacion_ck",
        );
        await falla(
          actualizar("aceptada_por = $2, aceptada_en = $3", [persona.id, AHORA_DE_PRUEBA]),
          "23514",
          "invitacion_aceptacion_ck",
        );
        await falla(
          actualizar("aceptada_en = $2", [AHORA_DE_PRUEBA]),
          "23514",
          "invitacion_aceptacion_ck",
        );
        // Después del vencimiento (o justo en él) no se puede aceptar.
        for (const tarde of [VENCE_EN, new Date(VENCE_EN.getTime() + 1000)]) {
          await falla(
            actualizar("estado = 'ACEPTADA', aceptada_por = $2, aceptada_en = $3", [
              persona.id,
              tarde,
            ]),
            "23514",
            "invitacion_aceptada_a_tiempo_ck",
          );
        }
        // Una persona con otro email no puede ser quien acepta.
        const ajena = await crearPersonaDeBase(dueno);
        await falla(
          actualizar("estado = 'ACEPTADA', aceptada_por = $2, aceptada_en = $3", [
            ajena.id,
            AHORA_DE_PRUEBA,
          ]),
          "23503",
          "invitacion_aceptada_por_fkey",
        );
        await actualizar("estado = 'ACEPTADA', aceptada_por = $2, aceptada_en = $3", [
          persona.id,
          AHORA_DE_PRUEBA,
        ]);
      });

      it("la revocación exige fecha, motivo y estado juntos, y el motivo no puede estar vacío", async () => {
        const inv = await crearInvitacionDeBase(dueno, { tenant: empresa.tenant });
        const actualizar = (campos: string, valores: unknown[]) =>
          dueno.query(`update invitacion set ${campos} where id = $1`, [inv.id, ...valores]);
        await falla(actualizar("estado = 'REVOCADA'", []), "23514", "invitacion_revocacion_ck");
        await falla(
          actualizar("estado = 'REVOCADA', revocada_en = $2", [AHORA_DE_PRUEBA]),
          "23514",
          "invitacion_revocacion_ck",
        );
        await falla(
          actualizar("revocada_en = $2, motivo_revocacion = $3", [AHORA_DE_PRUEBA, "motivo"]),
          "23514",
          "invitacion_revocacion_ck",
        );
        await falla(
          actualizar("motivo_revocacion = $2", ["motivo"]),
          "23514",
          "invitacion_revocacion_ck",
        );
        for (const motivo of ["", "   "]) {
          await falla(
            actualizar("estado = 'REVOCADA', revocada_en = $2, motivo_revocacion = $3", [
              AHORA_DE_PRUEBA,
              motivo,
            ]),
            "23514",
            "invitacion_revocacion_ck",
          );
        }
      });

      it("reemplazada_por exige invitación revocada, distinta de sí misma, y se usa una sola vez", async () => {
        const nueva = await crearInvitacionDeBase(dueno, { tenant: empresa.tenant });
        const vieja = await crearInvitacionDeBase(dueno, { tenant: empresa.tenant });
        await falla(
          dueno.query("update invitacion set reemplazada_por = $2 where id = $1", [
            vieja.id,
            nueva.id,
          ]),
          "23514",
          "invitacion_reemplazo_ck",
        );
        await falla(
          dueno.query(
            `update invitacion set estado = 'REVOCADA', revocada_en = $2, motivo_revocacion = 'x',
               reemplazada_por = id where id = $1`,
            [vieja.id, AHORA_DE_PRUEBA],
          ),
          "23514",
          "invitacion_reemplazo_ck",
        );
        await falla(
          dueno.query(
            `update invitacion set estado = 'REVOCADA', revocada_en = $2, motivo_revocacion = 'x',
               reemplazada_por = $3 where id = $1`,
            [vieja.id, AHORA_DE_PRUEBA, randomUUID()],
          ),
          "23503",
          "invitacion_reemplazada_por_fkey",
        );
        const reemplazar = (id: string) =>
          dueno.query(
            `update invitacion set estado = 'REVOCADA', revocada_en = $2, motivo_revocacion = 'x',
               reemplazada_por = $3 where id = $1`,
            [id, AHORA_DE_PRUEBA, nueva.id],
          );
        await reemplazar(vieja.id);
        const otraVieja = await crearInvitacionDeBase(dueno, { tenant: empresa.tenant });
        await falla(reemplazar(otraVieja.id), "23505", "invitacion_reemplazada_por_uk");
      });

      it("las sucursales de una invitación son de la empresa invitada, y la empresa tiene que estar en la invitación", async () => {
        const { inv, sucursal } = await invitarUsuario(empresa);
        await falla(
          dueno.query(
            "insert into invitacion_sucursal (invitacion_id, empresa_id, sucursal_id) values ($1, $2, $3)",
            [inv.id, empresa.empresa, await sucursalDe(dueno, otra.empresa)],
          ),
          "23503",
          "invitacion_sucursal_sucursal_fkey",
        );
        await falla(
          dueno.query(
            "insert into invitacion_sucursal (invitacion_id, empresa_id, sucursal_id) values ($1, $2, $3)",
            [inv.id, otra.empresa, await sucursalDe(dueno, otra.empresa)],
          ),
          "23503",
          "invitacion_sucursal_invitacion_empresa_fkey",
        );
        await falla(
          dueno.query(
            "insert into invitacion_sucursal (invitacion_id, empresa_id, sucursal_id) values ($1, $2, $3)",
            [inv.id, empresa.empresa, sucursal],
          ),
          "23505",
          "invitacion_sucursal_pkey",
        );
      });
    });

    describe("disparadores de la invitación", () => {
      it("los datos de emisión son inmutables, uno por uno", async () => {
        const { inv } = await invitarUsuario(empresa);
        const emisor = await crearPersonaDeBase(dueno);
        const cambios: ReadonlyArray<readonly [string, unknown]> = [
          ["id", randomUUID()],
          ["tenant_id", otra.tenant],
          ["tipo", "ALTA_GERENTE"],
          ["email", emailAlAzar("nuevo")],
          ["token_hash", hashDeToken("otro")],
          ["emitida_en", new Date(EMITIDA_EN.getTime() - 1000)],
          ["vence_en", new Date(VENCE_EN.getTime() + 1000)],
          ["emitida_por", emisor.id],
          ["creado_en", new Date("2001-01-01T00:00:00Z")],
        ];
        for (const [columna, valor] of cambios) {
          await falla(
            dueno.query(`update invitacion set ${columna} = $2 where id = $1`, [inv.id, valor]),
            "23514",
            "invitacion_inmutable",
          );
        }
      });

      it("una invitación resuelta queda congelada; solo se completa el reemplazo de una revocada", async () => {
        const persona = await crearPersonaDeBase(dueno);
        const aceptada = await crearInvitacionDeBase(dueno, {
          tenant: empresa.tenant,
          email: persona.email,
        });
        await aceptarDeBase(dueno, aceptada, persona.id);
        for (const [campos, valores] of [
          ["aceptada_en = $2", [new Date(AHORA_DE_PRUEBA.getTime() + 1000)]],
          ["aceptada_por = null, aceptada_en = null", []],
          ["aceptada_por = null", []],
        ] as const) {
          await falla(
            dueno.query(`update invitacion set ${campos} where id = $1`, [aceptada.id, ...valores]),
            "23514",
            "invitacion_resuelta_inmutable",
          );
        }

        const revocada = await crearInvitacionDeBase(dueno, { tenant: empresa.tenant });
        await revocarDeBase(dueno, revocada, "uno");
        for (const [campos, valores] of [
          ["motivo_revocacion = $2", ["otro"]],
          ["revocada_en = $2", [new Date(AHORA_DE_PRUEBA.getTime() + 1000)]],
        ] as const) {
          await falla(
            dueno.query(`update invitacion set ${campos} where id = $1`, [revocada.id, ...valores]),
            "23514",
            "invitacion_resuelta_inmutable",
          );
        }
        // Completar el reemplazo de una revocada sí; cambiarlo después, no.
        const primera = await crearInvitacionDeBase(dueno, { tenant: empresa.tenant });
        const segunda = await crearInvitacionDeBase(dueno, { tenant: empresa.tenant });
        await dueno.query("update invitacion set reemplazada_por = $2 where id = $1", [
          revocada.id,
          primera.id,
        ]);
        await falla(
          dueno.query("update invitacion set reemplazada_por = $2 where id = $1", [
            revocada.id,
            segunda.id,
          ]),
          "23514",
          "invitacion_resuelta_inmutable",
        );
        await falla(
          dueno.query("update invitacion set reemplazada_por = null where id = $1", [revocada.id]),
          "23514",
          "invitacion_resuelta_inmutable",
        );
      });

      it("cada actualización sube la versión y la fecha de invitación, membresía y asignación", async () => {
        const e = await crearEmpresaActiva(entorno);
        const persona = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, e.empresa, persona.id);
        const sucursal = await sucursalDe(dueno, e.empresa);
        await dueno.query(
          "insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id) values ($1, $2, $3)",
          [e.empresa, persona.id, sucursal],
        );
        const inv = await crearInvitacionDeBase(dueno, { tenant: e.tenant });
        const versiones = async () => ({
          membresia: (
            await filas<{ version: number }>(
              "select version from membresia where persona_id = $1",
              [persona.id],
            )
          )[0]?.version,
          asignacion: (
            await filas<{ version: number }>(
              "select version from asignacion_sucursal where persona_id = $1",
              [persona.id],
            )
          )[0]?.version,
          invitacion: (
            await filas<{ version: number }>("select version from invitacion where id = $1", [
              inv.id,
            ])
          )[0]?.version,
        });
        expect(await versiones()).toEqual({ membresia: 1, asignacion: 1, invitacion: 1 });
        await dueno.query("update membresia set activo = false where persona_id = $1", [
          persona.id,
        ]);
        await dueno.query("update asignacion_sucursal set activa = false where persona_id = $1", [
          persona.id,
        ]);
        await revocarDeBase(dueno, inv);
        expect(await versiones()).toEqual({ membresia: 2, asignacion: 2, invitacion: 2 });
      });
    });
  });

  // =============================================================================================
  // 3. Aislamiento por contexto firmado
  // =============================================================================================
  describe("aislamiento", () => {
    let a: EmpresaDePrueba;
    let c: EmpresaDePrueba; // mismo tenant que A
    let b: EmpresaDePrueba; // otro tenant
    let enAlta: EmpresaDePrueba;
    let gerenteA: string;
    let adminA: string;
    let opA: string;
    let gerenteC: string;
    let opB: string;
    let invA: InvitacionDePrueba;
    let invC: InvitacionDePrueba;
    let invB: InvitacionDePrueba;
    let invAC: InvitacionDePrueba; // incluye A y C
    let invAlta: InvitacionDePrueba;
    let sucursalA: string;

    beforeAll(async () => {
      if (base === null) return;
      a = await crearEmpresaActiva(entorno, { nombreDeSucursal: "Sucursal de A" });
      c = await crearEmpresaActiva(entorno, {
        tenant: a.tenant,
        nombreDeSucursal: "Sucursal de C",
      });
      b = await crearEmpresaActiva(entorno, { nombreDeSucursal: "Sucursal de B" });
      enAlta = await crearEmpresaEnAlta(entorno);
      sucursalA = await sucursalDe(dueno, a.empresa);

      gerenteA = (await crearPersonaDeBase(dueno)).id;
      adminA = (await crearPersonaDeBase(dueno)).id;
      opA = (await crearPersonaDeBase(dueno)).id;
      gerenteC = (await crearPersonaDeBase(dueno)).id;
      opB = (await crearPersonaDeBase(dueno)).id;
      await crearMembresiaDeBase(dueno, a.empresa, gerenteA, "GERENTE");
      await crearMembresiaDeBase(dueno, a.empresa, adminA, "ADMINISTRADOR");
      await crearMembresiaDeBase(dueno, a.empresa, opA, "OPERADOR");
      await crearMembresiaDeBase(dueno, c.empresa, gerenteC, "GERENTE");
      await crearMembresiaDeBase(dueno, b.empresa, opB, "OPERADOR");
      await dueno.query(
        "insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id) values ($1, $2, $3)",
        [a.empresa, opA, sucursalA],
      );
      await dueno.query(
        "insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id) values ($1, $2, $3)",
        [c.empresa, gerenteC, await sucursalDe(dueno, c.empresa)],
      );

      invA = (await invitarUsuario(a)).inv;
      invC = (await invitarUsuario(c)).inv;
      invB = (await invitarUsuario(b)).inv;
      invAC = await crearInvitacionDeBase(dueno, { tenant: a.tenant });
      await incluirEmpresa(dueno, invAC, a.empresa, "OPERADOR", [sucursalA]);
      await incluirEmpresa(dueno, invAC, c.empresa, "ADMINISTRADOR");
      invAlta = await crearInvitacionDeBase(dueno, { tenant: enAlta.tenant, tipo: "ALTA_GERENTE" });
      await incluirEmpresa(dueno, invAlta, enAlta.empresa, "GERENTE");
    });

    const comoA = (persona: string | null = gerenteA) => comoEmpresa(a.empresa, persona as never);

    describe("el contexto OPERATIVO: una empresa no ve ni toca las de las demás, tampoco las del mismo tenant", () => {
      it("ve solo las membresías, asignaciones, invitaciones y personas de su empresa", async () => {
        const miembros = await leerUna(
          comoA(),
          "persona_id",
          sql`select persona_id from membresia`,
        );
        expect(miembros.sort()).toEqual([gerenteA, adminA, opA].sort());
        expect(
          await leerUna(comoA(), "persona_id", sql`select persona_id from asignacion_sucursal`),
        ).toEqual([opA]);
        const personas = await leerUna(comoA(), "id", sql`select id from persona`);
        expect(personas.sort()).toEqual([gerenteA, adminA, opA].sort());
        const invitaciones = await leerUna(comoA(), "id", sql`select id from invitacion`);
        expect(invitaciones.sort()).toEqual([invA.id, invAC.id].sort());
        // De la invitación que también incluye a C, ve solo la fila de A.
        const empresas = await leerUna(
          comoA(),
          "empresa_id",
          sql`select empresa_id from invitacion_empresa order by invitacion_id`,
        );
        expect(empresas.sort()).toEqual([a.empresa, a.empresa].sort());
        expect(await contar(comoA(), "invitacion_sucursal")).toBe(2);
      });

      it("la empresa C, del mismo tenant, ve lo suyo y nada de A", async () => {
        const comoC = comoEmpresa(c.empresa, gerenteC as never);
        expect(await leerUna(comoC, "persona_id", sql`select persona_id from membresia`)).toEqual([
          gerenteC,
        ]);
        expect((await leerUna(comoC, "id", sql`select id from invitacion`)).sort()).toEqual(
          [invC.id, invAC.id].sort(),
        );
        expect(await contar(comoC, "asignacion_sucursal")).toBe(1);
      });

      it("sin persona en el contexto (el sistema) ve lo mismo de su empresa", async () => {
        expect(await contar(comoA(null), "membresia")).toBe(3);
      });

      it("no puede modificar ni apagar a los de otra empresa: 0 filas", async () => {
        const deB = await escribir(
          comoA(),
          sql`update membresia set activo = false where persona_id = ${opB}`,
        );
        expect(deB).toEqual({ ok: true, valor: 0 });
        const deC = await escribir(
          comoA(),
          sql`update asignacion_sucursal set activa = false where persona_id = ${gerenteC}`,
        );
        expect(deC).toEqual({ ok: true, valor: 0 });
        const revocarC = await escribir(
          comoA(),
          sql`update invitacion set estado = 'REVOCADA', revocada_en = ${AHORA_DE_PRUEBA}, motivo_revocacion = 'x'
              where id = ${invC.id}`,
        );
        expect(revocarC).toEqual({ ok: true, valor: 0 });
        expect(await contar(comoEmpresa(b.empresa, opB as never), "membresia")).toBe(1);
      });

      it("no puede crear membresías ni personas: eso nace de aceptar una invitación (las asignaciones, desde 0005, sí: a un miembro activo y a una sucursal activa)", async () => {
        const nueva = await crearPersonaDeBase(dueno);
        expect(
          await escribir(
            comoA(),
            sql`insert into membresia (empresa_id, persona_id, rol) values (${a.empresa}, ${nueva.id}, 'OPERADOR')`,
          ),
        ).toEqual(DENEGADO);
        expect(
          await escribir(comoA(), sql`insert into persona (email) values (${emailAlAzar()})`),
        ).toEqual(DENEGADO);
        // Una persona que no es miembro: no se la asigna (la política exige la membresía activa).
        expect(
          await escribir(
            comoA(),
            sql`insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id)
                values (${a.empresa}, ${nueva.id}, ${sucursalA})`,
          ),
        ).toEqual(DENEGADO);
      });

      it("no puede ascender: el rol solo cambia al aceptar un traspaso (la política, y el disparador de 0005), ni siquiera sobre su propia membresía", async () => {
        // Sobre un miembro que puede apagar: la fila se ve; el disparador frena el cambio antes que
        // el WITH CHECK (cada barrera por separado se prueba en administracion-sql.test.ts).
        expect(
          await escribir(
            comoA(),
            sql`update membresia set rol = 'GERENTE' where persona_id = ${opA}`,
          ),
        ).toEqual({
          ok: false,
          error: { tipo: "Check", restriccion: "membresia_rol_sin_traspaso" },
        });
        // Sobre el gerente: ninguna política deja ver la fila para actualizarla, así que son 0 filas.
        expect(
          await escribir(
            comoA(),
            sql`update membresia set rol = 'ADMINISTRADOR' where persona_id = ${gerenteA}`,
          ),
        ).toEqual({ ok: true, valor: 0 });
        // Las demás columnas siguen sin permiso de actualización.
        for (const consulta of [
          sql`update membresia set persona_id = ${gerenteA} where persona_id = ${opA}`,
          sql`update membresia set empresa_id = ${b.empresa} where persona_id = ${opA}`,
          sql`update membresia set version = 99 where persona_id = ${opA}`,
        ]) {
          expect(await escribir(comoA(), consulta)).toEqual(DENEGADO);
        }
      });

      it("apaga a un miembro, pero no puede reactivarlo ni apagar al gerente", async () => {
        const e = await crearEmpresaActiva(entorno);
        const gerente = await crearPersonaDeBase(dueno);
        const admin = await crearPersonaDeBase(dueno);
        const operador = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, e.empresa, gerente.id, "GERENTE");
        await crearMembresiaDeBase(dueno, e.empresa, admin.id, "ADMINISTRADOR");
        await crearMembresiaDeBase(dueno, e.empresa, operador.id, "OPERADOR");
        const sucursal = await sucursalDe(dueno, e.empresa);
        await dueno.query(
          "insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id) values ($1, $2, $3)",
          [e.empresa, operador.id, sucursal],
        );
        const contexto = comoEmpresa(e.empresa, admin.id as never);

        expect(
          await escribir(
            contexto,
            sql`update membresia set activo = false where persona_id = ${gerente.id}`,
          ),
        ).toEqual({ ok: true, valor: 0 });
        expect(
          await escribir(
            contexto,
            sql`update membresia set activo = false where persona_id = ${operador.id}`,
          ),
        ).toEqual({ ok: true, valor: 1 });
        expect(
          await escribir(
            contexto,
            sql`update asignacion_sucursal set activa = false where persona_id = ${operador.id}`,
          ),
        ).toEqual({ ok: true, valor: 1 });
        // Reactivar: rechazo (el WITH CHECK exige activo = false), no "0 filas".
        expect(
          await escribir(
            contexto,
            sql`update membresia set activo = true where persona_id = ${operador.id}`,
          ),
        ).toEqual(DENEGADO);
        expect(
          await escribir(
            contexto,
            sql`update asignacion_sucursal set activa = true where persona_id = ${operador.id}`,
          ),
        ).toEqual(DENEGADO);
        const { rows } = await dueno.query<{ activo: boolean }>(
          "select activo from membresia where persona_id = $1",
          [operador.id],
        );
        expect(rows).toEqual([{ activo: false }]);
      });

      it("con la empresa suspendida (o su tenant) no apaga a nadie ni invita", async () => {
        const e = await crearEmpresaActiva(entorno);
        const admin = await crearPersonaDeBase(dueno);
        const operador = await crearPersonaDeBase(dueno);
        await crearMembresiaDeBase(dueno, e.empresa, admin.id, "ADMINISTRADOR");
        await crearMembresiaDeBase(dueno, e.empresa, operador.id, "OPERADOR");
        const { inv } = await invitarUsuario(e);
        await dueno.query(
          "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
          [e.empresa],
        );
        const contexto = comoEmpresa(e.empresa, admin.id as never);
        expect(
          await escribir(
            contexto,
            sql`update membresia set activo = false where persona_id = ${operador.id}`,
          ),
        ).toEqual({ ok: true, valor: 0 });
        expect(
          await escribir(
            contexto,
            sql`update invitacion set estado = 'REVOCADA', revocada_en = ${AHORA_DE_PRUEBA}, motivo_revocacion = 'x'
                where id = ${inv.id}`,
          ),
        ).toEqual({ ok: true, valor: 0 });
        const nueva = {
          id: randomUUID(),
          hash: tokenAlAzar().tokenHash,
        };
        expect(
          await escribir(
            contexto,
            sql`insert into invitacion (id, tenant_id, tipo, email, token_hash, emitida_en, vence_en, emitida_por)
                values (${nueva.id}, ${e.tenant}, 'USUARIO', ${emailAlAzar()}, ${nueva.hash}, ${EMITIDA_EN}, ${VENCE_EN}, ${admin.id})`,
          ),
        ).toEqual(DENEGADO);
      });
    });

    describe("el contexto OPERATIVO: invitar", () => {
      const insertarCabecera = (
        contexto: Contexto,
        d: { tenant: string; tipo?: string; emitidaPor: string | null; id?: string },
      ) =>
        escribir(
          contexto,
          sql`insert into invitacion (id, tenant_id, tipo, email, token_hash, emitida_en, vence_en, emitida_por)
              values (${d.id ?? randomUUID()}, ${d.tenant}, ${d.tipo ?? "USUARIO"}, ${emailAlAzar()},
                      ${tokenAlAzar().tokenHash}, ${EMITIDA_EN}, ${VENCE_EN}, ${d.emitidaPor})`,
        );

      it("emite una invitación de usuario de su tenant, a nombre de su persona, y la incluye a su empresa", async () => {
        const id = randomUUID();
        const { tokenHash } = tokenAlAzar();
        const email = emailAlAzar();
        const r = await entorno.ejecutar({ contexto: comoA(adminA) }, async ({ db }) => {
          await sql`insert into invitacion (id, tenant_id, tipo, email, token_hash, emitida_en, vence_en, emitida_por)
                    values (${id}, ${a.tenant}, 'USUARIO', ${email}, ${tokenHash}, ${EMITIDA_EN}, ${VENCE_EN}, ${adminA})`.execute(
            db,
          );
          await sql`insert into invitacion_empresa (invitacion_id, empresa_id, tenant_id, rol, email, token_hash, estado, tipo)
                    values (${id}, ${a.empresa}, ${a.tenant}, 'OPERADOR', ${email}, ${tokenHash}, 'PENDIENTE', 'USUARIO')`.execute(
            db,
          );
          await sql`insert into invitacion_sucursal (invitacion_id, empresa_id, sucursal_id)
                    values (${id}, ${a.empresa}, ${sucursalA})`.execute(db);
          const { rows } = await sql<{
            id: string;
          }>`select id from invitacion where id = ${id}`.execute(db);
          return ok(rows.length);
        });
        expect(r).toEqual({ ok: true, valor: 1 });
      });

      it("no puede emitir un alta de gerente, ni de otro tenant, ni a nombre de otra persona", async () => {
        expect(
          await insertarCabecera(comoA(adminA), {
            tenant: a.tenant,
            tipo: "ALTA_GERENTE",
            emitidaPor: adminA,
          }),
        ).toEqual(DENEGADO);
        expect(
          await insertarCabecera(comoA(adminA), { tenant: b.tenant, emitidaPor: adminA }),
        ).toEqual(DENEGADO);
        expect(
          await insertarCabecera(comoA(adminA), { tenant: a.tenant, emitidaPor: opA }),
        ).toEqual(DENEGADO);
        expect(
          await insertarCabecera(comoA(adminA), { tenant: a.tenant, emitidaPor: null }),
        ).toEqual(DENEGADO);
        // Sin persona en el contexto (el sistema), la emite sin emisor, no a nombre de alguien.
        expect(await insertarCabecera(comoA(null), { tenant: a.tenant, emitidaPor: null })).toEqual(
          {
            ok: true,
            valor: 1,
          },
        );
        expect(
          await insertarCabecera(comoA(null), { tenant: a.tenant, emitidaPor: adminA }),
        ).toEqual(DENEGADO);
      });

      it("no puede incluir en una invitación a otra empresa, ni un alta, ni una ya resuelta", async () => {
        const mia = await crearInvitacionDeBase(dueno, { tenant: a.tenant });
        const insertarEmpresa = (
          empresa: string,
          tipo: string,
          estado = "PENDIENTE",
          rol = "OPERADOR",
        ) =>
          escribir(
            comoA(),
            sql`insert into invitacion_empresa (invitacion_id, empresa_id, tenant_id, rol, email, token_hash, estado, tipo)
                values (${mia.id}, ${empresa}, ${a.tenant}, ${rol}, ${mia.email}, ${mia.tokenHash}, ${estado}, ${tipo})`,
          );
        expect(await insertarEmpresa(c.empresa, "USUARIO")).toEqual(DENEGADO);
        expect(await insertarEmpresa(b.empresa, "USUARIO")).toEqual(DENEGADO);
        expect(await insertarEmpresa(a.empresa, "ALTA_GERENTE", "PENDIENTE", "GERENTE")).toEqual(
          DENEGADO,
        );
        expect(await insertarEmpresa(a.empresa, "USUARIO", "ACEPTADA")).toEqual(DENEGADO);
        expect(await insertarEmpresa(a.empresa, "USUARIO")).toEqual({ ok: true, valor: 1 });
        // Sus sucursales: solo las de su empresa.
        expect(
          await escribir(
            comoA(),
            sql`insert into invitacion_sucursal (invitacion_id, empresa_id, sucursal_id)
                values (${mia.id}, ${c.empresa}, ${await sucursalDe(dueno, c.empresa)})`,
          ),
        ).toEqual(DENEGADO);
        expect(
          await escribir(
            comoA(),
            sql`insert into invitacion_sucursal (invitacion_id, empresa_id, sucursal_id)
                values (${mia.id}, ${a.empresa}, ${sucursalA})`,
          ),
        ).toEqual({ ok: true, valor: 1 });
      });

      it("revoca las invitaciones de su empresa, pero no puede aceptarlas ni dejarlas en otro estado", async () => {
        const { inv } = await invitarUsuario(a);
        const persona = await crearPersonaDeBase(dueno, inv.email);
        expect(
          await escribir(
            comoA(),
            sql`update invitacion set estado = 'ACEPTADA', aceptada_por = ${persona.id}, aceptada_en = ${AHORA_DE_PRUEBA}
                where id = ${inv.id}`,
          ),
        ).toEqual(DENEGADO);
        expect(
          await escribir(
            comoA(),
            sql`update invitacion set email = 'otro@x.com' where id = ${inv.id}`,
          ),
        ).toEqual(DENEGADO);
        expect(
          await escribir(
            comoA(),
            sql`update invitacion set token_hash = ${hashDeToken("x")} where id = ${inv.id}`,
          ),
        ).toEqual(DENEGADO);
        expect(
          await escribir(
            comoA(),
            sql`update invitacion set estado = 'REVOCADA', revocada_en = ${AHORA_DE_PRUEBA}, motivo_revocacion = 'ya no'
                where id = ${inv.id}`,
          ),
        ).toEqual({ ok: true, valor: 1 });
        expect(
          await leerUna(
            comoA(),
            "estado",
            sql`select estado from invitacion_empresa where invitacion_id = ${inv.id}`,
          ),
        ).toEqual(["REVOCADA"]);
      });

      it("una invitación que incluye a dos empresas se revoca entera (R4)", async () => {
        const inv = await crearInvitacionDeBase(dueno, { tenant: a.tenant });
        await incluirEmpresa(dueno, inv, a.empresa);
        await incluirEmpresa(dueno, inv, c.empresa);
        expect(
          await escribir(
            comoA(),
            sql`update invitacion set estado = 'REVOCADA', revocada_en = ${AHORA_DE_PRUEBA}, motivo_revocacion = 'baja'
                where id = ${inv.id}`,
          ),
        ).toEqual({ ok: true, valor: 1 });
        const { rows } = await dueno.query<{ estado: string }>(
          "select estado from invitacion_empresa where invitacion_id = $1",
          [inv.id],
        );
        expect(rows).toEqual([{ estado: "REVOCADA" }, { estado: "REVOCADA" }]);
      });

      it("el reenvío: revoca la vieja apuntando a la nueva (que ya existe), una sola vez", async () => {
        const { inv: vieja } = await invitarUsuario(a);
        const { inv: nueva } = await invitarUsuario(a);
        const reemplazar = () =>
          escribir(
            comoA(),
            sql`update invitacion set estado = 'REVOCADA', revocada_en = ${AHORA_DE_PRUEBA},
                  motivo_revocacion = 'reenviada', reemplazada_por = ${nueva.id}
                where id = ${vieja.id} and estado = 'PENDIENTE'`,
          );
        expect(await reemplazar()).toEqual({ ok: true, valor: 1 });
        expect(await reemplazar()).toEqual({ ok: true, valor: 0 });
      });
    });

    describe("el contexto de INVITACION: ve solo lo del token y nada más", () => {
      it("con el token de A ve su invitación, sus empresas, sus sucursales y el tenant; nada de lo demás", async () => {
        const contexto = comoInvitacion(invA.tokenHash);
        expect(await leerUna(contexto, "id", sql`select id from invitacion`)).toEqual([invA.id]);
        expect(
          await leerUna(contexto, "empresa_id", sql`select empresa_id from invitacion_empresa`),
        ).toEqual([a.empresa]);
        expect(
          await leerUna(contexto, "sucursal_id", sql`select sucursal_id from invitacion_sucursal`),
        ).toEqual([sucursalA]);
        expect(await leerUna(contexto, "id", sql`select id from empresa`)).toEqual([a.empresa]);
        expect(await leerUna(contexto, "id", sql`select id from tenant`)).toEqual([a.tenant]);
        for (const tabla of [
          "sucursal",
          "persona",
          "membresia",
          "asignacion_sucursal",
          "membresia_tenant",
          "auditoria_empresa",
          "trabajo",
        ]) {
          expect(await contar(contexto, tabla), tabla).toBe(0);
        }
      });

      it("con el token de una invitación a dos empresas ve las dos empresas y el tenant, pero ninguna otra invitación", async () => {
        const contexto = comoInvitacion(invAC.tokenHash);
        expect(await leerUna(contexto, "id", sql`select id from invitacion`)).toEqual([invAC.id]);
        expect((await leerUna(contexto, "id", sql`select id from empresa`)).sort()).toEqual(
          [a.empresa, c.empresa].sort(),
        );
        expect(await contar(contexto, "invitacion_empresa")).toBe(2);
        expect(await contar(contexto, "tenant")).toBe(1);
      });

      it("con un token ajeno o inventado ve 0 filas en todas las tablas", async () => {
        for (const tokenHash of [hashDeToken("no existe"), tokenAlAzar().tokenHash]) {
          for (const tabla of [
            ...TABLAS_NUEVAS,
            "persona",
            "empresa",
            "tenant",
            "sucursal",
            "auditoria_empresa",
            "trabajo",
            "membresia_tenant",
          ]) {
            expect(await contar(comoInvitacion(tokenHash), tabla), tabla).toBe(0);
          }
        }
      });

      it("la persona visible es solo la del email de la invitación", async () => {
        const { inv } = await invitarUsuario(a);
        const otra = await crearPersonaDeBase(dueno);
        const suya = await crearPersonaDeBase(dueno, inv.email);
        expect(
          await leerUna(comoInvitacion(inv.tokenHash), "id", sql`select id from persona`),
        ).toEqual([suya.id]);
        expect(otra.id).not.toBe(suya.id);
      });

      it("da de alta su persona con el email de la invitación, y con ningún otro", async () => {
        const { inv } = await invitarUsuario(a);
        const contexto = comoInvitacion(inv.tokenHash);
        expect(
          await escribir(
            contexto,
            sql`insert into persona (email) values (${emailAlAzar("ajeno")})`,
          ),
        ).toEqual(DENEGADO);
        expect(
          await escribir(contexto, sql`insert into persona (email) values (${invA.email})`),
        ).toEqual(DENEGADO);
        expect(
          await escribir(contexto, sql`insert into persona (email) values (${inv.email})`),
        ).toEqual({
          ok: true,
          valor: 1,
        });
        // Dos veces el mismo email: la clave única lo frena, no hay dos personas.
        expect(
          await escribir(contexto, sql`insert into persona (email) values (${inv.email})`),
        ).toEqual(unicidad("persona_email_uk"));
      });

      it("no puede crear personas con campos que no le tocan (activo_global) ni modificarlas", async () => {
        const { inv } = await invitarUsuario(a);
        const contexto = comoInvitacion(inv.tokenHash);
        expect(
          await escribir(
            contexto,
            sql`insert into persona (email, activo_global) values (${inv.email}, false)`,
          ),
        ).toEqual(DENEGADO);
        const suya = await crearPersonaDeBase(dueno, inv.email);
        expect(
          await escribir(
            contexto,
            sql`update persona set activo_global = false where id = ${suya.id}`,
          ),
        ).toEqual(DENEGADO);
        expect(
          await escribir(contexto, sql`update persona set email = 'x@y.com' where id = ${suya.id}`),
        ).toEqual(DENEGADO);
      });

      it("acepta su invitación una sola vez, y solo con su token", async () => {
        const { inv } = await invitarUsuario(a);
        const persona = await crearPersonaDeBase(dueno, inv.email);
        const aceptar = (tokenHash: string, estado = "ACEPTADA") =>
          escribir(
            comoInvitacion(tokenHash),
            sql`update invitacion set estado = ${estado}, aceptada_por = ${persona.id}, aceptada_en = ${AHORA_DE_PRUEBA}
                where id = ${inv.id}`,
          );
        // Con un token ajeno la invitación no se ve: 0 filas.
        expect(await aceptar(invB.tokenHash)).toEqual({ ok: true, valor: 0 });
        // Con el propio, la deja en un estado que no es aceptada: rechazo.
        expect(
          await escribir(
            comoInvitacion(inv.tokenHash),
            sql`update invitacion set estado = 'REVOCADA', revocada_en = ${AHORA_DE_PRUEBA}, motivo_revocacion = 'x'
                where id = ${inv.id}`,
          ),
        ).toEqual(DENEGADO);
        expect(await aceptar(inv.tokenHash)).toEqual({ ok: true, valor: 1 });
        // La segunda vez ya no está pendiente: 0 filas, nada se pisa.
        expect(await aceptar(inv.tokenHash)).toEqual({ ok: true, valor: 0 });
      });

      it("no puede aceptar una invitación revocada, ni una dirigida a otro email, ni una vencida", async () => {
        const revocada = (await invitarUsuario(a)).inv;
        const persona = await crearPersonaDeBase(dueno, revocada.email);
        await revocarDeBase(dueno, revocada);
        expect(
          await escribir(
            comoInvitacion(revocada.tokenHash),
            sql`update invitacion set estado = 'ACEPTADA', aceptada_por = ${persona.id}, aceptada_en = ${AHORA_DE_PRUEBA}
                where id = ${revocada.id}`,
          ),
        ).toEqual({ ok: true, valor: 0 });

        const { inv } = await invitarUsuario(a);
        const ajena = await crearPersonaDeBase(dueno);
        const aceptarCon = (aceptadaPor: string, cuando: Date) =>
          escribir(
            comoInvitacion(inv.tokenHash),
            sql`update invitacion set estado = 'ACEPTADA', aceptada_por = ${aceptadaPor}, aceptada_en = ${cuando}
                where id = ${inv.id}`,
          );
        expect(await aceptarCon(ajena.id, AHORA_DE_PRUEBA)).toEqual({
          ok: false,
          error: { tipo: "Referencia", restriccion: "invitacion_aceptada_por_fkey" },
        });
        const suya = await crearPersonaDeBase(dueno, inv.email);
        expect(await aceptarCon(suya.id, VENCE_EN)).toEqual({
          ok: false,
          error: { tipo: "Check", restriccion: "invitacion_aceptada_a_tiempo_ck" },
        });
      });

      it("no puede tocar otros campos de la invitación (email, vencimiento, token)", async () => {
        const { inv } = await invitarUsuario(a);
        const contexto = comoInvitacion(inv.tokenHash);
        for (const consulta of [
          sql`update invitacion set email = 'otro@x.com' where id = ${inv.id}`,
          sql`update invitacion set vence_en = ${new Date("2030-01-01T00:00:00Z")} where id = ${inv.id}`,
          sql`update invitacion set token_hash = ${hashDeToken("x")} where id = ${inv.id}`,
          sql`update invitacion set tenant_id = ${b.tenant} where id = ${inv.id}`,
          sql`insert into invitacion (id, tenant_id, tipo, email, token_hash, emitida_en, vence_en)
              values (${randomUUID()}, ${a.tenant}, 'USUARIO', ${emailAlAzar()}, ${tokenAlAzar().tokenHash}, ${EMITIDA_EN}, ${VENCE_EN})`,
          sql`insert into invitacion_empresa (invitacion_id, empresa_id, tenant_id, rol, email, token_hash, tipo)
              values (${inv.id}, ${c.empresa}, ${a.tenant}, 'OPERADOR', ${inv.email}, ${inv.tokenHash}, 'USUARIO')`,
        ]) {
          expect(await escribir(contexto, consulta)).toEqual(DENEGADO);
        }
      });

      describe("crear la membresía y las asignaciones", () => {
        it("recorre la aceptación completa de una invitación a dos empresas: persona, estado, membresías, asignaciones y auditoría", async () => {
          const e1 = await crearEmpresaActiva(entorno);
          const e2 = await crearEmpresaActiva(entorno, { tenant: e1.tenant });
          const inv = await crearInvitacionDeBase(dueno, { tenant: e1.tenant });
          const s1 = await sucursalDe(dueno, e1.empresa);
          await incluirEmpresa(dueno, inv, e1.empresa, "ADMINISTRADOR", [s1]);
          await incluirEmpresa(dueno, inv, e2.empresa, "OPERADOR");
          const persona = await aceptarComoInvitado(inv);
          const contexto = comoInvitacion(inv.tokenHash);

          // Después de aceptar, el estado copiado la sigue y ve su propia aceptación.
          expect(
            await leerUna(contexto, "estado", sql`select estado from invitacion_empresa`),
          ).toEqual(["ACEPTADA", "ACEPTADA"]);
          expect(await altaDeMembresia(inv, e1.empresa, persona, "ADMINISTRADOR")).toEqual({
            ok: true,
            valor: 1,
          });
          expect(await altaDeMembresia(inv, e2.empresa, persona, "OPERADOR")).toEqual({
            ok: true,
            valor: 1,
          });
          expect(
            await escribir(
              contexto,
              sql`insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id)
                  values (${e1.empresa}, ${persona}, ${s1})`,
            ),
          ).toEqual({ ok: true, valor: 1 });
          for (const empresa of [e1.empresa, e2.empresa]) {
            expect(
              await escribir(
                contexto,
                sql`insert into auditoria_empresa (empresa_id, actor_persona_id, accion, entidad, entidad_id)
                    values (${empresa}, ${persona}, 'INVITACION_ACEPTADA', 'invitacion', ${inv.id})`,
              ),
            ).toEqual({ ok: true, valor: 1 });
          }
          // Ve lo que creó (la persona, las membresías, la asignación) y nada más.
          expect(await contar(contexto, "membresia")).toBe(2);
          expect(await contar(contexto, "asignacion_sucursal")).toBe(1);
          const { rows } = await dueno.query<{
            empresa_id: string;
            rol: string;
            invitacion_id: string;
          }>(
            "select empresa_id, rol, invitacion_id from membresia where persona_id = $1 order by rol",
            [persona],
          );
          expect(rows).toHaveLength(2);
          expect(rows.every((f) => f.invitacion_id === inv.id)).toBe(true);
        });

        it("no hay membresía antes de aceptar, ni para otra persona, otra empresa, otro rol o sin registrar la invitación", async () => {
          const e1 = await crearEmpresaActiva(entorno);
          const e2 = await crearEmpresaActiva(entorno, { tenant: e1.tenant });
          const inv = await crearInvitacionDeBase(dueno, { tenant: e1.tenant });
          await incluirEmpresa(dueno, inv, e1.empresa, "OPERADOR");
          const suya = await crearPersonaDeBase(dueno, inv.email);
          // Todavía PENDIENTE.
          expect(await altaDeMembresia(inv, e1.empresa, suya.id, "OPERADOR")).toEqual(DENEGADO);
          await aceptarDeBase(dueno, inv, suya.id);
          const otra = await crearPersonaDeBase(dueno);
          expect(await altaDeMembresia(inv, e1.empresa, otra.id, "OPERADOR")).toEqual(DENEGADO);
          expect(await altaDeMembresia(inv, e2.empresa, suya.id, "OPERADOR")).toEqual(DENEGADO);
          expect(await altaDeMembresia(inv, e1.empresa, suya.id, "ADMINISTRADOR")).toEqual(
            DENEGADO,
          );
          expect(await altaDeMembresia(inv, e1.empresa, suya.id, "GERENTE")).toEqual(DENEGADO);
          const sinInvitacion = escribir(
            comoInvitacion(inv.tokenHash),
            sql`insert into membresia (empresa_id, persona_id, rol) values (${e1.empresa}, ${suya.id}, 'OPERADOR')`,
          );
          expect(await sinInvitacion).toEqual(DENEGADO);
          const deOtraInvitacion = escribir(
            comoInvitacion(inv.tokenHash),
            sql`insert into membresia (empresa_id, persona_id, rol, invitacion_id)
                values (${e1.empresa}, ${suya.id}, 'OPERADOR', ${invA.id})`,
          );
          expect(await deOtraInvitacion).toEqual(DENEGADO);
          // Con todo en orden, entra; y no hay una segunda.
          expect(await altaDeMembresia(inv, e1.empresa, suya.id, "OPERADOR")).toEqual({
            ok: true,
            valor: 1,
          });
          expect(await altaDeMembresia(inv, e1.empresa, suya.id, "OPERADOR")).toEqual(
            unicidad("membresia_pkey"),
          );
        });

        it("con un token ajeno no se crea nada, aunque la invitación propia esté aceptada", async () => {
          const e1 = await crearEmpresaActiva(entorno);
          const inv = await crearInvitacionDeBase(dueno, { tenant: e1.tenant });
          await incluirEmpresa(dueno, inv, e1.empresa, "OPERADOR");
          const suya = await crearPersonaDeBase(dueno, inv.email);
          await aceptarDeBase(dueno, inv, suya.id);
          const ajeno = tokenAlAzar();
          expect(
            await escribir(
              comoInvitacion(ajeno.tokenHash),
              sql`insert into membresia (empresa_id, persona_id, rol, invitacion_id)
                  values (${e1.empresa}, ${suya.id}, 'OPERADOR', ${inv.id})`,
            ),
          ).toEqual(DENEGADO);
          // Ni siquiera con el token de OTRA invitación aceptada de la misma persona.
          const otra = await crearInvitacionDeBase(dueno, { tenant: e1.tenant, email: inv.email });
          await incluirEmpresa(dueno, otra, e1.empresa, "ADMINISTRADOR");
          await aceptarDeBase(dueno, otra, suya.id);
          expect(
            await escribir(
              comoInvitacion(otra.tokenHash),
              sql`insert into membresia (empresa_id, persona_id, rol, invitacion_id)
                  values (${e1.empresa}, ${suya.id}, 'OPERADOR', ${inv.id})`,
            ),
          ).toEqual(DENEGADO);
        });

        it("no hay membresía si la empresa o su tenant no operan", async () => {
          const suspendida = await crearEmpresaActiva(entorno);
          const sInv = await crearInvitacionDeBase(dueno, { tenant: suspendida.tenant });
          await incluirEmpresa(dueno, sInv, suspendida.empresa);
          const sPersona = await crearPersonaDeBase(dueno, sInv.email);
          await aceptarDeBase(dueno, sInv, sPersona.id);
          await dueno.query(
            "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
            [suspendida.empresa],
          );
          expect(await altaDeMembresia(sInv, suspendida.empresa, sPersona.id, "OPERADOR")).toEqual(
            DENEGADO,
          );

          const tenantSuspendido = await crearEmpresaActiva(entorno);
          const tInv = await crearInvitacionDeBase(dueno, { tenant: tenantSuspendido.tenant });
          await incluirEmpresa(dueno, tInv, tenantSuspendido.empresa);
          const tPersona = await crearPersonaDeBase(dueno, tInv.email);
          await aceptarDeBase(dueno, tInv, tPersona.id);
          await dueno.query(
            "update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
            [tenantSuspendido.tenant],
          );
          expect(
            await altaDeMembresia(tInv, tenantSuspendido.empresa, tPersona.id, "OPERADOR"),
          ).toEqual(DENEGADO);
        });

        it("la invitación de usuario a una empresa todavía en alta no habilita la membresía", async () => {
          const enAltaDePrueba = await crearEmpresaEnAlta(entorno);
          const inv = await crearInvitacionDeBase(dueno, { tenant: enAltaDePrueba.tenant });
          await incluirEmpresa(dueno, inv, enAltaDePrueba.empresa);
          const persona = await crearPersonaDeBase(dueno, inv.email);
          await aceptarDeBase(dueno, inv, persona.id);
          expect(
            await altaDeMembresia(inv, enAltaDePrueba.empresa, persona.id, "OPERADOR"),
          ).toEqual(DENEGADO);
        });

        it("las asignaciones salen solo de las sucursales que la invitación lista para esa empresa", async () => {
          const e1 = await crearEmpresaActiva(entorno);
          const extra = await dueno.query<{ id: string }>(
            "insert into sucursal (empresa_id, nombre) values ($1, 'Otra sucursal') returning id",
            [e1.empresa],
          );
          const listada = await sucursalDe(dueno, e1.empresa);
          const noListada = extra.rows[0]?.id as string;
          const inv = await crearInvitacionDeBase(dueno, { tenant: e1.tenant });
          await incluirEmpresa(dueno, inv, e1.empresa, "OPERADOR", [listada]);
          const persona = await aceptarComoInvitado(inv);
          expect(await altaDeMembresia(inv, e1.empresa, persona, "OPERADOR")).toEqual({
            ok: true,
            valor: 1,
          });
          const asignar = (sucursal: string, p = persona) =>
            escribir(
              comoInvitacion(inv.tokenHash),
              sql`insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id)
                  values (${e1.empresa}, ${p}, ${sucursal})`,
            );
          expect(await asignar(noListada)).toEqual(DENEGADO);
          expect(await asignar(await sucursalDe(dueno, a.empresa))).toEqual(DENEGADO);
          // La de otra persona (aunque la sucursal esté listada) tampoco.
          const ajena = await crearPersonaDeBase(dueno);
          await crearMembresiaDeBase(dueno, e1.empresa, ajena.id);
          expect(await asignar(listada, ajena.id)).toEqual(DENEGADO);
          expect(await asignar(listada)).toEqual({ ok: true, valor: 1 });
        });

        it("las asignaciones tampoco nacen antes de aceptar", async () => {
          const e1 = await crearEmpresaActiva(entorno);
          const inv = await crearInvitacionDeBase(dueno, { tenant: e1.tenant });
          const sucursal = await sucursalDe(dueno, e1.empresa);
          await incluirEmpresa(dueno, inv, e1.empresa, "OPERADOR", [sucursal]);
          const persona = await crearPersonaDeBase(dueno, inv.email);
          await crearMembresiaDeBase(dueno, e1.empresa, persona.id);
          expect(
            await escribir(
              comoInvitacion(inv.tokenHash),
              sql`insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id)
                  values (${e1.empresa}, ${persona.id}, ${sucursal})`,
            ),
          ).toEqual(DENEGADO);
        });

        it("reactiva una membresía y una asignación apagadas, solo con el mismo rol y una invitación aceptada", async () => {
          const e1 = await crearEmpresaActiva(entorno);
          const persona = await crearPersonaDeBase(dueno);
          await crearMembresiaDeBase(dueno, e1.empresa, persona.id, "OPERADOR", false);
          const sucursal = await sucursalDe(dueno, e1.empresa);
          await dueno.query(
            `insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id, activa)
             values ($1, $2, $3, false)`,
            [e1.empresa, persona.id, sucursal],
          );
          const reactivar = (inv: InvitacionDePrueba) =>
            escribir(
              comoInvitacion(inv.tokenHash),
              sql`update membresia set activo = true where empresa_id = ${e1.empresa} and persona_id = ${persona.id}`,
            );
          const reactivarAsignacion = (inv: InvitacionDePrueba) =>
            escribir(
              comoInvitacion(inv.tokenHash),
              sql`update asignacion_sucursal set activa = true where empresa_id = ${e1.empresa} and persona_id = ${persona.id}`,
            );

          // Sin aceptar: no ve la membresía, 0 filas.
          const pendiente = await crearInvitacionDeBase(dueno, {
            tenant: e1.tenant,
            email: persona.email,
          });
          await incluirEmpresa(dueno, pendiente, e1.empresa, "OPERADOR", [sucursal]);
          expect(await reactivar(pendiente)).toEqual({ ok: true, valor: 0 });
          expect(await reactivarAsignacion(pendiente)).toEqual({ ok: true, valor: 0 });
          await aceptarDeBase(dueno, pendiente, persona.id);
          // Aceptada, con el mismo rol: reactiva.
          expect(await reactivar(pendiente)).toEqual({ ok: true, valor: 1 });
          expect(await reactivarAsignacion(pendiente)).toEqual({ ok: true, valor: 1 });

          // Con OTRO rol en la invitación: rechazo (el rol no cambia nunca).
          await dueno.query("update membresia set activo = false where persona_id = $1", [
            persona.id,
          ]);
          const conOtroRol = await crearInvitacionDeBase(dueno, {
            tenant: e1.tenant,
            email: persona.email,
          });
          await incluirEmpresa(dueno, conOtroRol, e1.empresa, "ADMINISTRADOR");
          await aceptarDeBase(dueno, conOtroRol, persona.id);
          expect(await reactivar(conOtroRol)).toEqual(DENEGADO);
          const { rows } = await dueno.query<{ activo: boolean; rol: string }>(
            "select activo, rol from membresia where persona_id = $1",
            [persona.id],
          );
          expect(rows).toEqual([{ activo: false, rol: "OPERADOR" }]);
        });

        it("no puede apagar: solo reactiva lo apagado, y nunca lo de otra persona", async () => {
          const { inv, sucursal } = await invitarUsuario(a);
          const persona = await aceptarComoInvitado(inv);
          expect(await altaDeMembresia(inv, a.empresa, persona, "OPERADOR")).toEqual({
            ok: true,
            valor: 1,
          });
          const contexto = comoInvitacion(inv.tokenHash);
          await escribir(
            contexto,
            sql`insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id)
                values (${a.empresa}, ${persona}, ${sucursal})`,
          );
          expect(
            await escribir(
              contexto,
              sql`update membresia set activo = false where persona_id = ${persona}`,
            ),
          ).toEqual({ ok: true, valor: 0 });
          expect(
            await escribir(
              contexto,
              sql`update asignacion_sucursal set activa = false where persona_id = ${persona}`,
            ),
          ).toEqual({ ok: true, valor: 0 });
          // Ni la membresía ni la asignación de OTRA persona de la misma empresa.
          expect(
            await escribir(
              contexto,
              sql`update membresia set activo = false where persona_id = ${opA}`,
            ),
          ).toEqual({ ok: true, valor: 0 });
          const { rows } = await dueno.query<{ activo: boolean }>(
            "select activo from membresia where empresa_id = $1 and persona_id = any($2)",
            [a.empresa, [persona, opA]],
          );
          expect(rows.every((f) => f.activo)).toBe(true);
        });

        it("no puede ascender ni cambiar nada más que activo/activa", async () => {
          const { inv } = await invitarUsuario(a);
          const persona = await aceptarComoInvitado(inv);
          expect(await altaDeMembresia(inv, a.empresa, persona, "OPERADOR")).toEqual({
            ok: true,
            valor: 1,
          });
          // El rol (0005): sobre una membresía activa el invitado no ve nada que reactivar (0 filas);
          // sobre una apagada, el disparador lo frena (ver administracion-sql.test.ts).
          for (const consulta of [
            sql`update membresia set rol = 'GERENTE' where persona_id = ${persona}`,
            sql`update membresia set rol = 'ADMINISTRADOR' where persona_id = ${persona}`,
          ]) {
            expect(await escribir(comoInvitacion(inv.tokenHash), consulta)).toEqual({
              ok: true,
              valor: 0,
            });
          }
          for (const consulta of [
            sql`update membresia set invitacion_id = ${invA.id} where persona_id = ${persona}`,
            sql`update asignacion_sucursal set sucursal_id = sucursal_id where persona_id = ${persona}`,
          ]) {
            expect(await escribir(comoInvitacion(inv.tokenHash), consulta)).toEqual(DENEGADO);
          }
        });
      });

      describe("la auditoría de quien acepta", () => {
        const auditar = (inv: InvitacionDePrueba, empresa: string, actor: string | null) =>
          escribir(
            comoInvitacion(inv.tokenHash),
            sql`insert into auditoria_empresa (empresa_id, actor_persona_id, accion, entidad, entidad_id)
                values (${empresa}, ${actor}, 'INVITACION_ACEPTADA', 'invitacion', ${inv.id})`,
          );

        it("la escribe a su nombre y en las empresas de su invitación, no antes de aceptar", async () => {
          const e1 = await crearEmpresaActiva(entorno);
          const otraDelTenant = await crearEmpresaActiva(entorno, { tenant: e1.tenant });
          const inv = await crearInvitacionDeBase(dueno, { tenant: e1.tenant });
          await incluirEmpresa(dueno, inv, e1.empresa);
          const suya = await crearPersonaDeBase(dueno, inv.email);
          expect(await auditar(inv, e1.empresa, suya.id)).toEqual(DENEGADO);
          await aceptarDeBase(dueno, inv, suya.id);
          expect(await auditar(inv, e1.empresa, suya.id)).toEqual({ ok: true, valor: 1 });
          const ajena = await crearPersonaDeBase(dueno);
          expect(await auditar(inv, e1.empresa, ajena.id)).toEqual(DENEGADO);
          expect(await auditar(inv, e1.empresa, null)).toEqual(DENEGADO);
          expect(await auditar(inv, otraDelTenant.empresa, suya.id)).toEqual(DENEGADO);
          expect(await auditar(inv, b.empresa, suya.id)).toEqual(DENEGADO);
          // Y con el token de otra invitación, tampoco.
          expect(
            await escribir(
              comoInvitacion(invB.tokenHash),
              sql`insert into auditoria_empresa (empresa_id, actor_persona_id, accion, entidad, entidad_id)
                  values (${e1.empresa}, ${suya.id}, 'X', 'invitacion', ${inv.id})`,
            ),
          ).toEqual(DENEGADO);
        });

        it("no escribe en una empresa suspendida, y no puede leer ni modificar la auditoría", async () => {
          const e1 = await crearEmpresaActiva(entorno);
          const inv = await crearInvitacionDeBase(dueno, { tenant: e1.tenant });
          await incluirEmpresa(dueno, inv, e1.empresa);
          const suya = await crearPersonaDeBase(dueno, inv.email);
          await aceptarDeBase(dueno, inv, suya.id);
          expect(await auditar(inv, e1.empresa, suya.id)).toEqual({ ok: true, valor: 1 });
          expect(await contar(comoInvitacion(inv.tokenHash), "auditoria_empresa")).toBe(0);
          expect(
            await escribir(
              comoInvitacion(inv.tokenHash),
              sql`update auditoria_empresa set accion = 'x'`,
            ),
          ).toEqual(DENEGADO);
          await dueno.query(
            "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
            [e1.empresa],
          );
          expect(await auditar(inv, e1.empresa, suya.id)).toEqual(DENEGADO);
        });
      });

      describe("activar el alta del gerente", () => {
        const activar = (inv: InvitacionDePrueba, empresa: string) =>
          escribir(
            comoInvitacion(inv.tokenHash),
            sql`update empresa set estado = 'ACTIVE' where id = ${empresa} and estado = 'PROVISIONING'`,
          );
        const estadoDe = async (empresa: string) =>
          (
            await filas<{ estado: string }>("select estado from empresa where id = $1", [empresa])
          )[0]?.estado;

        it("recorre el alta completa: acepta, se crea el gerente, se activa la empresa y queda ACTIVE", async () => {
          const { empresa, inv } = await invitarGerente();
          const persona = await aceptarComoInvitado(inv);
          expect(await altaDeMembresia(inv, empresa.empresa, persona, "GERENTE")).toEqual({
            ok: true,
            valor: 1,
          });
          expect(
            await escribir(
              comoInvitacion(inv.tokenHash),
              sql`insert into auditoria_empresa (empresa_id, actor_persona_id, accion, entidad, entidad_id)
                  values (${empresa.empresa}, ${persona}, 'ALTA_ACEPTADA', 'invitacion', ${inv.id})`,
            ),
          ).toEqual({ ok: true, valor: 1 });
          expect(await estadoDe(empresa.empresa)).toBe("PROVISIONING");
          expect(await activar(inv, empresa.empresa)).toEqual({ ok: true, valor: 1 });
          expect(await estadoDe(empresa.empresa)).toBe("ACTIVE");
          // Y ya activa, la empresa deja de ser "pendiente de alta": no se repite.
          expect(await activar(inv, empresa.empresa)).toEqual({ ok: true, valor: 0 });
          // Aun con la empresa ACTIVE, un segundo gerente por esa misma invitación no entra.
          const otra = await crearPersonaDeBase(dueno);
          expect(await altaDeMembresia(inv, empresa.empresa, otra.id, "GERENTE")).toEqual(DENEGADO);
        });

        it("sin aceptación, o sin la membresía del gerente, no se activa nada", async () => {
          const { empresa, inv } = await invitarGerente();
          expect(await activar(inv, empresa.empresa)).toEqual({ ok: true, valor: 0 });
          const persona = await aceptarComoInvitado(inv);
          expect(await activar(inv, empresa.empresa)).toEqual({ ok: true, valor: 0 });
          // Con la membresía apagada tampoco.
          await crearMembresiaDeBase(dueno, empresa.empresa, persona, "GERENTE", false);
          expect(await activar(inv, empresa.empresa)).toEqual({ ok: true, valor: 0 });
          expect(await estadoDe(empresa.empresa)).toBe("PROVISIONING");
          await dueno.query("update membresia set activo = true where persona_id = $1", [persona]);
          expect(await activar(inv, empresa.empresa)).toEqual({ ok: true, valor: 1 });
        });

        it("una empresa ya activa, o suspendida después, no se activa (otra vez) con el token del alta", async () => {
          const { empresa, inv } = await invitarGerente();
          const persona = await aceptarComoInvitado(inv);
          await altaDeMembresia(inv, empresa.empresa, persona, "GERENTE");
          expect(await activar(inv, empresa.empresa)).toEqual({ ok: true, valor: 1 });
          const activarSinFiltro = () =>
            escribir(
              comoInvitacion(inv.tokenHash),
              sql`update empresa set estado = 'ACTIVE' where id = ${empresa.empresa}`,
            );
          // Ya está ACTIVE: no hay nada que activar.
          expect(await activarSinFiltro()).toEqual({ ok: true, valor: 0 });
          // La plataforma la suspende: el token del alta NO la reactiva.
          await dueno.query(
            "update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
            [empresa.empresa],
          );
          expect(await activarSinFiltro()).toEqual({ ok: true, valor: 0 });
          expect(await estadoDe(empresa.empresa)).toBe("SUSPENDED");
        });

        it("el gerente que activa es quien aceptó el alta: la membresía de otra persona no sirve", async () => {
          const { empresa, inv } = await invitarGerente();
          await aceptarComoInvitado(inv);
          const otro = await crearPersonaDeBase(dueno);
          await crearMembresiaDeBase(dueno, empresa.empresa, otro.id, "GERENTE");
          expect(await activar(inv, empresa.empresa)).toEqual({ ok: true, valor: 0 });
        });

        it("el alta solo habilita la membresía mientras la empresa está en alta y su tenant activo", async () => {
          // Empresa ya ACTIVE: la gerente apagada no se reactiva con el token del alta.
          const uno = await invitarGerente();
          const persona = await aceptarComoInvitado(uno.inv);
          await altaDeMembresia(uno.inv, uno.empresa.empresa, persona, "GERENTE");
          await activar(uno.inv, uno.empresa.empresa);
          // Un gerente no se apaga (0005): se arma la membresía del gerente apagado a mano.
          await dueno.query("delete from membresia where persona_id = $1", [persona]);
          await dueno.query(
            `insert into membresia (empresa_id, persona_id, rol, activo, invitacion_id)
             values ($1, $2, 'GERENTE', false, $3)`,
            [uno.empresa.empresa, persona, uno.inv.id],
          );
          expect(
            await escribir(
              comoInvitacion(uno.inv.tokenHash),
              sql`update membresia set activo = true where persona_id = ${persona}`,
            ),
          ).toEqual(DENEGADO);
          // Tenant suspendido: no se crea la membresía del gerente.
          const dos = await invitarGerente();
          const persona2 = await aceptarComoInvitado(dos.inv);
          await dueno.query(
            "update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
            [dos.empresa.tenant],
          );
          expect(await altaDeMembresia(dos.inv, dos.empresa.empresa, persona2, "GERENTE")).toEqual(
            DENEGADO,
          );
        });

        it("una membresía de otro rol no sirve para activar el alta", async () => {
          const { empresa, inv } = await invitarGerente();
          const persona = await aceptarComoInvitado(inv);
          await crearMembresiaDeBase(dueno, empresa.empresa, persona, "ADMINISTRADOR");
          expect(await activar(inv, empresa.empresa)).toEqual({ ok: true, valor: 0 });
        });

        it("el token de otra alta, o de una invitación de usuario, no activa esta empresa", async () => {
          const uno = await invitarGerente();
          const dos = await invitarGerente();
          const persona1 = await aceptarComoInvitado(uno.inv);
          await altaDeMembresia(uno.inv, uno.empresa.empresa, persona1, "GERENTE");
          const persona2 = await aceptarComoInvitado(dos.inv);
          await altaDeMembresia(dos.inv, dos.empresa.empresa, persona2, "GERENTE");
          // La dos, con el token de la uno: no ve la empresa dos.
          expect(await activar(uno.inv, dos.empresa.empresa)).toEqual({ ok: true, valor: 0 });
          expect(await estadoDe(dos.empresa.empresa)).toBe("PROVISIONING");

          // Una invitación de USUARIO aceptada que incluye una empresa en alta, con un GERENTE activo
          // sembrado a mano, tampoco activa: tiene que ser un ALTA_GERENTE.
          const e = await crearEmpresaEnAlta(entorno);
          const usuario = await crearInvitacionDeBase(dueno, { tenant: e.tenant });
          await incluirEmpresa(dueno, usuario, e.empresa, "ADMINISTRADOR");
          const p = await crearPersonaDeBase(dueno, usuario.email);
          await aceptarDeBase(dueno, usuario, p.id);
          await crearMembresiaDeBase(dueno, e.empresa, p.id, "GERENTE");
          expect(await activar(usuario, e.empresa)).toEqual({ ok: true, valor: 0 });
        });

        it("solo puede pasar de PROVISIONING a ACTIVE: no cancela, no suspende, no cambia otros datos", async () => {
          const { empresa, inv } = await invitarGerente();
          const persona = await aceptarComoInvitado(inv);
          await altaDeMembresia(inv, empresa.empresa, persona, "GERENTE");
          const contexto = comoInvitacion(inv.tokenHash);
          // Cancelar la empresa (una transición legal para el disparador) lo frena la política.
          expect(
            await escribir(
              contexto,
              sql`update empresa set estado = 'CANCELLED', motivo_estado = 'x' where id = ${empresa.empresa}`,
            ),
          ).toEqual(DENEGADO);
          // Activarla con un motivo cargado tampoco.
          expect(
            await escribir(
              contexto,
              sql`update empresa set estado = 'ACTIVE', motivo_estado = 'x' where id = ${empresa.empresa}`,
            ),
          ).toEqual(DENEGADO);
          for (const consulta of [
            sql`update empresa set razon_social = 'tomada' where id = ${empresa.empresa}`,
            sql`update empresa set cuit = '20123456786' where id = ${empresa.empresa}`,
            sql`update empresa set tenant_id = ${b.tenant} where id = ${empresa.empresa}`,
            sql`update empresa set zona_horaria = 'UTC' where id = ${empresa.empresa}`,
          ]) {
            expect(await escribir(contexto, consulta)).toEqual(DENEGADO);
          }
          expect(await estadoDe(empresa.empresa)).toBe("PROVISIONING");
        });

        it("con el tenant suspendido no se activa el alta", async () => {
          const { empresa, inv } = await invitarGerente();
          const persona = await aceptarComoInvitado(inv);
          await altaDeMembresia(inv, empresa.empresa, persona, "GERENTE");
          await dueno.query(
            "update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
            [empresa.tenant],
          );
          expect(await activar(inv, empresa.empresa)).toEqual({ ok: true, valor: 0 });
        });

        it("ningún contexto OPERATIVO activa nada, ni siquiera el de la empresa en alta, y las demás empresas no cambian de estado", async () => {
          const { empresa, inv } = await invitarGerente();
          const persona = await aceptarComoInvitado(inv);
          await altaDeMembresia(inv, empresa.empresa, persona, "GERENTE");
          const comoLaEmpresa = comoEmpresa(empresa.empresa, persona as never);
          expect(
            await escribir(
              comoLaEmpresa,
              sql`update empresa set estado = 'ACTIVE' where id = ${empresa.empresa}`,
            ),
          ).toEqual({ ok: true, valor: 0 });
          expect(await escribir(comoA(), sql`update empresa set estado = 'ACTIVE'`)).toEqual({
            ok: true,
            valor: 0,
          });
          expect(
            await escribir(
              comoA(),
              sql`update empresa set estado = 'SUSPENDED', motivo_estado = 'x' where id = ${a.empresa}`,
            ),
          ).toEqual({ ok: true, valor: 0 });
          expect(await estadoDe(empresa.empresa)).toBe("PROVISIONING");
          expect(await estadoDe(a.empresa)).toBe("ACTIVE");
        });
      });
    });

    describe("el resto de los roles", () => {
      it("grupo y trabajos no tienen acceso a ninguna de las tablas nuevas", async () => {
        const propietario = await crearPropietario(entorno, a.tenant);
        for (const [rol, contexto] of [
          ["grupo", comoGrupo(a.tenant, propietario)],
          ["trabajos", comoTrabajos()],
        ] as const) {
          for (const tabla of TABLAS_NUEVAS) {
            expect(
              await escribir(contexto, sql`select * from ${sql.table(tabla)}`),
              `${rol} lee ${tabla}`,
            ).toEqual(DENEGADO);
            expect(
              await escribir(
                contexto,
                sql`update ${sql.table(tabla)} set ${sql.ref(COLUMNA_CUALQUIERA[tabla])} = ${sql.ref(COLUMNA_CUALQUIERA[tabla])}`,
              ),
              `${rol} modifica ${tabla}`,
            ).toEqual(DENEGADO);
          }
        }
      });

      it("nadie borra: ni la aplicación, ni la plataforma, ni el invitado", async () => {
        for (const contexto of [comoA(), comoPlataforma(), comoInvitacion(invA.tokenHash)]) {
          for (const tabla of TABLAS_NUEVAS) {
            expect(
              await escribir(contexto, sql`delete from ${sql.table(tabla)}`),
              `${contexto.tipo} borra ${tabla}`,
            ).toEqual(DENEGADO);
          }
        }
      });

      it("la plataforma no lee las membresías completas (solo 4 columnas, 0004), ni asignaciones ni sucursales invitadas, pero sí las invitaciones", async () => {
        for (const tabla of ["membresia", "asignacion_sucursal", "invitacion_sucursal"]) {
          expect(
            await escribir(comoPlataforma(), sql`select * from ${sql.table(tabla)}`),
            tabla,
          ).toEqual(DENEGADO);
        }
        const ids = await leerUna(comoPlataforma(), "id", sql`select id from invitacion`);
        expect(ids).toEqual(
          expect.arrayContaining([invA.id, invB.id, invC.id, invAC.id, invAlta.id]),
        );
        expect(await contar(comoPlataforma(), "invitacion_empresa")).toBeGreaterThanOrEqual(6);
        expect(
          await escribir(
            comoPlataforma(),
            sql`insert into membresia (empresa_id, persona_id, rol) values (${a.empresa}, ${opB}, 'OPERADOR')`,
          ),
        ).toEqual(DENEGADO);
      });

      it("la plataforma emite y revoca altas de gerente, pero no las acepta", async () => {
        const e = await crearEmpresaEnAlta(entorno);
        const id = randomUUID();
        const { tokenHash } = tokenAlAzar();
        const email = emailAlAzar("gerente");
        const emitir = await entorno.ejecutar({ contexto: comoPlataforma() }, async ({ db }) => {
          await sql`insert into invitacion (id, tenant_id, tipo, email, token_hash, emitida_en, vence_en)
                    values (${id}, ${e.tenant}, 'ALTA_GERENTE', ${email}, ${tokenHash}, ${EMITIDA_EN}, ${VENCE_EN})`.execute(
            db,
          );
          await sql`insert into invitacion_empresa (invitacion_id, empresa_id, tenant_id, rol, email, token_hash, estado, tipo)
                    values (${id}, ${e.empresa}, ${e.tenant}, 'GERENTE', ${email}, ${tokenHash}, 'PENDIENTE', 'ALTA_GERENTE')`.execute(
            db,
          );
          return ok(null);
        });
        expect(emitir).toEqual({ ok: true, valor: null });
        const persona = await crearPersonaDeBase(dueno, email);
        expect(
          await escribir(
            comoPlataforma(),
            sql`update invitacion set estado = 'ACEPTADA', aceptada_por = ${persona.id}, aceptada_en = ${AHORA_DE_PRUEBA}
                where id = ${id}`,
          ),
        ).toEqual(DENEGADO);
        expect(
          await escribir(
            comoPlataforma(),
            sql`update invitacion set email = 'otro@x.com' where id = ${id}`,
          ),
        ).toEqual(DENEGADO);
        expect(
          await escribir(
            comoPlataforma(),
            sql`update invitacion set estado = 'REVOCADA', revocada_en = ${AHORA_DE_PRUEBA}, motivo_revocacion = 'cancelada'
                where id = ${id}`,
          ),
        ).toEqual({ ok: true, valor: 1 });
      });

      it("sin contexto firmado, la aplicación ve 0 filas de las tablas nuevas y no escribe", async () => {
        if (base === null) return;
        const cliente = new pg.Client({ connectionString: base.app });
        await cliente.connect();
        try {
          for (const tabla of TABLAS_NUEVAS) {
            const r = await cliente.query(`select count(*)::int as n from ${tabla}`);
            expect(r.rows[0], tabla).toEqual({ n: 0 });
          }
          await expect(
            cliente.query(
              "insert into membresia (empresa_id, persona_id, rol) values ($1, $2, 'OPERADOR')",
              [a.empresa, opB],
            ),
          ).rejects.toMatchObject({ code: "42501" });
          const r = await cliente.query(
            "update membresia set activo = false where empresa_id = $1",
            [a.empresa],
          );
          expect(r.rowCount).toBe(0);
        } finally {
          await cliente.end();
        }
      });

      it("un token de invitación vencido (firmado hace más de su vigencia) no ve nada", async () => {
        if (base === null) return;
        const { firmarCarga } = await import("../../src/adaptadores/postgres/contexto-firmado");
        const cliente = new pg.Client({ connectionString: base.app });
        await cliente.connect();
        try {
          await cliente.query("begin");
          const ahora = Math.floor(Date.now() / 1000);
          const token = firmarCarga(base.clave, {
            u: "zuluhub_app",
            e: null,
            t: null,
            p: null,
            i: invA.tokenHash,
            x: ahora - 5,
            a: null,
            s: null,
          });
          await cliente.query("select set_config('app.ctx', $1, true)", [token]);
          const r = await cliente.query("select count(*)::int as n from invitacion");
          expect(r.rows[0]).toEqual({ n: 0 });
          // Y el mismo token, vigente, sí ve la invitación (control positivo).
          const vigente = firmarCarga(base.clave, {
            u: "zuluhub_app",
            e: null,
            t: null,
            p: null,
            i: invA.tokenHash,
            x: ahora + 60,
            a: null,
            s: null,
          });
          await cliente.query("select set_config('app.ctx', $1, true)", [vigente]);
          const v = await cliente.query("select count(*)::int as n from invitacion");
          expect(v.rows[0]).toEqual({ n: 1 });
          // El hash de la invitación NO se puede fijar con una variable de usuario.
          await cliente.query("select set_config('app.ctx', '', true)");
          await cliente.query("select set_config('app.token_invitacion', $1, true)", [
            invA.tokenHash,
          ]);
          const sinFirma = await cliente.query("select count(*)::int as n from invitacion");
          expect(sinFirma.rows[0]).toEqual({ n: 0 });
        } finally {
          await cliente.query("rollback").catch(() => undefined);
          await cliente.end();
        }
      });
    });
  });
});
