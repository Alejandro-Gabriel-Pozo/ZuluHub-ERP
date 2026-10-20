import fc from "fast-check";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  CLAVES_DE_AUDITORIA,
  clavesNoPermitidas,
} from "../../src/plataforma/captacion/dominio/auditoria";
import {
  CLAVES_DE_ATRIBUCION,
  normalizarAtribucion,
} from "../../src/plataforma/captacion/dominio/atribucion";
import {
  CODIGOS_DE_PROVINCIA,
  FINALIDADES,
  FORMA_DE_VERSION,
  MOTIVOS_DE_RECHAZO,
  RUBROS,
} from "../../src/plataforma/captacion/dominio/catalogos";
import { MAXIMO_DE_ENVIOS } from "../../src/plataforma/captacion/dominio/envio";
import {
  ESTADOS_DE_SOLICITUD,
  TRANSICIONES_DE_SOLICITUD,
  estaAbierta,
  type EstadoDeSolicitud,
} from "../../src/plataforma/captacion/dominio/estados";
import { validarFormulario } from "../../src/plataforma/captacion/dominio/formulario";
import { ADMIN_DE_PRUEBA } from "./admins-de-prueba";
import { contar, crearSolicitud, filaDe } from "./captacion-apoyo";
import { AHORA_DE_PRUEBA } from "./entorno";
import { check, clave, denegado, intentoDelDueno, sinConfirmar } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import { crearMarca, crearMundoDeMarca, marcaPrincipal } from "./marcas-apoyo";

/**
 * Alta por solicitud (L1): lo que la migración de captación DECLARA (rol, privilegios exactos por columna,
 * políticas, funciones, disparadores, restricciones) y lo que las restricciones y los disparadores IMPONEN
 * aun al dueño de la base (PS-B1, PS-B2). Los privilegios y los contextos de cada rol real están en
 * `captacion-aislamiento.test.ts`; la concurrencia, en `captacion-concurrencia.test.ts`; la migración y su
 * reversión, en `captacion-migracion.test.ts`; los debilitamientos, en `captacion-debilitamientos.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000 });

const ROL = "pedernal_captacion";
const OTROS_ROLES = [
  "pedernal_app",
  "pedernal_grupo",
  "pedernal_trabajos",
  "pedernal_autenticacion",
  "pedernal_publico",
] as const;
const TABLAS = ["solicitud_de_alta", "limite_de_captacion"] as const;

const COLUMNAS_DE_SOLICITUD = [
  "id",
  "marca_id",
  "estado",
  "email",
  "nombre_contacto",
  "nombre_negocio",
  "telefono",
  "cuit",
  "id_de_medicion",
  "nota_interna",
  "rubro",
  "provincia",
  "atribucion",
  "finalidad",
  "version_de_terminos",
  "version_de_privacidad",
  "medicion_consentida",
  "version_de_aviso_de_medicion",
  "numero_de_envios",
  "ultimo_envio_en",
  "verificada_en",
  "decidida_por",
  "decidida_en",
  "motivo_de_rechazo",
  "empresa_creada_id",
  "anonimizada_en",
  "creada_en",
  "actualizado_en",
  "version",
] as const;
const COLUMNAS_DE_LIMITE = ["clave", "ventana", "ventana_inicio", "cuenta"] as const;

const LEE_LA_LANDING = [
  "id",
  "marca_id",
  "estado",
  "email",
  "numero_de_envios",
  "ultimo_envio_en",
  "verificada_en",
  "decidida_en",
  "motivo_de_rechazo",
  "medicion_consentida",
  "id_de_medicion",
  "atribucion",
  "rubro",
  "provincia",
  "anonimizada_en",
  "version",
  "creada_en",
] as const;
const CREA_LA_LANDING = [
  "marca_id",
  "email",
  "nombre_contacto",
  "nombre_negocio",
  "telefono",
  "cuit",
  "id_de_medicion",
  "rubro",
  "provincia",
  "atribucion",
  "version_de_terminos",
  "version_de_privacidad",
  "medicion_consentida",
  "version_de_aviso_de_medicion",
  "ultimo_envio_en",
  "creada_en",
] as const;
const CAMBIA_LA_LANDING = [
  "estado",
  "verificada_en",
  "numero_de_envios",
  "ultimo_envio_en",
] as const;
const DECIDE_LA_PLATAFORMA = [
  "estado",
  "decidida_por",
  "decidida_en",
  "motivo_de_rechazo",
  "nota_interna",
  "empresa_creada_id",
  "anonimizada_en",
  "email",
  "nombre_contacto",
  "nombre_negocio",
  "telefono",
  "cuit",
  "id_de_medicion",
  "atribucion",
] as const;

describe.skipIf(base === null)("captación: lo que la migración declara", () => {
  let dueno: pg.Client;
  beforeAll(async () => {
    dueno = new pg.Client({ connectionString: (base as BaseDePruebas).dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
  });

  const filas = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;

  describe("el séptimo rol, pedernal_captacion", () => {
    it("existe, sin superusuario, sin BYPASSRLS, sin pertenencias, sin objetos propios y con topes de tiempo", async () => {
      const r = await filas(
        `select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit, rolcanlogin
         from pg_roles where rolname = $1`,
        [ROL],
      );
      // En las pruebas tiene LOGIN (global.ts); la migración lo crea NOLOGIN (lo prueba captacion-migracion).
      expect(r).toEqual([
        {
          rolsuper: false,
          rolbypassrls: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolreplication: false,
          rolinherit: false,
          rolcanlogin: true,
        },
      ]);
      expect(
        await filas(
          `select 1 from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = $1`,
          [ROL],
        ),
      ).toEqual([]);
      expect(
        await filas(
          `select 1 from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = $1`,
          [ROL],
        ),
      ).toEqual([]);
      const topes = await filas<{ setconfig: string[] }>(
        `select s.setconfig from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
         where s.setdatabase = 0 and r.rolname = $1`,
        [ROL],
      );
      expect([...(topes[0]?.setconfig ?? [])].sort()).toEqual([
        "idle_in_transaction_session_timeout=60s",
        "lock_timeout=15s",
        "statement_timeout=30s",
      ]);
    });

    it("no crea objetos temporales ni en el esquema, y no crea nada en la base", async () => {
      const r = await filas<Record<string, boolean>>(
        `select has_database_privilege($1, current_database(), 'TEMP') as temp,
                has_database_privilege($1, current_database(), 'CREATE') as crear_en_base,
                has_schema_privilege($1, 'public', 'CREATE') as crear_en_esquema,
                has_schema_privilege($1, 'public', 'USAGE') as usar_esquema`,
        [ROL],
      );
      expect(r).toEqual([
        { temp: false, crear_en_base: false, crear_en_esquema: false, usar_esquema: true },
      ]);
    });
  });

  describe("privilegios exactos, por columna", () => {
    const columnasDe = async (grantee: string, privilegio: string) =>
      (
        await filas<{ t: string; c: string }>(
          `select table_name as t, column_name as c from information_schema.column_privileges
           where table_schema = 'public' and grantee = $1 and privilege_type = $2`,
          [grantee, privilegio],
        )
      )
        .map((f) => `${f.t}.${f.c}`)
        .sort();
    const todas = (tabla: string, columnas: readonly string[]) =>
      columnas.map((c) => `${tabla}.${c}`);

    it("la landing lee 17 columnas de la solicitud (no el nombre, el negocio, el teléfono, el CUIT ni la nota) y los contadores", async () => {
      expect(await columnasDe(ROL, "SELECT")).toEqual(
        [
          ...todas("solicitud_de_alta", LEE_LA_LANDING),
          ...todas("limite_de_captacion", COLUMNAS_DE_LIMITE),
        ].sort(),
      );
      for (const dato of [
        "nombre_contacto",
        "nombre_negocio",
        "telefono",
        "cuit",
        "nota_interna",
      ]) {
        expect(LEE_LA_LANDING as readonly string[], dato).not.toContain(dato);
      }
    });

    it("la landing crea una solicitud con 16 columnas (nunca el estado, los envíos ni la decisión), y encola y deja constancia", async () => {
      expect(await columnasDe(ROL, "INSERT")).toEqual(
        [
          ...todas("solicitud_de_alta", CREA_LA_LANDING),
          ...todas("trabajo", ["empresa_id", "tipo", "datos", "clave_idempotencia"]),
          ...todas("auditoria_plataforma", [
            "actor",
            "accion",
            "entidad",
            "entidad_id",
            "antes",
            "despues",
          ]),
          ...todas("limite_de_captacion", COLUMNAS_DE_LIMITE),
        ].sort(),
      );
    });

    it("la landing solo cambia el estado, la verificación y los envíos; y de los contadores, la cuenta", async () => {
      expect(await columnasDe(ROL, "UPDATE")).toEqual(
        [
          ...todas("solicitud_de_alta", CAMBIA_LA_LANDING),
          ...todas("limite_de_captacion", ["cuenta"]),
        ].sort(),
      );
    });

    it("la landing no tiene ningún privilegio sobre ninguna otra tabla, y de tabla entera solo SELECT y DELETE de los contadores", async () => {
      const tablas = await filas<{ t: string }>(
        `select distinct table_name as t from information_schema.column_privileges
         where table_schema = 'public' and grantee = $1`,
        [ROL],
      );
      expect(tablas.map((f) => f.t).sort()).toEqual([
        "auditoria_plataforma",
        "limite_de_captacion",
        "solicitud_de_alta",
        "trabajo",
      ]);
      const deTabla = await filas<{ t: string; p: string }>(
        `select table_name as t, privilege_type as p from information_schema.table_privileges
         where table_schema = 'public' and grantee = $1 order by 1, 2`,
        [ROL],
      );
      expect(deTabla).toEqual([
        { t: "limite_de_captacion", p: "DELETE" },
        { t: "limite_de_captacion", p: "SELECT" },
      ]);
    });

    it("el DELETE de los contadores es la única excepción: nadie más recibe DELETE ni TRUNCATE sobre las tablas nuevas", async () => {
      const r = await filas(
        `select grantee, table_name, privilege_type from information_schema.table_privileges
         where table_schema = 'public' and table_name = any($1)
           and (grantee like 'pedernal\\_%' escape '\\' or grantee = 'PUBLIC')
           and privilege_type in ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')`,
        [[...TABLAS]],
      );
      expect(r).toEqual([
        { grantee: ROL, table_name: "limite_de_captacion", privilege_type: "DELETE" },
      ]);
    });

    it("la plataforma lee toda la solicitud y cambia solo 14 columnas (decisión, anonimización y los datos que se anonimizan); no inserta ni borra", async () => {
      const suyas = (await columnasDe("pedernal_plataforma", "UPDATE")).filter((c) =>
        c.startsWith("solicitud_de_alta."),
      );
      expect(suyas).toEqual(todas("solicitud_de_alta", DECIDE_LA_PLATAFORMA).sort());
      expect(
        (await columnasDe("pedernal_plataforma", "SELECT")).filter((c) =>
          c.startsWith("solicitud_de_alta."),
        ),
      ).toEqual(todas("solicitud_de_alta", COLUMNAS_DE_SOLICITUD).sort());
      expect(
        (await columnasDe("pedernal_plataforma", "INSERT")).filter((c) =>
          /^(solicitud_de_alta|limite_de_captacion)\./.test(c),
        ),
      ).toEqual([]);
      expect(
        (await columnasDe("pedernal_plataforma", "SELECT")).filter((c) =>
          c.startsWith("limite_de_captacion."),
        ),
      ).toEqual([]);
      // nunca cambia lo que se congela al crear ni lo que solo mueve el contador de envíos
      for (const congelada of [
        "id",
        "marca_id",
        "creada_en",
        "finalidad",
        "rubro",
        "provincia",
        "version_de_terminos",
        "version_de_privacidad",
        "medicion_consentida",
        "version_de_aviso_de_medicion",
        "numero_de_envios",
        "ultimo_envio_en",
        "verificada_en",
        "version",
        "actualizado_en",
      ]) {
        expect(DECIDE_LA_PLATAFORMA as readonly string[], congelada).not.toContain(congelada);
      }
    });

    it("la aplicación, el grupo, los trabajos, la autenticación, el público y PUBLIC no tienen nada sobre las dos tablas", async () => {
      expect(
        await filas(
          `select grantee, column_name, privilege_type from information_schema.column_privileges
           where table_schema = 'public' and table_name = any($1) and grantee = any($2)`,
          [[...TABLAS], [...OTROS_ROLES, "PUBLIC"]],
        ),
      ).toEqual([]);
      expect(
        await filas(
          `select grantee, privilege_type from information_schema.table_privileges
           where table_schema = 'public' and table_name = any($1) and grantee = any($2)`,
          [[...TABLAS], [...OTROS_ROLES, "PUBLIC"]],
        ),
      ).toEqual([]);
    });
  });

  describe("aislamiento de filas", () => {
    it("las dos tablas tienen RLS activo y forzado", async () => {
      const r = await filas<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `select relname, relrowsecurity, relforcerowsecurity from pg_class
         where relnamespace = 'public'::regnamespace and relname = any($1) order by 1`,
        [[...TABLAS]],
      );
      expect(r).toEqual([
        { relname: "limite_de_captacion", relrowsecurity: true, relforcerowsecurity: true },
        { relname: "solicitud_de_alta", relrowsecurity: true, relforcerowsecurity: true },
      ]);
    });

    it("las políticas de la landing son exactamente estas doce, todas permisivas y cada una de un solo comando", async () => {
      const r = await filas<{ p: string }>(
        `select format('%s.%s:%s:%s', tablename, policyname, cmd, permissive) as p
         from pg_policies where schemaname = 'public' and $1 = any (roles) order by 1`,
        [ROL],
      );
      expect(r.map((f) => f.p).sort()).toEqual(
        [
          "auditoria_plataforma.auditoria_plataforma_captacion:INSERT:PERMISSIVE",
          "limite_de_captacion.limite_captacion_alta:INSERT:PERMISSIVE",
          "limite_de_captacion.limite_captacion_contar:UPDATE:PERMISSIVE",
          "limite_de_captacion.limite_captacion_leer:SELECT:PERMISSIVE",
          "limite_de_captacion.limite_captacion_purgar:DELETE:PERMISSIVE",
          "solicitud_de_alta.solicitud_captacion_alta:INSERT:PERMISSIVE",
          "solicitud_de_alta.solicitud_captacion_leer:SELECT:PERMISSIVE",
          "solicitud_de_alta.solicitud_captacion_verificar:UPDATE:PERMISSIVE",
          "trabajo.trabajo_captacion_aviso:INSERT:PERMISSIVE",
          "trabajo.trabajo_captacion_evento:INSERT:PERMISSIVE",
          "trabajo.trabajo_captacion_verificacion:INSERT:PERMISSIVE",
        ].sort(),
      );
    });

    it("sobre las dos tablas nuevas hay solo estas políticas: las de la landing y las cuatro de la plataforma", async () => {
      const r = await filas<{ p: string }>(
        `select format('%s.%s:%s:%s:%s', tablename, policyname, cmd, permissive, array_to_string(roles, '+')) as p
         from pg_policies where schemaname = 'public' and tablename = any($1) order by 1`,
        [[...TABLAS]],
      );
      expect(r.map((f) => f.p).sort()).toEqual(
        [
          "limite_de_captacion.limite_captacion_alta:INSERT:PERMISSIVE:pedernal_captacion",
          "limite_de_captacion.limite_captacion_contar:UPDATE:PERMISSIVE:pedernal_captacion",
          "limite_de_captacion.limite_captacion_leer:SELECT:PERMISSIVE:pedernal_captacion",
          "limite_de_captacion.limite_captacion_purgar:DELETE:PERMISSIVE:pedernal_captacion",
          "solicitud_de_alta.solicitud_captacion_alta:INSERT:PERMISSIVE:pedernal_captacion",
          "solicitud_de_alta.solicitud_captacion_leer:SELECT:PERMISSIVE:pedernal_captacion",
          "solicitud_de_alta.solicitud_captacion_verificar:UPDATE:PERMISSIVE:pedernal_captacion",
          "solicitud_de_alta.solicitud_plataforma_cambiar:UPDATE:PERMISSIVE:pedernal_plataforma",
          "solicitud_de_alta.solicitud_plataforma_con_actor:SELECT:RESTRICTIVE:pedernal_plataforma",
          "solicitud_de_alta.solicitud_plataforma_leer:SELECT:PERMISSIVE:pedernal_plataforma",
          "solicitud_de_alta.solicitud_plataforma_quien_cambia:UPDATE:RESTRICTIVE:pedernal_plataforma",
        ].sort(),
      );
    });

    it("las políticas de la landing exigen el contexto firmado: ninguna se evalúa sin app_captacion()", async () => {
      const r = await filas<{ policyname: string; texto: string }>(
        `select policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as texto
         from pg_policies where schemaname = 'public' and $1 = any (roles)`,
        [ROL],
      );
      expect(r).toHaveLength(11);
      for (const p of r) {
        // Cada política depende del contexto de captación (directo, o por una EXISTS sobre la solicitud, que
        // solo se ve con él): ninguna deja pasar a un rol sin contexto.
        expect(p.texto, p.policyname).toMatch(/app_captacion\(\)|solicitud_de_alta/);
      }
      // Postgres reescribe `(SELECT app_captacion()->>'m')` como `( SELECT (app_captacion() ->> 'm'::text))`: lo que
      // importa es que cada llamada esté DENTRO de una subconsulta, así se evalúa una vez por sentencia y no por fila.
      for (const p of r) {
        for (const llamada of p.texto.matchAll(/app_captacion\(\)/g)) {
          expect(
            /SELECT\s*\(?\s*$/.test(p.texto.slice(0, llamada.index)),
            `${p.policyname}: app_captacion() fuera de una subconsulta`,
          ).toBe(true);
        }
      }
    });
  });

  describe("estructura", () => {
    it("las columnas de la solicitud y de los contadores son estas, en este orden", async () => {
      const columnasDe = async (tabla: string) =>
        (
          await filas<{ column_name: string }>(
            `select column_name from information_schema.columns
             where table_schema = 'public' and table_name = $1 order by ordinal_position`,
            [tabla],
          )
        ).map((c) => c.column_name);
      expect(await columnasDe("solicitud_de_alta")).toEqual([...COLUMNAS_DE_SOLICITUD]);
      expect(await columnasDe("limite_de_captacion")).toEqual([...COLUMNAS_DE_LIMITE]);
    });

    it("la solicitud no lleva empresa_id (no es de ninguna empresa): la empresa creada es un resultado, empresa_creada_id", async () => {
      const r = await filas<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = any($1) and column_name in ('empresa_id', 'tenant_id')`,
        [[...TABLAS]],
      );
      expect(r).toEqual([]);
    });

    it("las restricciones, con su nombre", async () => {
      const r = await filas<{ t: string; n: string; tipo: string }>(
        `select conrelid::regclass::text as t, conname as n, contype as tipo from pg_constraint
         where conrelid = any(array['public.solicitud_de_alta', 'public.limite_de_captacion']::regclass[])
           and contype <> 'n'
         order by 1, 2`,
      );
      const nombres = (tabla: string) =>
        r.filter((x) => x.t === tabla).map((x) => `${x.n}:${x.tipo}`);
      expect(nombres("solicitud_de_alta")).toEqual(
        [
          "solicitud_de_alta_pkey:p",
          "solicitud_de_alta_marca_id_fkey:f",
          "solicitud_de_alta_empresa_creada_id_fkey:f",
          "solicitud_empresa_uk:u",
          ...[
            "estado",
            "email",
            "nombre",
            "negocio",
            "telefono",
            "cuit",
            "nota",
            "rubro",
            "provincia",
            "atribucion",
            "finalidad",
            "terminos",
            "privacidad",
            "aviso_medicion",
            "envios",
            "decidida_por",
            "motivo",
          ].map((n) => `solicitud_${n}_ck:c`),
          ...[
            "ultimo_envio",
            "alta",
            "verificada",
            "decision",
            "rechazo",
            "no_verificada",
            "personales",
            "medicion",
          ].map((n) => `solicitud_${n}_ck:c`),
        ].sort(),
      );
      expect(nombres("limite_de_captacion")).toEqual(
        [
          "limite_de_captacion_pkey:p",
          "limite_clave_ck:c",
          "limite_ventana_ck:c",
          "limite_cuenta_ck:c",
        ].sort(),
      );
    });

    it("los índices: la única parcial de las abiertas, y los dos de consulta", async () => {
      const r = await filas<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes
         where schemaname = 'public' and tablename = 'solicitud_de_alta' order by 1`,
      );
      expect(r.map((i) => i.indexname)).toEqual([
        "solicitud_abierta_uk",
        "solicitud_bandeja_ix",
        "solicitud_correo_ix",
        "solicitud_de_alta_pkey",
        "solicitud_empresa_uk",
      ]);
      const abierta = r.find((i) => i.indexname === "solicitud_abierta_uk")?.indexdef ?? "";
      expect(abierta).toMatch(
        /CREATE UNIQUE INDEX solicitud_abierta_uk ON public\.solicitud_de_alta/,
      );
      expect(abierta).toMatch(/\(marca_id, email\)/);
      // Postgres escribe el predicado con su forma canónica: los tres estados abiertos, y ningún otro.
      const estados = [...abierta.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
      expect(estados).toEqual(ESTADOS_DE_SOLICITUD.filter(estaAbierta).sort());
    });

    it("la auditoría de plataforma gana un único índice: a lo sumo una constancia de la landing por solicitud, acción y número de envío", async () => {
      const r = await filas<{ indexdef: string }>(
        `select indexdef from pg_indexes
         where schemaname = 'public' and tablename = 'auditoria_plataforma' and indexname like '%captacion%'`,
      );
      expect(r).toHaveLength(1);
      expect(r[0]?.indexdef).toMatch(/CREATE UNIQUE INDEX auditoria_plataforma_captacion_uk/);
      // Postgres escribe las expresiones a su manera según la versión: se mira lo que importa, no el formato
      expect(r[0]?.indexdef).toMatch(/\(entidad_id, accion, COALESCE\(/);
      expect(r[0]?.indexdef).toContain("numeroDeEnvio");
      expect(r[0]?.indexdef).toMatch(/WHERE \(actor = 'captacion'/);
    });

    it("los disparadores: validar el cambio, la versión, y nadie borra ni vacía", async () => {
      const r = await filas<{ t: string; n: string }>(
        `select c.relname as t, tg.tgname as n from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
         where not tg.tgisinternal and c.relname = any($1) order by 1, 2`,
        [[...TABLAS]],
      );
      expect(r).toEqual([
        { t: "limite_de_captacion", n: "limite_cuenta" },
        { t: "limite_de_captacion", n: "limite_sin_truncate" },
        { t: "solicitud_de_alta", n: "solicitud_cambio" },
        { t: "solicitud_de_alta", n: "solicitud_sin_borrado" },
        { t: "solicitud_de_alta", n: "solicitud_sin_truncate" },
        { t: "solicitud_de_alta", n: "solicitud_version" },
      ]);
    });

    it("las funciones nuevas: search_path fijo, ninguna SECURITY DEFINER, y cada una ejecutable solo por quien la necesita", async () => {
      const r = await filas<{
        proname: string;
        prosecdef: boolean;
        proconfig: string[];
        ejecutan: string[];
      }>(
        `select p.proname, p.prosecdef, p.proconfig,
                array(select r.rolname::text from pg_roles r
                       where r.rolname like 'pedernal\\_%' escape '\\' and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
                       order by 1) as ejecutan
         from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname in ('app_captacion', 'atribucion_valida', 'datos_de_auditoria_de_captacion_validos',
                             'solicitud_validar_cambio', 'limite_validar_cambio')
         order by 1`,
      );
      expect(r.map((f) => f.proname)).toEqual([
        "app_captacion",
        "atribucion_valida",
        "datos_de_auditoria_de_captacion_validos",
        "limite_validar_cambio",
        "solicitud_validar_cambio",
      ]);
      for (const f of r) {
        expect(f.prosecdef, `${f.proname} no es SECURITY DEFINER`).toBe(false);
        expect(f.proconfig, f.proname).toContain("search_path=pg_catalog, public, pg_temp");
      }
      const ejecutan = (nombre: string) => r.find((f) => f.proname === nombre)?.ejecutan;
      expect(ejecutan("app_captacion")).toEqual([ROL]);
      expect(ejecutan("atribucion_valida")).toEqual([ROL, "pedernal_plataforma"]);
      expect(ejecutan("datos_de_auditoria_de_captacion_validos")).toEqual([ROL]);
      // las de disparador no las ejecuta nadie directamente
      expect(ejecutan("solicitud_validar_cambio")).toEqual([]);
      expect(ejecutan("limite_validar_cambio")).toEqual([]);
    });

    it("la landing ejecuta contexto_firmado() y cuit_valido(), y nada de las funciones del actor de plataforma", async () => {
      const r = await filas<{ f: string; puede: boolean }>(
        `select f, has_function_privilege($1, f::regprocedure, 'EXECUTE') as puede
         from unnest(array[
           'public.contexto_firmado()', 'public.cuit_valido(text)', 'public.app_actor_plataforma()',
           'public.admin_plataforma_con_rol(text[])', 'public.plataforma_actor_vigente()',
           'public.app_empresa_id()', 'public.empresa_operable(uuid)'
         ]) as f`,
        [ROL],
      );
      expect(Object.fromEntries(r.map((x) => [x.f, x.puede]))).toEqual({
        "public.contexto_firmado()": true,
        "public.cuit_valido(text)": true,
        "public.app_actor_plataforma()": false,
        "public.admin_plataforma_con_rol(text[])": false,
        "public.plataforma_actor_vigente()": false,
        "public.app_empresa_id()": false,
        "public.empresa_operable(uuid)": false,
      });
    });
  });
});

// ============================================================================================================
// Lo que la base impone aun al dueño (restricciones y disparadores)
// ============================================================================================================

type Valores = Record<string, unknown>;

/** Una fila NUEVA válida, con las columnas que la landing puede dar. */
function filaNueva(marca: string, cambios: Valores = {}): Valores {
  return {
    marca_id: marca,
    email: `s${Math.random().toString(16).slice(2, 12)}@prueba.test`,
    nombre_contacto: "Ana Pérez",
    nombre_negocio: "Café Central",
    telefono: null,
    cuit: null,
    id_de_medicion: null,
    rubro: "cafeteria",
    provincia: "AR-B",
    atribucion: {},
    version_de_terminos: "2026-10-13",
    version_de_privacidad: "2026-10-13.1",
    medicion_consentida: false,
    version_de_aviso_de_medicion: null,
    ultimo_envio_en: AHORA_DE_PRUEBA,
    creada_en: AHORA_DE_PRUEBA,
    ...cambios,
  };
}

async function insertar(c: pg.Client, valores: Valores) {
  const columnas = Object.keys(valores);
  const marcadores = columnas.map((col, i) => `$${i + 1}${col === "atribucion" ? "::jsonb" : ""}`);
  const parametros = columnas.map((col) =>
    col === "atribucion" ? JSON.stringify(valores[col]) : valores[col],
  );
  return intentoDelDueno(
    c,
    `insert into solicitud_de_alta (${columnas.join(", ")}) values (${marcadores.join(", ")}) returning id`,
    parametros,
  );
}

describe.skipIf(base === null)(
  "captación: las restricciones de la solicitud (aun para el dueño)",
  () => {
    let dueno: pg.Client;
    let marca: string;
    beforeAll(async () => {
      dueno = new pg.Client({ connectionString: (base as BaseDePruebas).dueno });
      await dueno.connect();
      marca = await marcaPrincipal(dueno);
    });
    afterAll(async () => {
      await dueno.end();
    });

    it("una fila mínima nace NUEVA, con la finalidad evaluar el alta, un envío y la versión 1", async () => {
      await sinConfirmar(dueno, async () => {
        const r = await insertar(dueno, filaNueva(marca));
        expect(r.ok, JSON.stringify(r)).toBe(true);
        const id = (r.ok ? r.rows[0]?.["id"] : "") as string;
        const fila = await filaDe(dueno, id);
        expect(fila).toMatchObject({
          estado: "NUEVA",
          finalidad: "EVALUAR_ALTA",
          numero_de_envios: 1,
          version: 1,
          verificada_en: null,
          decidida_por: null,
          decidida_en: null,
          motivo_de_rechazo: null,
          empresa_creada_id: null,
          anonimizada_en: null,
          nota_interna: null,
        });
      });
    });

    // Cada caso rompe UNA restricción y trae su nombre: ni una pasa en silencio ni se confunden entre sí.
    const largo = (n: number, c = "a") => c.repeat(n);
    const CASOS: ReadonlyArray<readonly [string, Valores, string]> = [
      ["correo con mayúsculas", { email: "Ana@prueba.test" }, "solicitud_email_ck"],
      ["correo con un espacio", { email: "a na@prueba.test" }, "solicitud_email_ck"],
      [
        "correo con un salto de línea (cabecera de correo)",
        { email: "ana@prueba.test\nbcc:x@y.z" },
        "solicitud_email_ck",
      ],
      ["correo sin arroba", { email: "ana.prueba.test" }, "solicitud_email_ck"],
      ["correo con la arroba al principio", { email: "@prueba.test" }, "solicitud_email_ck"],
      ["correo con la arroba al final", { email: "ana@" }, "solicitud_email_ck"],
      ["correo con una letra fuera de ASCII", { email: "añana@prueba.test" }, "solicitud_email_ck"],
      [
        "correo de 255 caracteres",
        { email: `${largo(64)}@${largo(63, "b")}.${largo(63, "c")}.${largo(57, "d")}.comx` },
        "solicitud_email_ck",
      ],
      ["correo de un solo carácter", { email: "a" }, "solicitud_email_ck"],
      ["nombre con un espacio al principio", { nombre_contacto: " Ana" }, "solicitud_nombre_ck"],
      ["nombre con un espacio al final", { nombre_contacto: "Ana " }, "solicitud_nombre_ck"],
      ["nombre vacío", { nombre_contacto: "" }, "solicitud_nombre_ck"],
      ["nombre de 81 caracteres", { nombre_contacto: largo(81) }, "solicitud_nombre_ck"],
      ["negocio con un espacio al final", { nombre_negocio: "Café " }, "solicitud_negocio_ck"],
      ["negocio vacío", { nombre_negocio: "" }, "solicitud_negocio_ck"],
      ["negocio de 101 caracteres", { nombre_negocio: largo(101) }, "solicitud_negocio_ck"],
      ["teléfono corto", { telefono: "1234567" }, "solicitud_telefono_ck"],
      ["teléfono con letras", { telefono: "12345678a" }, "solicitud_telefono_ck"],
      ["teléfono de 16 dígitos", { telefono: "1234567890123456" }, "solicitud_telefono_ck"],
      ["teléfono con espacios", { telefono: "11 1234 5678" }, "solicitud_telefono_ck"],
      ["CUIT con el dígito verificador malo", { cuit: "30703088535" }, "solicitud_cuit_ck"],
      [
        "CUIT con guiones (se guarda solo con dígitos)",
        { cuit: "30-70308853-4" },
        "solicitud_cuit_ck",
      ],
      ["nota vacía", { nota_interna: "   " }, "solicitud_nota_ck"],
      ["nota de 301 caracteres", { nota_interna: largo(301) }, "solicitud_nota_ck"],
      ["rubro con mayúsculas", { rubro: "Cafeteria" }, "solicitud_rubro_ck"],
      ["rubro de una letra", { rubro: "a" }, "solicitud_rubro_ck"],
      ["rubro con un número", { rubro: "bar2" }, "solicitud_rubro_ck"],
      ["rubro de 41 caracteres", { rubro: largo(41) }, "solicitud_rubro_ck"],
      ["provincia en minúsculas", { provincia: "ar-b" }, "solicitud_provincia_ck"],
      ["provincia con dos letras", { provincia: "AR-BA" }, "solicitud_provincia_ck"],
      ["atribución que no es un objeto", { atribucion: ["utm_source"] }, "solicitud_atribucion_ck"],
      [
        "atribución con una clave que no es de la lista",
        { atribucion: { gclid: "x" } },
        "solicitud_atribucion_ck",
      ],
      [
        "atribución con un valor numérico",
        { atribucion: { utm_source: 1 } },
        "solicitud_atribucion_ck",
      ],
      [
        "atribución con un valor vacío",
        { atribucion: { utm_source: "" } },
        "solicitud_atribucion_ck",
      ],
      [
        "atribución con un espacio",
        { atribucion: { utm_source: "a b" } },
        "solicitud_atribucion_ck",
      ],
      [
        "atribución con un valor de 201 caracteres",
        { atribucion: { utm_term: largo(201) } },
        "solicitud_atribucion_ck",
      ],
      [
        "atribución con un correo adentro",
        { atribucion: { utm_content: "ana@x.com" } },
        "solicitud_atribucion_ck",
      ],
      ["otra finalidad", { finalidad: "PUBLICIDAD" }, "solicitud_finalidad_ck"],
      ["términos sin día", { version_de_terminos: "2026-10" }, "solicitud_terminos_ck"],
      [
        "términos con un sufijo de cuatro dígitos",
        { version_de_terminos: "2026-10-13.1234" },
        "solicitud_terminos_ck",
      ],
      ["privacidad con letras", { version_de_privacidad: "v1" }, "solicitud_privacidad_ck"],
      [
        "aviso de medición con otra forma",
        { medicion_consentida: true, version_de_aviso_de_medicion: "hoy" },
        "solicitud_aviso_medicion_ck",
      ],
      ["cero envíos", { numero_de_envios: 0 }, "solicitud_envios_ck"],
      ["seis envíos", { numero_de_envios: 6 }, "solicitud_envios_ck"],
      [
        "último envío anterior a la recepción",
        { ultimo_envio_en: new Date(AHORA_DE_PRUEBA.getTime() - 1) },
        "solicitud_ultimo_envio_ck",
      ],
      [
        "decidida por alguien que no es un uuid ni el sistema",
        { estado: "SPAM", decidida_por: "admin", decidida_en: AHORA_DE_PRUEBA },
        "solicitud_decidida_por_ck",
      ],
      [
        "un estado que no existe",
        {
          estado: "BORRADA",
          verificada_en: AHORA_DE_PRUEBA,
          decidida_por: ADMIN_DE_PRUEBA,
          decidida_en: AHORA_DE_PRUEBA,
        },
        "solicitud_estado_ck",
      ],
      [
        "un motivo que no es de la lista",
        {
          estado: "RECHAZADA",
          motivo_de_rechazo: "PORQUE_SI",
          decidida_por: ADMIN_DE_PRUEBA,
          decidida_en: AHORA_DE_PRUEBA,
        },
        "solicitud_motivo_ck",
      ],
    ];

    it.each(CASOS)("rechaza %s", async (_nombre, cambios, restriccion) => {
      await sinConfirmar(dueno, async () => {
        check(await insertar(dueno, filaNueva(marca, cambios)), restriccion);
      });
    });

    it("acepta los valores del borde de cada forma (200 en la atribución, 80 y 100 en los nombres, 254 en el correo)", async () => {
      await sinConfirmar(dueno, async () => {
        const dominio = `${largo(63, "b")}.${largo(63, "c")}.${largo(57, "d")}.com`;
        for (const cambios of [
          { nombre_contacto: largo(80) },
          { nombre_negocio: largo(100) },
          { email: `${largo(64)}@${dominio}` },
          { telefono: "12345678" },
          { telefono: "+123456789012345" },
          { cuit: "30703088534" },
          { nota_interna: largo(300) },
          { rubro: largo(40) },
          { rubro: "aa" },
          { numero_de_envios: 5 },
          { numero_de_envios: 1 },
          { version_de_terminos: "2026-10-13.123" },
          { atribucion: { utm_term: largo(200) } },
          {
            atribucion: {
              utm_source: "a-b_c.d~e",
              utm_medium: "x",
              utm_campaign: "y",
              utm_content: "z",
              utm_term: "w",
            },
          },
        ] as Valores[]) {
          const r = await insertar(dueno, filaNueva(marca, cambios));
          expect(r.ok, JSON.stringify(cambios).slice(0, 80)).toBe(true);
        }
      });
    });

    // ---- las restricciones que relacionan columnas --------------------------------------------------------

    const ADMIN = ADMIN_DE_PRUEBA;
    const CRUZADOS: ReadonlyArray<readonly [string, Valores, string]> = [
      [
        "ALTA_CREADA sin empresa creada",
        {
          estado: "ALTA_CREADA",
          verificada_en: AHORA_DE_PRUEBA,
          decidida_por: ADMIN,
          decidida_en: AHORA_DE_PRUEBA,
        },
        "solicitud_alta_ck",
      ],
      [
        "empresa creada en una solicitud que no es ALTA_CREADA",
        { empresa_creada_id: "00000000-0000-4000-8000-0000000000aa" },
        "solicitud_alta_ck",
      ],
      [
        "NUEVA con fecha de verificación",
        { verificada_en: AHORA_DE_PRUEBA },
        "solicitud_verificada_ck",
      ],
      ["VERIFICADA sin fecha de verificación", { estado: "VERIFICADA" }, "solicitud_verificada_ck"],
      [
        "APROBADA sin fecha de verificación",
        { estado: "APROBADA", decidida_por: ADMIN, decidida_en: AHORA_DE_PRUEBA },
        "solicitud_verificada_ck",
      ],
      [
        "VERIFICADA ya decidida",
        {
          estado: "VERIFICADA",
          verificada_en: AHORA_DE_PRUEBA,
          decidida_por: ADMIN,
          decidida_en: AHORA_DE_PRUEBA,
        },
        "solicitud_decision_ck",
      ],
      [
        "NUEVA ya decidida",
        { decidida_por: ADMIN, decidida_en: AHORA_DE_PRUEBA },
        "solicitud_decision_ck",
      ],
      [
        "APROBADA sin decisión",
        { estado: "APROBADA", verificada_en: AHORA_DE_PRUEBA },
        "solicitud_decision_ck",
      ],
      ["SPAM sin decisión", { estado: "SPAM" }, "solicitud_decision_ck"],
      [
        "SPAM con quién pero sin cuándo",
        { estado: "SPAM", decidida_por: ADMIN },
        "solicitud_decision_ck",
      ],
      [
        "SPAM con cuándo pero sin quién",
        { estado: "SPAM", decidida_en: AHORA_DE_PRUEBA },
        "solicitud_decision_ck",
      ],
      [
        "RECHAZADA sin motivo",
        { estado: "RECHAZADA", decidida_por: ADMIN, decidida_en: AHORA_DE_PRUEBA },
        "solicitud_rechazo_ck",
      ],
      [
        "un motivo en una solicitud que no está rechazada",
        {
          estado: "SPAM",
          motivo_de_rechazo: "OTRO",
          decidida_por: ADMIN,
          decidida_en: AHORA_DE_PRUEBA,
        },
        "solicitud_rechazo_ck",
      ],
      [
        "NO_VERIFICADA decidida por un administrador",
        {
          estado: "RECHAZADA",
          motivo_de_rechazo: "NO_VERIFICADA",
          decidida_por: ADMIN,
          decidida_en: AHORA_DE_PRUEBA,
        },
        "solicitud_no_verificada_ck",
      ],
      [
        "NO_VERIFICADA de una solicitud que sí se verificó",
        {
          estado: "RECHAZADA",
          motivo_de_rechazo: "NO_VERIFICADA",
          verificada_en: AHORA_DE_PRUEBA,
          decidida_por: "sistema",
          decidida_en: AHORA_DE_PRUEBA,
        },
        "solicitud_no_verificada_ck",
      ],
      [
        "anonimizada sin ser terminal",
        {
          anonimizada_en: AHORA_DE_PRUEBA,
          email: null,
          nombre_contacto: null,
          nombre_negocio: null,
        },
        "solicitud_personales_ck",
      ],
      [
        "terminal anonimizada que conserva el correo",
        {
          estado: "SPAM",
          decidida_por: ADMIN,
          decidida_en: AHORA_DE_PRUEBA,
          anonimizada_en: AHORA_DE_PRUEBA,
          nombre_contacto: null,
          nombre_negocio: null,
        },
        "solicitud_personales_ck",
      ],
      [
        "terminal anonimizada que conserva el teléfono",
        {
          estado: "SPAM",
          decidida_por: ADMIN,
          decidida_en: AHORA_DE_PRUEBA,
          anonimizada_en: AHORA_DE_PRUEBA,
          email: null,
          nombre_contacto: null,
          nombre_negocio: null,
          telefono: "+5491112345678",
        },
        "solicitud_personales_ck",
      ],
      [
        "terminal anonimizada que conserva el CUIT",
        {
          estado: "SPAM",
          decidida_por: ADMIN,
          decidida_en: AHORA_DE_PRUEBA,
          anonimizada_en: AHORA_DE_PRUEBA,
          email: null,
          nombre_contacto: null,
          nombre_negocio: null,
          cuit: "30703088534",
        },
        "solicitud_personales_ck",
      ],
      [
        "terminal anonimizada que conserva el fbclid",
        {
          estado: "SPAM",
          decidida_por: ADMIN,
          decidida_en: AHORA_DE_PRUEBA,
          anonimizada_en: AHORA_DE_PRUEBA,
          email: null,
          nombre_contacto: null,
          nombre_negocio: null,
          medicion_consentida: true,
          version_de_aviso_de_medicion: "2026-11-01",
          atribucion: { fbclid: "abc" },
        },
        "solicitud_personales_ck",
      ],
      ["sin anonimizar sin correo", { email: null }, "solicitud_personales_ck"],
      ["sin anonimizar sin nombre", { nombre_contacto: null }, "solicitud_personales_ck"],
      ["sin anonimizar sin negocio", { nombre_negocio: null }, "solicitud_personales_ck"],
      [
        "fbclid sin consentimiento de medición",
        { atribucion: { fbclid: "abc" } },
        "solicitud_medicion_ck",
      ],
      [
        "identificador de medición sin consentimiento",
        { id_de_medicion: "11111111-1111-4111-8111-111111111111" },
        "solicitud_medicion_ck",
      ],
      [
        "consentimiento sin versión del aviso",
        { medicion_consentida: true },
        "solicitud_medicion_ck",
      ],
      [
        "versión del aviso sin consentimiento",
        { version_de_aviso_de_medicion: "2026-11-01" },
        "solicitud_medicion_ck",
      ],
    ];

    it.each(CRUZADOS)("rechaza %s", async (_nombre, cambios, restriccion) => {
      await sinConfirmar(dueno, async () => {
        const r = await insertar(dueno, filaNueva(marca, cambios));
        if (restriccion === "solicitud_alta_ck" && "empresa_creada_id" in cambios) {
          // la empresa inventada no existe: la clave foránea la frena antes de que el CHECK la mire
          expect(r.ok).toBe(false);
          return;
        }
        check(r, restriccion);
      });
    });

    it("con consentimiento de medición sí guarda el identificador, el fbclid y la versión del aviso", async () => {
      await sinConfirmar(dueno, async () => {
        const r = await insertar(
          dueno,
          filaNueva(marca, {
            medicion_consentida: true,
            version_de_aviso_de_medicion: "2026-11-01",
            id_de_medicion: "11111111-1111-4111-8111-111111111111",
            atribucion: { fbclid: "IwAR0abc", utm_source: "meta" },
          }),
        );
        expect(r.ok).toBe(true);
      });
    });

    it("la marca tiene que existir (clave foránea) y una empresa creada también", async () => {
      await sinConfirmar(dueno, async () => {
        const r = await insertar(dueno, filaNueva("00000000-0000-4000-8000-0000000000bb"));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.codigo).toBe("23503");
      });
    });

    // ---- una sola abierta por correo y marca --------------------------------------------------------------

    it("solicitud_abierta_uk: dos abiertas del mismo correo y marca no conviven, en ninguna de las nueve combinaciones de estados abiertos", async () => {
      const abiertos: EstadoDeSolicitud[] = ESTADOS_DE_SOLICITUD.filter(estaAbierta);
      expect(abiertos).toHaveLength(3);
      const camposDe = (estado: EstadoDeSolicitud): Valores => ({
        estado,
        ...(estado === "NUEVA" ? {} : { verificada_en: AHORA_DE_PRUEBA }),
        ...(estado === "APROBADA"
          ? { decidida_por: ADMIN_DE_PRUEBA, decidida_en: AHORA_DE_PRUEBA }
          : {}),
      });
      for (const primero of abiertos) {
        for (const segundo of abiertos) {
          await sinConfirmar(dueno, async () => {
            const email = `dup${Math.random().toString(16).slice(2, 10)}@prueba.test`;
            expect(
              (await insertar(dueno, filaNueva(marca, { email, ...camposDe(primero) }))).ok,
            ).toBe(true);
            clave(
              await insertar(dueno, filaNueva(marca, { email, ...camposDe(segundo) })),
              "solicitud_abierta_uk",
            );
          });
        }
      }
    });

    it("solicitud_abierta_uk: cerradas, todas las que se quiera; y con una cerrada puede volver a pedir; otra marca u otro correo, siempre", async () => {
      await sinConfirmar(dueno, async () => {
        const email = `ok${Math.random().toString(16).slice(2, 10)}@prueba.test`;
        for (const estado of ["RECHAZADA", "SPAM", "ALTA_CREADA", "RECHAZADA", "SPAM"] as const) {
          await crearSolicitud(dueno, { estado, email, marca });
        }
        // con tres cerradas y ninguna abierta, entra una abierta
        await crearSolicitud(dueno, { estado: "NUEVA", email, marca });
        // y otra marca con el mismo correo, o la misma con otro correo
        const otraMarca = await crearMarca(dueno);
        await crearSolicitud(dueno, { estado: "NUEVA", email, marca: otraMarca });
        await crearSolicitud(dueno, { estado: "NUEVA", marca });
      });
    });

    it("solicitud_abierta_uk: al cerrar la abierta (rechazarla) queda libre el lugar", async () => {
      await sinConfirmar(dueno, async () => {
        const email = `lib${Math.random().toString(16).slice(2, 10)}@prueba.test`;
        const a = await crearSolicitud(dueno, { estado: "NUEVA", email, marca });
        await dueno.query(
          `update solicitud_de_alta set estado = 'RECHAZADA', motivo_de_rechazo = 'OTRO', decidida_por = $2,
                decidida_en = $3 where id = $1`,
          [a.id, ADMIN, AHORA_DE_PRUEBA],
        );
        await crearSolicitud(dueno, { estado: "NUEVA", email, marca });
      });
    });
  },
);

// ============================================================================================================
// Los disparadores
// ============================================================================================================

describe.skipIf(base === null)(
  "captación: los disparadores de la solicitud (aun para el dueño)",
  () => {
    let dueno: pg.Client;
    let marca: string;
    beforeAll(async () => {
      dueno = new pg.Client({ connectionString: (base as BaseDePruebas).dueno });
      await dueno.connect();
      marca = await marcaPrincipal(dueno);
    });
    afterAll(async () => {
      await dueno.end();
    });

    const ADMIN = ADMIN_DE_PRUEBA;
    const T = AHORA_DE_PRUEBA;
    /** Los parámetros que el texto realmente usa (Postgres rechaza los que sobran). */
    const parametrosDe = (texto: string, todos: unknown[]) =>
      todos.slice(0, Math.max(...[...texto.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]))));

    /** Lo que hay que cambiar para llegar a `hasta`, de forma que ninguna CHECK lo frene (solo el disparador). */
    const SET_PARA: Record<EstadoDeSolicitud, string> = {
      NUEVA:
        "estado = 'NUEVA', verificada_en = null, decidida_por = null, decidida_en = null, motivo_de_rechazo = null, empresa_creada_id = null",
      VERIFICADA:
        "estado = 'VERIFICADA', verificada_en = coalesce(verificada_en, $2::timestamptz), decidida_por = null, decidida_en = null, motivo_de_rechazo = null, empresa_creada_id = null",
      APROBADA:
        "estado = 'APROBADA', verificada_en = coalesce(verificada_en, $2::timestamptz), decidida_por = $3, decidida_en = $2::timestamptz, motivo_de_rechazo = null, empresa_creada_id = null",
      ALTA_CREADA:
        "estado = 'ALTA_CREADA', verificada_en = coalesce(verificada_en, $2::timestamptz), decidida_por = $3, decidida_en = $2::timestamptz, motivo_de_rechazo = null, empresa_creada_id = $4",
      RECHAZADA:
        "estado = 'RECHAZADA', decidida_por = $3, decidida_en = $2::timestamptz, motivo_de_rechazo = 'OTRO', empresa_creada_id = null",
      SPAM: "estado = 'SPAM', decidida_por = $3, decidida_en = $2::timestamptz, motivo_de_rechazo = null, empresa_creada_id = null",
    };

    it("la base permite exactamente las transiciones de TRANSICIONES_DE_SOLICITUD (los 30 pares), y las prohibidas dan solicitud_transicion_invalida", async () => {
      for (const desde of ESTADOS_DE_SOLICITUD) {
        for (const hasta of ESTADOS_DE_SOLICITUD) {
          if (desde === hasta) continue;
          await sinConfirmar(dueno, async () => {
            const s = await crearSolicitud(dueno, { estado: desde, marca });
            const empresa = (await crearMundoDeMarca(dueno, { marca })).empresa;
            const texto = `update solicitud_de_alta set ${SET_PARA[hasta]} where id = $1`;
            const r = await intentoDelDueno(
              dueno,
              texto,
              parametrosDe(texto, [s.id, T, ADMIN, empresa]),
            );
            const permitida = TRANSICIONES_DE_SOLICITUD[desde].includes(hasta);
            expect(r.ok, `${desde} -> ${hasta}`).toBe(permitida);
            if (!r.ok) {
              expect(r.codigo, `${desde} -> ${hasta}: ${r.mensaje}`).toBe("23514");
              expect(r.restriccion, `${desde} -> ${hasta}`).toBe("solicitud_transicion_invalida");
            }
          });
        }
      }
    });

    it("las terminales son tres y de ellas no se sale (los 15 pares del matriz anterior son rechazos del disparador)", () => {
      const terminales = ESTADOS_DE_SOLICITUD.filter((e) => !estaAbierta(e));
      expect(terminales).toEqual(["ALTA_CREADA", "RECHAZADA", "SPAM"]);
    });

    it("cada cambio válido sube la versión en uno y mueve actualizado_en; una fila sin cambios de estado también sube", async () => {
      await sinConfirmar(dueno, async () => {
        const s = await crearSolicitud(dueno, { estado: "NUEVA", marca });
        const v1 = await filaDe(dueno, s.id);
        await dueno.query(`update solicitud_de_alta set ${SET_PARA.VERIFICADA} where id = $1`, [
          s.id,
          T,
        ]);
        const v2 = await filaDe(dueno, s.id);
        expect(v2["version"]).toBe((v1["version"] as number) + 1);
        expect((v2["actualizado_en"] as Date).getTime()).toBeGreaterThanOrEqual(
          (v1["actualizado_en"] as Date).getTime(),
        );
        await dueno.query(`update solicitud_de_alta set ${SET_PARA.APROBADA} where id = $1`, [
          s.id,
          T,
          ADMIN,
        ]);
        expect((await filaDe(dueno, s.id))["version"]).toBe((v1["version"] as number) + 2);
      });
    });

    it("un cambio rechazado por el disparador no sube la versión", async () => {
      await sinConfirmar(dueno, async () => {
        const s = await crearSolicitud(dueno, { estado: "SPAM", marca });
        const antes = await filaDe(dueno, s.id);
        const r = await intentoDelDueno(
          dueno,
          `update solicitud_de_alta set ${SET_PARA.VERIFICADA} where id = $1`,
          [s.id, T],
        );
        expect(r.ok).toBe(false);
        expect(await filaDe(dueno, s.id)).toEqual(antes);
      });
    });

    // ---- inmutables ---------------------------------------------------------------------------------------

    const INMUTABLES: ReadonlyArray<readonly [string, string]> = [
      ["la marca", "marca_id = $2::uuid"],
      [
        "la fecha de recepción",
        "creada_en = creada_en + interval '1 second', ultimo_envio_en = ultimo_envio_en + interval '1 second'",
      ],
      ["la versión de los términos", "version_de_terminos = '2026-10-14'"],
      ["la versión de la privacidad", "version_de_privacidad = '2026-10-14.1'"],
      [
        "el consentimiento de medición",
        "medicion_consentida = true, version_de_aviso_de_medicion = '2026-11-01'",
      ],
      ["el rubro", "rubro = 'bar'"],
      ["la provincia", "provincia = 'AR-C'"],
      ["la identidad", "id = gen_random_uuid()"],
    ];

    it.each(INMUTABLES)("%s no cambia nunca", async (_nombre, set) => {
      await sinConfirmar(dueno, async () => {
        const s = await crearSolicitud(dueno, { estado: "NUEVA", marca });
        const otraMarca = await crearMarca(dueno);
        const parametros = set.includes("$2") ? [s.id, otraMarca] : [s.id];
        check(
          await intentoDelDueno(
            dueno,
            `update solicitud_de_alta set ${set} where id = $1`,
            parametros,
          ),
          "solicitud_inmutable",
        );
      });
    });

    it("la finalidad no cambia: mantenerla no es un cambio y cambiarla la frena el disparador", async () => {
      await sinConfirmar(dueno, async () => {
        const s = await crearSolicitud(dueno, { estado: "NUEVA", marca });
        expect(
          (
            await intentoDelDueno(
              dueno,
              "update solicitud_de_alta set finalidad = finalidad where id = $1",
              [s.id],
            )
          ).ok,
        ).toBe(true);
        check(
          await intentoDelDueno(
            dueno,
            "update solicitud_de_alta set finalidad = 'OTRA' where id = $1",
            [s.id],
          ),
          "solicitud_inmutable",
        );
      });
    });

    // ---- decisión -----------------------------------------------------------------------------------------

    it("la decisión (quién, cuándo, por qué) no cambia sin cambiar de estado", async () => {
      await sinConfirmar(dueno, async () => {
        const s = await crearSolicitud(dueno, { estado: "RECHAZADA", marca, motivo: "OTRO" });
        for (const set of [
          "decidida_por = 'sistema'",
          "decidida_en = decidida_en + interval '1 day'",
          "motivo_de_rechazo = 'NO_CONTACTABLE'",
          "nota_interna = 'una nota'",
        ]) {
          check(
            await intentoDelDueno(dueno, `update solicitud_de_alta set ${set} where id = $1`, [
              s.id,
            ]),
            "solicitud_decision_sin_cambio",
          );
        }
        const a = await crearSolicitud(dueno, { estado: "APROBADA", marca });
        check(
          await intentoDelDueno(
            dueno,
            "update solicitud_de_alta set decidida_por = 'sistema' where id = $1",
            [a.id],
          ),
          "solicitud_decision_sin_cambio",
        );
      });
    });

    it("la nota interna se puede dejar al decidir (junto con el estado)", async () => {
      await sinConfirmar(dueno, async () => {
        const s = await crearSolicitud(dueno, { estado: "VERIFICADA", marca });
        const r = await intentoDelDueno(
          dueno,
          `update solicitud_de_alta set ${SET_PARA.APROBADA}, nota_interna = 'Llamar el lunes' where id = $1`,
          [s.id, T, ADMIN],
        );
        expect(r.ok).toBe(true);
        expect((await filaDe(dueno, s.id))["nota_interna"]).toBe("Llamar el lunes");
      });
    });

    // ---- verificación -------------------------------------------------------------------------------------

    it("la fecha de verificación se fija una sola vez, al pasar de NUEVA a VERIFICADA", async () => {
      await sinConfirmar(dueno, async () => {
        const nueva = await crearSolicitud(dueno, { estado: "NUEVA", marca });
        // en una NUEVA que sigue NUEVA no se fija (la CHECK también lo impide; acá el disparador, con la CHECK satisfecha por el estado)
        check(
          await intentoDelDueno(
            dueno,
            "update solicitud_de_alta set verificada_en = $2 where id = $1",
            [nueva.id, T],
          ),
          "solicitud_decision_sin_cambio",
        );
        const verificada = await crearSolicitud(dueno, { estado: "VERIFICADA", marca });
        check(
          await intentoDelDueno(
            dueno,
            "update solicitud_de_alta set verificada_en = verificada_en + interval '1 hour' where id = $1",
            [verificada.id],
          ),
          "solicitud_decision_sin_cambio",
        );
        const aprobada = await crearSolicitud(dueno, { estado: "APROBADA", marca });
        check(
          await intentoDelDueno(
            dueno,
            "update solicitud_de_alta set verificada_en = null where id = $1",
            [aprobada.id],
          ),
          "solicitud_decision_sin_cambio",
        );
        // el cambio legítimo
        expect(
          (
            await intentoDelDueno(
              dueno,
              `update solicitud_de_alta set ${SET_PARA.VERIFICADA} where id = $1`,
              [nueva.id, T],
            )
          ).ok,
        ).toBe(true);
        expect((await filaDe(dueno, nueva.id))["verificada_en"]).toEqual(T);
      });
    });

    // ---- envíos -------------------------------------------------------------------------------------------

    it("los envíos suben de a uno y solo mientras la solicitud está NUEVA, hasta el tope de MAXIMO_DE_ENVIOS", async () => {
      expect(MAXIMO_DE_ENVIOS).toBe(5);
      await sinConfirmar(dueno, async () => {
        const s = await crearSolicitud(dueno, { estado: "NUEVA", marca });
        const siguiente = (n: number, t: Date) =>
          intentoDelDueno(
            dueno,
            "update solicitud_de_alta set numero_de_envios = $2, ultimo_envio_en = $3 where id = $1",
            [s.id, n, t],
          );
        // saltear uno, repetir, bajar
        check(await siguiente(3, new Date(T.getTime() + 120_000)), "solicitud_envios");
        check(await siguiente(1, new Date(T.getTime() + 120_000)), "solicitud_envios");
        for (let n = 2; n <= MAXIMO_DE_ENVIOS; n++) {
          expect((await siguiente(n, new Date(T.getTime() + n * 120_000))).ok, `envío ${n}`).toBe(
            true,
          );
        }
        // el sexto lo frena el disparador (sube de a uno, pero la CHECK pone el tope)
        check(
          await siguiente(MAXIMO_DE_ENVIOS + 1, new Date(T.getTime() + 999_000)),
          "solicitud_envios_ck",
        );
        expect((await filaDe(dueno, s.id))["numero_de_envios"]).toBe(MAXIMO_DE_ENVIOS);
      });
    });

    it("los envíos de una solicitud que ya no es NUEVA no se tocan, ni siquiera para subirlos de a uno", async () => {
      await sinConfirmar(dueno, async () => {
        for (const estado of [
          "VERIFICADA",
          "APROBADA",
          "RECHAZADA",
          "SPAM",
          "ALTA_CREADA",
        ] as const) {
          const s = await crearSolicitud(dueno, { estado, marca });
          check(
            await intentoDelDueno(
              dueno,
              "update solicitud_de_alta set numero_de_envios = 2, ultimo_envio_en = ultimo_envio_en + interval '3 minutes' where id = $1",
              [s.id],
            ),
            "solicitud_envios",
          );
        }
      });
    });

    it("pasar a VERIFICADA no es una excusa para mover los envíos en el mismo cambio", async () => {
      await sinConfirmar(dueno, async () => {
        const s = await crearSolicitud(dueno, { estado: "NUEVA", marca });
        check(
          await intentoDelDueno(
            dueno,
            `update solicitud_de_alta set ${SET_PARA.VERIFICADA}, numero_de_envios = 2 where id = $1`,
            [s.id, T],
          ),
          "solicitud_envios",
        );
      });
    });

    it("el último envío no cambia solo ni retrocede", async () => {
      await sinConfirmar(dueno, async () => {
        const s = await crearSolicitud(dueno, { estado: "NUEVA", marca });
        check(
          await intentoDelDueno(
            dueno,
            "update solicitud_de_alta set ultimo_envio_en = ultimo_envio_en + interval '5 minutes' where id = $1",
            [s.id],
          ),
          "solicitud_envios",
        );
        check(
          await intentoDelDueno(
            dueno,
            "update solicitud_de_alta set numero_de_envios = 2, ultimo_envio_en = ultimo_envio_en - interval '1 second' where id = $1",
            [s.id],
          ),
          "solicitud_envios",
        );
      });
    });

    // ---- datos personales y anonimización -----------------------------------------------------------------

    const ANONIMIZAR =
      "anonimizada_en = $2::timestamptz, email = null, nombre_contacto = null, nombre_negocio = null, telefono = null, cuit = null, id_de_medicion = null, nota_interna = null, atribucion = atribucion - 'fbclid'";

    it("los datos personales y la atribución no cambian nunca, salvo al anonimizar", async () => {
      await sinConfirmar(dueno, async () => {
        const s = await crearSolicitud(dueno, { estado: "NUEVA", marca });
        for (const set of [
          "email = 'otro@prueba.test'",
          "nombre_contacto = 'Beto'",
          "nombre_negocio = 'Bar'",
          "telefono = '+5491100000000'",
          "telefono = null",
          "cuit = '20123456786'",
          "cuit = null",
          "atribucion = '{}'::jsonb",
          'atribucion = \'{"utm_source":"otra"}\'::jsonb',
        ]) {
          check(
            await intentoDelDueno(dueno, `update solicitud_de_alta set ${set} where id = $1`, [
              s.id,
            ]),
            "solicitud_personales_inmutables",
          );
        }
      });
    });

    it("anonimizar una terminal pone en NULL lo personal y quita el fbclid, y no toca nada más (queda el rubro, la provincia, los utm y las fechas)", async () => {
      await sinConfirmar(dueno, async () => {
        for (const estado of ["RECHAZADA", "SPAM", "ALTA_CREADA"] as const) {
          const s = await crearSolicitud(dueno, {
            estado,
            marca,
            medicionConsentida: true,
            atribucion: { utm_source: "meta", utm_campaign: "verano", fbclid: "abc" },
            nota: "una nota",
          });
          const antes = await filaDe(dueno, s.id);
          const r = await intentoDelDueno(
            dueno,
            `update solicitud_de_alta set ${ANONIMIZAR} where id = $1`,
            [s.id, T],
          );
          expect(r.ok, `${estado}: ${r.ok ? "" : r.mensaje}`).toBe(true);
          const despues = await filaDe(dueno, s.id);
          for (const personal of [
            "email",
            "nombre_contacto",
            "nombre_negocio",
            "telefono",
            "cuit",
            "id_de_medicion",
            "nota_interna",
          ]) {
            expect(despues[personal], `${estado}: ${personal}`).toBeNull();
          }
          expect(despues["atribucion"]).toEqual({ utm_source: "meta", utm_campaign: "verano" });
          expect(despues["anonimizada_en"]).toEqual(T);
          for (const intacta of [
            "estado",
            "rubro",
            "provincia",
            "creada_en",
            "decidida_por",
            "decidida_en",
            "motivo_de_rechazo",
            "empresa_creada_id",
            "verificada_en",
            "numero_de_envios",
            "ultimo_envio_en",
            "marca_id",
            "medicion_consentida",
            "version_de_terminos",
          ]) {
            expect(despues[intacta], `${estado}: ${intacta}`).toEqual(antes[intacta]);
          }
        }
      });
    });

    it("anonimizar mal se rechaza: sin ser terminal, dejando un dato, o tocando algo más", async () => {
      await sinConfirmar(dueno, async () => {
        const abierta = await crearSolicitud(dueno, { estado: "NUEVA", marca });
        check(
          await intentoDelDueno(dueno, `update solicitud_de_alta set ${ANONIMIZAR} where id = $1`, [
            abierta.id,
            T,
          ]),
          "solicitud_personales_ck",
        );
        const s = await crearSolicitud(dueno, { estado: "SPAM", marca });
        // deja el teléfono
        check(
          await intentoDelDueno(
            dueno,
            `update solicitud_de_alta set ${ANONIMIZAR.replace("telefono = null, ", "")} where id = $1`,
            [s.id, T],
          ),
          "solicitud_personales_ck",
        );
        // toca de más: la decisión, el estado, la verificación, los envíos
        for (const de_mas of [
          "decidida_por = 'sistema'",
          "estado = 'RECHAZADA', motivo_de_rechazo = 'OTRO'",
          "verificada_en = $2::timestamptz",
          "numero_de_envios = 2",
          "ultimo_envio_en = ultimo_envio_en + interval '1 day'",
          'atribucion = \'{"utm_source":"otra"}\'::jsonb',
        ]) {
          const sinAtribucion = ANONIMIZAR.replace(", atribucion = atribucion - 'fbclid'", "");
          const set = de_mas.startsWith("atribucion")
            ? `${sinAtribucion}, ${de_mas}`
            : `${ANONIMIZAR}, ${de_mas}`;
          const r = await intentoDelDueno(
            dueno,
            `update solicitud_de_alta set ${set} where id = $1`,
            [s.id, T],
          );
          expect(r.ok, de_mas).toBe(false);
        }
        // y lo que no sea quitar el fbclid de la atribución
        const con = await crearSolicitud(dueno, {
          estado: "SPAM",
          marca,
          medicionConsentida: true,
          atribucion: { utm_source: "meta", fbclid: "abc" },
        });
        check(
          await intentoDelDueno(
            dueno,
            `update solicitud_de_alta set ${ANONIMIZAR.replace("atribucion - 'fbclid'", "'{}'::jsonb")} where id = $1`,
            [con.id, T],
          ),
          "solicitud_personales_inmutables",
        );
      });
    });

    it("una fila anonimizada no cambia más: ni un campo, ni el estado, ni siquiera sin cambios", async () => {
      await sinConfirmar(dueno, async () => {
        const s = await crearSolicitud(dueno, { estado: "SPAM", marca });
        expect(
          (
            await intentoDelDueno(
              dueno,
              `update solicitud_de_alta set ${ANONIMIZAR} where id = $1`,
              [s.id, T],
            )
          ).ok,
        ).toBe(true);
        for (const set of [
          "anonimizada_en = null",
          "nombre_contacto = 'Ana'",
          "nota_interna = 'x'",
          "estado = 'SPAM'",
          "decidida_en = decidida_en",
        ]) {
          check(
            await intentoDelDueno(dueno, `update solicitud_de_alta set ${set} where id = $1`, [
              s.id,
            ]),
            "solicitud_anonimizada_inmutable",
          );
        }
      });
    });

    it("anonimizar no se repite: la segunda vez es un cambio sobre una fila anonimizada", async () => {
      await sinConfirmar(dueno, async () => {
        const s = await crearSolicitud(dueno, { estado: "RECHAZADA", marca });
        await dueno.query(`update solicitud_de_alta set ${ANONIMIZAR} where id = $1`, [s.id, T]);
        check(
          await intentoDelDueno(dueno, `update solicitud_de_alta set ${ANONIMIZAR} where id = $1`, [
            s.id,
            T,
          ]),
          "solicitud_anonimizada_inmutable",
        );
      });
    });

    // ---- nadie borra --------------------------------------------------------------------------------------

    it("nadie borra una solicitud ni vacía la tabla, ni el dueño (42501)", async () => {
      await sinConfirmar(dueno, async () => {
        const s = await crearSolicitud(dueno, { estado: "NUEVA", marca });
        denegado(
          await intentoDelDueno(dueno, "delete from solicitud_de_alta where id = $1", [s.id]),
        );
        denegado(await intentoDelDueno(dueno, "delete from solicitud_de_alta"));
        denegado(await intentoDelDueno(dueno, "truncate solicitud_de_alta"));
        expect(await contar(dueno, "solicitud_de_alta", `id = '${s.id}'`)).toBe(1);
      });
    });
  },
);

// ============================================================================================================
// Los contadores
// ============================================================================================================

describe.skipIf(base === null)("captación: los contadores del abuso (aun para el dueño)", () => {
  let dueno: pg.Client;
  beforeAll(async () => {
    dueno = new pg.Client({ connectionString: (base as BaseDePruebas).dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
  });

  const HUELLA = "ab".repeat(32);
  const alta = (clave_: string, ventana = "HORA", cuenta = 1) =>
    intentoDelDueno(
      dueno,
      "insert into limite_de_captacion (clave, ventana, ventana_inicio, cuenta) values ($1, $2, $3, $4)",
      [clave_, ventana, AHORA_DE_PRUEBA, cuenta],
    );

  it("las claves aceptadas son ip:<hmac>, correo:<hmac> y las dos globales; nada más (nunca una IP ni un correo en claro)", async () => {
    await sinConfirmar(dueno, async () => {
      for (const buena of [
        `ip:${HUELLA}`,
        `correo:${HUELLA}`,
        "global:solicitudes",
        "global:verificaciones",
      ]) {
        expect((await alta(buena)).ok, buena).toBe(true);
        await dueno.query("delete from limite_de_captacion where clave = $1", [buena]);
      }
      for (const mala of [
        "ip:203.0.113.7",
        "correo:ana@prueba.test",
        `ip:${HUELLA.toUpperCase()}`,
        `ip:${HUELLA.slice(1)}`,
        `ip:${HUELLA}0`,
        `otro:${HUELLA}`,
        "global:otra",
        "global:solicitudes ",
        "",
      ]) {
        check(await alta(mala), "limite_clave_ck");
      }
    });
  });

  it("la ventana es HORA, DIA o SEMANA, y la cuenta empieza en 1 o más", async () => {
    await sinConfirmar(dueno, async () => {
      for (const ventana of ["HORA", "DIA", "SEMANA"]) {
        expect((await alta("global:solicitudes", ventana)).ok, ventana).toBe(true);
      }
      check(await alta("global:verificaciones", "MES"), "limite_ventana_ck");
      check(await alta("global:verificaciones", "HORA", 0), "limite_cuenta_ck");
      check(await alta("global:verificaciones", "HORA", -1), "limite_cuenta_ck");
    });
  });

  it("clave, ventana y comienzo juntos son únicos", async () => {
    await sinConfirmar(dueno, async () => {
      expect((await alta("global:solicitudes")).ok).toBe(true);
      clave(await alta("global:solicitudes"), "limite_de_captacion_pkey");
      expect((await alta("global:solicitudes", "DIA")).ok).toBe(true);
    });
  });

  it("la cuenta solo sube de a uno: bajarla, repetirla, saltearla o cambiar la clave se rechaza", async () => {
    await sinConfirmar(dueno, async () => {
      await alta("global:solicitudes", "HORA", 5);
      const cambiar = (set: string) =>
        intentoDelDueno(
          dueno,
          `update limite_de_captacion set ${set} where clave = 'global:solicitudes'`,
        );
      check(await cambiar("cuenta = 1"), "limite_cuenta_solo_sube");
      check(await cambiar("cuenta = cuenta"), "limite_cuenta_solo_sube");
      check(await cambiar("cuenta = cuenta + 2"), "limite_cuenta_solo_sube");
      check(
        await cambiar("cuenta = cuenta + 1, clave = 'global:verificaciones'"),
        "limite_cuenta_solo_sube",
      );
      check(await cambiar("cuenta = cuenta + 1, ventana = 'DIA'"), "limite_cuenta_solo_sube");
      check(
        await cambiar("cuenta = cuenta + 1, ventana_inicio = ventana_inicio + interval '1 hour'"),
        "limite_cuenta_solo_sube",
      );
      expect((await cambiar("cuenta = cuenta + 1")).ok).toBe(true);
      expect(
        (
          await dueno.query<{ cuenta: number }>(
            "select cuenta from limite_de_captacion where clave = 'global:solicitudes' and ventana = 'HORA'",
          )
        ).rows,
      ).toEqual([{ cuenta: 6 }]);
    });
  });

  it("nadie vacía la tabla de contadores, ni el dueño (42501)", async () => {
    await sinConfirmar(dueno, async () => {
      denegado(await intentoDelDueno(dueno, "truncate limite_de_captacion"));
    });
  });
});

// ============================================================================================================
// Paridad entre el dominio (TypeScript) y la base
// ============================================================================================================

describe.skipIf(base === null)("captación: el dominio y la base dicen lo mismo", () => {
  let dueno: pg.Client;
  let marca: string;
  beforeAll(async () => {
    dueno = new pg.Client({ connectionString: (base as BaseDePruebas).dueno });
    await dueno.connect();
    marca = await marcaPrincipal(dueno);
  });
  afterAll(async () => {
    await dueno.end();
  });

  it("los estados: la CHECK admite exactamente ESTADOS_DE_SOLICITUD", async () => {
    const def = (
      await dueno.query<{ d: string }>(
        `select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'solicitud_estado_ck'`,
      )
    ).rows[0]?.d as string;
    const enLaBase = [...def.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(enLaBase).toEqual([...ESTADOS_DE_SOLICITUD].sort());
  });

  it("los motivos de rechazo: la CHECK admite exactamente MOTIVOS_DE_RECHAZO", async () => {
    const def = (
      await dueno.query<{ d: string }>(
        `select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'solicitud_motivo_ck'`,
      )
    ).rows[0]?.d as string;
    const enLaBase = [...def.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(enLaBase).toEqual([...MOTIVOS_DE_RECHAZO].sort());
  });

  it("la finalidad: la CHECK admite exactamente FINALIDADES", async () => {
    const def = (
      await dueno.query<{ d: string }>(
        `select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'solicitud_finalidad_ck'`,
      )
    ).rows[0]?.d as string;
    expect([...def.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])).toEqual([...FINALIDADES]);
  });

  it("los rubros del catálogo y las 24 provincias pasan las CHECK; las provincias son las de la tabla `provincia`", async () => {
    await sinConfirmar(dueno, async () => {
      for (const rubro of RUBROS) {
        const r = await insertar(dueno, filaNueva(marca, { rubro }));
        expect(r.ok, rubro).toBe(true);
      }
      for (const provincia of CODIGOS_DE_PROVINCIA) {
        const r = await insertar(dueno, filaNueva(marca, { provincia }));
        expect(r.ok, provincia).toBe(true);
      }
      const { rows } = await dueno.query<{ codigo: string }>(
        "select codigo from provincia order by 1",
      );
      expect(rows.map((p) => p.codigo)).toEqual([...CODIGOS_DE_PROVINCIA].sort());
    });
  });

  it("los motivos válidos entran en una solicitud rechazada (NO_VERIFICADA solo del sistema y sin verificar)", async () => {
    await sinConfirmar(dueno, async () => {
      for (const motivo of MOTIVOS_DE_RECHAZO) {
        const delSistema = motivo === "NO_VERIFICADA";
        const r = await insertar(
          dueno,
          filaNueva(marca, {
            estado: "RECHAZADA",
            motivo_de_rechazo: motivo,
            decidida_por: delSistema ? "sistema" : ADMIN_DE_PRUEBA,
            decidida_en: AHORA_DE_PRUEBA,
          }),
        );
        expect(r.ok, motivo).toBe(true);
      }
    });
  });

  it("la forma de las versiones de los textos legales es la misma en el dominio y en las tres CHECK", async () => {
    const candidatas = [
      "2026-10-13",
      "2026-10-13.1",
      "2026-10-13.123",
      "2026-10-13.1234",
      "2026-10-1",
      "2026-1-13",
      "26-10-13",
      "2026-10-13.",
      "2026-10-13.a",
      "2026-10-13 ",
      " 2026-10-13",
      "2026-10-13\n",
      "2026/10/13",
      "",
      "x2026-10-13",
      "2026-10-13x",
      "２０２６-10-13",
    ];
    const { rows } = await dueno.query<{ v: string; sql: boolean }>(
      `select v, v ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[0-9]{1,3})?$' as sql from unnest($1::text[]) as v`,
      [candidatas],
    );
    for (const { v, sql } of rows) expect(sql, JSON.stringify(v)).toBe(FORMA_DE_VERSION.test(v));
    // y las CHECK de la tabla usan esa misma expresión
    const defs = (
      await dueno.query<{ d: string }>(
        `select pg_get_constraintdef(oid) as d from pg_constraint
         where conname in ('solicitud_terminos_ck', 'solicitud_privacidad_ck', 'solicitud_aviso_medicion_ck')`,
      )
    ).rows;
    expect(defs).toHaveLength(3);
    for (const { d } of defs) expect(d).toContain("'^[0-9]{4}-[0-9]{2}-[0-9]{2}(\\.[0-9]{1,3})?$'");
  });

  /** Lo que atribucion_valida() dice, escrito en TypeScript con las constantes del dominio. */
  const atribucionValidaEnTs = (valor: unknown): boolean => {
    if (typeof valor !== "object" || valor === null || Array.isArray(valor)) return false;
    return Object.entries(valor).every(
      ([k, v]) =>
        (CLAVES_DE_ATRIBUCION as readonly string[]).includes(k) &&
        typeof v === "string" &&
        /^[A-Za-z0-9._~-]{1,200}$/.test(v),
    );
  };

  it("atribucion_valida() coincide con el dominio sobre cientos de objetos al azar, y todo lo que normalizarAtribucion devuelve la satisface", async () => {
    const texto = fc.oneof(
      fc.string({ unit: "grapheme-ascii", maxLength: 12 }),
      fc.stringMatching(/^[A-Za-z0-9._~-]{1,30}$/),
      fc.constantFrom("", "a b", "ñ", "x".repeat(200), "x".repeat(201)),
    );
    const valor = fc.oneof(
      texto,
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.array(texto, { maxLength: 2 }),
    );
    const objeto = fc.oneof(
      fc.dictionary(fc.oneof(fc.constantFrom(...CLAVES_DE_ATRIBUCION, "otra"), texto), valor, {
        maxKeys: 4,
      }),
      fc.stringMatching(/^[A-Za-z0-9._~-]{1,30}$/),
      fc.array(texto, { maxLength: 2 }),
      fc.integer(),
      fc.constant(null),
    );
    const muestras = fc.sample(objeto, { numRuns: 400, seed: 20261013 });
    const { rows } = await dueno.query<{ j: string; sql: boolean | null }>(
      `select j, atribucion_valida(j::jsonb) as sql from unnest($1::text[]) as j`,
      [muestras.map((m) => JSON.stringify(m))],
    );
    expect(rows).toHaveLength(400);
    expect(rows.some((r) => r.sql === true) && rows.some((r) => r.sql === false)).toBe(true);
    for (const { j, sql } of rows) {
      const m = JSON.parse(j) as unknown;
      // JSON `null` como atribución: la función devuelve false (la columna es NOT NULL y la CHECK la rechazaría)
      expect(sql, j).toBe(atribucionValidaEnTs(m));
    }

    const crudos = fc.sample(
      fc.dictionary(fc.oneof(fc.constantFrom(...CLAVES_DE_ATRIBUCION, "otra"), texto), texto, {
        maxKeys: 6,
      }),
      { numRuns: 300, seed: 20261014 },
    );
    const normalizados = crudos.flatMap((c) => [
      normalizarAtribucion(c, true),
      normalizarAtribucion(c, false),
    ]);
    const { rows: validas } = await dueno.query<{ sql: boolean }>(
      `select atribucion_valida(j::jsonb) as sql from unnest($1::text[]) as j`,
      [normalizados.map((n) => JSON.stringify(n))],
    );
    expect(validas.every((v) => v.sql)).toBe(true);
  });

  /** Lo que datos_de_auditoria_de_captacion_validos() dice, con las constantes del dominio. */
  it("datos_de_auditoria_de_captacion_validos() coincide con la lista blanca del dominio", async () => {
    const seguro = fc.oneof(
      fc.stringMatching(/^[A-Za-z0-9._~:-]{1,40}$/),
      fc.integer({ min: -2, max: 8 }),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
    );
    const peligroso = fc.oneof(
      fc.constantFrom(
        "ana@x.com",
        "Ana Pérez",
        "a b",
        "",
        "x".repeat(201),
        "ñ",
        "a/b",
        "'",
        '"',
        "a,b",
      ),
      fc.array(seguro, { maxLength: 2 }),
      fc.dictionary(fc.constantFrom("a", "b"), seguro, { maxKeys: 2 }),
    );
    const objeto = fc.dictionary(
      fc.oneof(
        { weight: 5, arbitrary: fc.constantFrom(...CLAVES_DE_AUDITORIA) },
        fc.constantFrom("email", "nombre", "telefono", "cuit", "x"),
      ),
      fc.oneof({ weight: 4, arbitrary: seguro }, peligroso),
      { maxKeys: 5 },
    );
    const muestras = fc.sample(objeto, { numRuns: 400, seed: 20261015 });
    const { rows } = await dueno.query<{ j: string; sql: boolean }>(
      `select j, datos_de_auditoria_de_captacion_validos(j::jsonb) as sql from unnest($1::text[]) as j`,
      [muestras.map((m) => JSON.stringify(m))],
    );
    expect(rows.some((r) => r.sql) && rows.some((r) => !r.sql)).toBe(true);
    for (const { j, sql } of rows) {
      expect(sql, j).toBe(
        clavesNoPermitidas(JSON.parse(j) as Record<string, unknown>).length === 0,
      );
    }
    // sin datos (NULL) no hay nada que objetar; un JSON que no es un objeto no se admite
    const { rows: bordes } = await dueno.query<Record<string, boolean | null>>(
      `select datos_de_auditoria_de_captacion_validos(null) as nulo,
              datos_de_auditoria_de_captacion_validos('[]'::jsonb) as lista,
              datos_de_auditoria_de_captacion_validos('"x"'::jsonb) as texto,
              datos_de_auditoria_de_captacion_validos('null'::jsonb) as json_nulo,
              datos_de_auditoria_de_captacion_validos('{}'::jsonb) as vacio`,
    );
    expect(bordes).toEqual([
      { nulo: true, lista: false, texto: false, json_nulo: false, vacio: true },
    ]);
  });

  it("todo lo que validarFormulario acepta (cientos de formularios al azar) entra en la tabla sin que ninguna CHECK lo rechace", async () => {
    const texto = fc.oneof(
      fc.stringMatching(/^ ?[A-Za-zÁÉÍÓÚáéíóúñÑ0-9]{1,12}( {1,3}[A-Za-zñ0-9.&'-]{1,12}){0,3} ?$/),
      fc.string({ unit: "grapheme", maxLength: 40 }),
      fc.string({ unit: "binary", maxLength: 40 }),
    );
    const entrada = fc.record({
      nombreContacto: texto,
      correo: fc
        .tuple(
          fc.stringMatching(/^[a-z0-9]{1,10}([._+-][a-z0-9]{1,10}){0,2}$/),
          fc.stringMatching(/^[a-z0-9]{1,10}(-[a-z0-9]{1,8}){0,2}$/),
          fc.constantFrom("com", "com.ar", "org", "COM.AR", "ar"),
        )
        .map(([l, d, t]) => `${l}@${d}.${t}`),
      nombreNegocio: texto,
      rubro: fc.constantFrom(...RUBROS),
      provincia: fc.constantFrom("", ...CODIGOS_DE_PROVINCIA),
      telefono: fc.oneof(
        fc.constant(""),
        fc.stringMatching(/^\+?[0-9]{2,4}[ .-]?[0-9]{4,5}[ -]?[0-9]{4}$/),
      ),
      cuit: fc.constantFrom("", "30-70308853-4", "30703088534", " 20-12345678-6 "),
      aceptaTerminosYPrivacidad: fc.constant(true),
      versionDeTerminos: fc.constant("2026-10-13"),
      versionDePrivacidad: fc.constant("2026-10-13.1"),
      medicionConsentida: fc.boolean(),
      versionDeAvisoDeMedicion: fc.constant("2026-11-01"),
      idDeMedicion: fc.oneof(fc.uuid(), fc.constant("no-es-un-uuid")),
      atribucion: fc.dictionary(
        fc.oneof(fc.constantFrom(...CLAVES_DE_ATRIBUCION), fc.constant("otra")),
        fc.oneof(
          fc.string({ unit: "grapheme-ascii", maxLength: 30 }),
          fc.string({ unit: "binary", maxLength: 30 }),
        ),
        { maxKeys: 6 },
      ),
    });
    const vigentes = {
      terminos: ["2026-10-13"],
      privacidad: ["2026-10-13.1"],
      avisoDeMedicion: ["2026-11-01"],
    };
    const muestras = fc.sample(entrada, { numRuns: 300, seed: 20261016 });
    let aceptadas = 0;
    await sinConfirmar(dueno, async () => {
      for (const e of muestras) {
        const r = validarFormulario(e, vigentes);
        if (!r.ok) continue;
        aceptadas += 1;
        const v = r.valor;
        // cada muestra se prueba y se deshace: dos formularios al azar pueden traer el mismo correo
        await dueno.query("savepoint muestra");
        const res = await insertar(dueno, {
          marca_id: marca,
          email: v.correo,
          nombre_contacto: v.nombreContacto,
          nombre_negocio: v.nombreNegocio,
          telefono: v.telefono,
          cuit: v.cuit,
          id_de_medicion: v.idDeMedicion,
          rubro: v.rubro,
          provincia: v.provincia,
          atribucion: v.atribucion,
          version_de_terminos: v.versionDeTerminos,
          version_de_privacidad: v.versionDePrivacidad,
          medicion_consentida: v.medicionConsentida,
          version_de_aviso_de_medicion: v.versionDeAvisoDeMedicion,
          ultimo_envio_en: AHORA_DE_PRUEBA,
          creada_en: AHORA_DE_PRUEBA,
        });
        await dueno.query("rollback to savepoint muestra");
        expect(res.ok, `${JSON.stringify(v)} -> ${res.ok ? "" : res.mensaje}`).toBe(true);
      }
    });
    expect(aceptadas).toBeGreaterThan(60);
  });
});
