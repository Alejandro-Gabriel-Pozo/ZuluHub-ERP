import fc from "fast-check";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";
import { validarTextoVisible } from "../../src/capacidades/vocabulario/texto-visible";
import { esValorDeLaPerilla } from "../../src/capacidades/planes/valores";
import {
  normalizarHost,
  validarCodigoDeMarca,
  validarTema,
} from "../../src/modulos/marcas/publico";
import { campoConPosibleSecreto } from "../../src/puertos/sin-secretos";
import { ARCHIVO_0007, HASTA_0006, baseConMigraciones } from "./marcas-apoyo";

/**
 * Marcas y planes (M3), migración 0007: lo que la base DECLARA (tablas, columnas, privilegios por columna
 * y por rol, el rol público, las funciones) y las funciones de validación comparadas con su par de
 * TypeScript (`normalizarHost`, `validarTextoVisible`, `validarTema`, `esValorDeLaPerilla`…). La base es la
 * que dejan las migraciones, SIN la marca de prueba ni el valor por defecto transitorio de `tenant.marca_id`.
 * Las reglas de cada tabla están en `marcas-reglas.test.ts`; el aislamiento, en `marcas-aislamiento.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const ROLES = [
  "zuluhub_app",
  "zuluhub_grupo",
  "zuluhub_trabajos",
  "zuluhub_plataforma",
  "zuluhub_autenticacion",
  "zuluhub_publico",
] as const;

const COLUMNAS: Readonly<Record<string, readonly string[]>> = {
  marca: [
    "id",
    "codigo",
    "es_principal",
    "marca_padre_id",
    "nivel",
    "estado",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  dominio: [
    "id",
    "host",
    "superficie",
    "duenio_marca_id",
    "duenio_empresa_id",
    "marca_id",
    "titular",
    "es_canonico",
    "estado",
    "verificado_en",
    "motivo",
    "registrado_por",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  plan: ["id", "codigo", "estado", "creado_en", "actualizado_en", "version"],
  version_de_plan: [
    "id",
    "plan_id",
    "numero",
    "estado",
    "nombre_comercial",
    "modulos",
    "perillas",
    "motivo",
    "publicada_en",
    "publicada_por",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  version_de_marca: [
    "id",
    "marca_id",
    "numero",
    "estado",
    "vigente_desde",
    "nombre_visible",
    "tema",
    "logo",
    "vocabulario",
    "modulos_iniciales",
    "plan_por_defecto_id",
    "reemplaza_programada",
    "motivo",
    "confirmada_en",
    "confirmada_por",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  plan_de_tenant: [
    "id",
    "tenant_id",
    "numero",
    "version_de_plan_id",
    "vigente_desde",
    "origen",
    "reemplaza_programada",
    "motivo",
    "asignado_por",
    "creado_en",
  ],
  ajuste_de_perilla: [
    "id",
    "tenant_id",
    "empresa_id",
    "perilla",
    "numero",
    "valor",
    "vigente_desde",
    "reemplaza_programada",
    "motivo",
    "asignado_por",
    "creado_en",
  ],
  modulo_de_empresa: ["empresa_id", "modulo", "activo", "creado_en", "actualizado_en", "version"],
  nivel_de_control: [
    "empresa_id",
    "sucursal_id",
    "control",
    "nivel",
    "creado_en",
    "actualizado_en",
    "version",
  ],
};
const TABLAS_NUEVAS = Object.keys(COLUMNAS);
const FUNCIONES_DE_VALIDACION = [
  "host_valido(text)",
  "texto_visible_valido(text,integer)",
  "tema_valido(jsonb)",
  "vocabulario_valido(jsonb)",
  "perillas_validas(jsonb,boolean)",
  "claves_de_modulo_validas(text[])",
] as const;

type Privilegio = "SELECT" | "INSERT" | "UPDATE";

/** Lo que cada rol puede por columna sobre las tablas nuevas (la especificación §B.9, columna por columna). */
function privilegiosEsperados(): string[] {
  const lista: string[] = [];
  const dar = (
    rol: string,
    priv: Privilegio,
    tabla: string,
    columnas: readonly string[] | "todas",
  ) => {
    for (const c of columnas === "todas" ? (COLUMNAS[tabla] as readonly string[]) : columnas) {
      lista.push(`${rol}:${tabla}.${c}:${priv}`);
    }
  };
  const columnasPublicasDeVersionDeMarca = [
    "marca_id",
    "numero",
    "vigente_desde",
    "nombre_visible",
    "tema",
    "logo",
    "vocabulario",
  ] as const;
  // público (sin contexto): solo lo que la puerta necesita para resolver la marca
  dar("zuluhub_publico", "SELECT", "marca", [
    "id",
    "codigo",
    "marca_padre_id",
    "nivel",
    "es_principal",
  ]);
  dar("zuluhub_publico", "SELECT", "dominio", [
    "host",
    "superficie",
    "estado",
    "duenio_marca_id",
    "duenio_empresa_id",
    "marca_id",
  ]);
  dar("zuluhub_publico", "SELECT", "version_de_marca", columnasPublicasDeVersionDeMarca);
  // app (contexto de empresa)
  dar("zuluhub_app", "SELECT", "marca", "todas");
  dar("zuluhub_app", "SELECT", "dominio", ["host", "superficie", "marca_id", "es_canonico"]);
  dar("zuluhub_app", "SELECT", "version_de_marca", columnasPublicasDeVersionDeMarca);
  dar("zuluhub_app", "SELECT", "version_de_plan", [
    "id",
    "plan_id",
    "numero",
    "nombre_comercial",
    "modulos",
    "perillas",
  ]);
  dar("zuluhub_app", "SELECT", "plan_de_tenant", [
    "id",
    "tenant_id",
    "numero",
    "version_de_plan_id",
    "vigente_desde",
    "origen",
    "creado_en",
  ]);
  dar("zuluhub_app", "SELECT", "ajuste_de_perilla", [
    "id",
    "tenant_id",
    "empresa_id",
    "perilla",
    "numero",
    "valor",
    "vigente_desde",
    "creado_en",
  ]);
  dar("zuluhub_app", "SELECT", "modulo_de_empresa", "todas");
  dar("zuluhub_app", "SELECT", "nivel_de_control", "todas");
  dar("zuluhub_app", "INSERT", "nivel_de_control", [
    "empresa_id",
    "sucursal_id",
    "control",
    "nivel",
  ]);
  dar("zuluhub_app", "UPDATE", "nivel_de_control", ["nivel"]);
  // plataforma (actor firmado): lee todo menos los niveles de control; escribe lo suyo
  for (const tabla of TABLAS_NUEVAS.filter((t) => t !== "nivel_de_control")) {
    dar("zuluhub_plataforma", "SELECT", tabla, "todas");
  }
  dar("zuluhub_plataforma", "INSERT", "marca", ["codigo", "marca_padre_id"]);
  dar("zuluhub_plataforma", "UPDATE", "marca", ["estado"]);
  dar("zuluhub_plataforma", "INSERT", "dominio", [
    "host",
    "superficie",
    "duenio_marca_id",
    "duenio_empresa_id",
    "titular",
    "es_canonico",
    "registrado_por",
  ]);
  dar("zuluhub_plataforma", "UPDATE", "dominio", ["estado", "verificado_en", "motivo"]);
  dar("zuluhub_plataforma", "INSERT", "plan", ["codigo"]);
  dar("zuluhub_plataforma", "UPDATE", "plan", ["estado"]);
  dar("zuluhub_plataforma", "INSERT", "version_de_plan", [
    "plan_id",
    "nombre_comercial",
    "modulos",
    "perillas",
  ]);
  dar("zuluhub_plataforma", "UPDATE", "version_de_plan", [
    "nombre_comercial",
    "modulos",
    "perillas",
    "estado",
    "numero",
    "motivo",
    "publicada_en",
    "publicada_por",
  ]);
  dar("zuluhub_plataforma", "INSERT", "version_de_marca", [
    "marca_id",
    "nombre_visible",
    "tema",
    "logo",
    "vocabulario",
    "modulos_iniciales",
    "plan_por_defecto_id",
  ]);
  dar("zuluhub_plataforma", "UPDATE", "version_de_marca", [
    "nombre_visible",
    "tema",
    "logo",
    "vocabulario",
    "modulos_iniciales",
    "plan_por_defecto_id",
    "estado",
    "numero",
    "vigente_desde",
    "reemplaza_programada",
    "motivo",
    "confirmada_en",
    "confirmada_por",
  ]);
  dar("zuluhub_plataforma", "INSERT", "plan_de_tenant", [
    "tenant_id",
    "numero",
    "version_de_plan_id",
    "vigente_desde",
    "origen",
    "reemplaza_programada",
    "motivo",
    "asignado_por",
  ]);
  dar("zuluhub_plataforma", "INSERT", "ajuste_de_perilla", [
    "tenant_id",
    "empresa_id",
    "perilla",
    "numero",
    "valor",
    "vigente_desde",
    "reemplaza_programada",
    "motivo",
    "asignado_por",
  ]);
  dar("zuluhub_plataforma", "INSERT", "modulo_de_empresa", ["empresa_id", "modulo"]);
  dar("zuluhub_plataforma", "UPDATE", "modulo_de_empresa", ["activo"]);
  return lista.sort();
}

describe.skipIf(base === null)("marcas y planes: la migración 0007 contra una base real", () => {
  let previa: Awaited<ReturnType<typeof baseConMigraciones>>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    previa = await baseConMigraciones(base, [...HASTA_0006, ARCHIVO_0007]);
    dueno = previa.cliente;
  });
  afterAll(async () => {
    await previa?.cerrar();
  });

  const filas = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;

  // ===========================================================================================
  // 1. Catálogo
  // ===========================================================================================
  describe("catálogo", () => {
    it("las nueve tablas nuevas existen con exactamente estas columnas, en este orden", async () => {
      for (const [tabla, columnas] of Object.entries(COLUMNAS)) {
        const reales = await filas<{ column_name: string }>(
          `select column_name from information_schema.columns
           where table_schema = 'public' and table_name = $1 order by ordinal_position`,
          [tabla],
        );
        expect(
          reales.map((c) => c.column_name),
          tabla,
        ).toEqual(columnas);
      }
    });

    it("las columnas nuevas de las tablas viejas: tenant.marca_id (NOT NULL, sin valor por defecto), sucursal.hora_de_corte y auditoria_acceso_grupo.resultado", async () => {
      const reales = await filas<Record<string, unknown>>(
        `select table_name, column_name, data_type, is_nullable, column_default
         from information_schema.columns
         where table_schema = 'public'
           and (table_name, column_name) in (('tenant', 'marca_id'), ('sucursal', 'hora_de_corte'),
                                             ('auditoria_acceso_grupo', 'resultado'))
         order by 1, 2`,
      );
      expect(reales).toEqual([
        {
          table_name: "auditoria_acceso_grupo",
          column_name: "resultado",
          data_type: "text",
          is_nullable: "NO",
          column_default: "'PERMITIDO'::text",
        },
        {
          table_name: "sucursal",
          column_name: "hora_de_corte",
          data_type: "time without time zone",
          is_nullable: "NO",
          column_default: "'00:00:00'::time without time zone",
        },
        // Sin valor por defecto: un tenant sin marca no se puede dar de alta (la elige quien lo da de alta).
        {
          table_name: "tenant",
          column_name: "marca_id",
          data_type: "uuid",
          is_nullable: "NO",
          column_default: null,
        },
      ]);
    });

    it("RLS activa y forzada en las nueve, y PUBLIC no tiene ningún privilegio", async () => {
      const tablas = await filas<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `select relname, relrowsecurity, relforcerowsecurity from pg_class
         where relnamespace = 'public'::regnamespace and relname = any($1) order by 1`,
        [TABLAS_NUEVAS],
      );
      expect(tablas.map((t) => t.relname)).toEqual([...TABLAS_NUEVAS].sort());
      for (const t of tablas) {
        expect(t.relrowsecurity, `${t.relname}: RLS activo`).toBe(true);
        expect(t.relforcerowsecurity, `${t.relname}: RLS forzado`).toBe(true);
      }
      expect(
        await filas(
          `select 1 from information_schema.table_privileges
           where table_schema = 'public' and grantee = 'PUBLIC' and table_name = any($1)`,
          [TABLAS_NUEVAS],
        ),
      ).toEqual([]);
    });

    it("los privilegios por columna de cada rol son exactamente los de la especificación (§B.9); grupo, trabajos y autenticación no reciben nada", async () => {
      const reales = await filas<{
        grantee: string;
        table_name: string;
        column_name: string;
        privilege_type: string;
      }>(
        `select grantee, table_name, column_name, privilege_type from information_schema.column_privileges
         where table_schema = 'public' and grantee = any($1) and table_name = any($2)
           and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')`,
        [[...ROLES], TABLAS_NUEVAS],
      );
      expect(
        reales
          .map((p) => `${p.grantee}:${p.table_name}.${p.column_name}:${p.privilege_type}`)
          .sort(),
      ).toEqual(privilegiosEsperados());
    });

    it("las columnas nuevas de las tablas viejas: quién las lee y quién las escribe", async () => {
      const reales = await filas<{
        grantee: string;
        table_name: string;
        column_name: string;
        privilege_type: string;
      }>(
        `select grantee, table_name, column_name, privilege_type from information_schema.column_privileges
         where table_schema = 'public' and grantee = any($1)
           and (table_name, column_name) in (('tenant', 'marca_id'), ('sucursal', 'hora_de_corte'),
                                             ('auditoria_acceso_grupo', 'resultado'))
         order by 1, 2, 3, 4`,
        [[...ROLES]],
      );
      expect(
        reales
          .map((p) => `${p.grantee}:${p.table_name}.${p.column_name}:${p.privilege_type}`)
          .sort(),
      ).toEqual(
        [
          // tenant.marca_id: se lee como el resto del tenant y solo el alta de la plataforma la escribe
          "zuluhub_app:tenant.marca_id:SELECT",
          "zuluhub_grupo:tenant.marca_id:SELECT",
          "zuluhub_plataforma:tenant.marca_id:SELECT",
          "zuluhub_plataforma:tenant.marca_id:INSERT",
          // sucursal.hora_de_corte: la edita la empresa; la ve el grupo
          "zuluhub_app:sucursal.hora_de_corte:SELECT",
          "zuluhub_app:sucursal.hora_de_corte:UPDATE",
          "zuluhub_grupo:sucursal.hora_de_corte:SELECT",
          // auditoria_acceso_grupo.resultado: el grupo la escribe y no la lee
          "zuluhub_grupo:auditoria_acceso_grupo.resultado:INSERT",
        ].sort(),
      );
    });

    it("nadie puede borrar, truncar, referenciar ni crear disparadores en las tablas nuevas, ni siquiera el rol público", async () => {
      const prohibidos = await filas(
        `select grantee, table_name, privilege_type from information_schema.table_privileges
         where table_schema = 'public' and grantee = any($1) and table_name = any($2)
           and privilege_type in ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')`,
        [[...ROLES], TABLAS_NUEVAS],
      );
      expect(prohibidos).toEqual([]);
    });

    it("las tablas de solo inserción no tienen UPDATE para nadie, y la marca de un tenant no se cambia por columna", async () => {
      const permitidos = await filas(
        `select grantee, table_name, column_name from information_schema.column_privileges
         where table_schema = 'public' and privilege_type = 'UPDATE' and grantee = any($1)
           and ((table_name in ('plan_de_tenant', 'ajuste_de_perilla'))
                or (table_name = 'tenant' and column_name = 'marca_id'))`,
        [[...ROLES]],
      );
      expect(permitidos).toEqual([]);
    });

    it("la identidad y los contadores de las tablas nuevas no los escribe nadie: ni id, ni creado_en, ni version, ni actualizado_en", async () => {
      const permitidos = await filas(
        `select grantee, table_name, column_name, privilege_type from information_schema.column_privileges
         where table_schema = 'public' and grantee = any($1) and table_name = any($2)
           and privilege_type in ('INSERT', 'UPDATE')
           and column_name in ('id', 'creado_en', 'actualizado_en', 'version', 'es_principal', 'nivel')
           and not (table_name = 'nivel_de_control' and column_name = 'nivel')`,
        [[...ROLES], TABLAS_NUEVAS],
      );
      expect(permitidos).toEqual([]);
    });

    it("toda clave foránea de las tablas nuevas está declarada, y las compuestas de nivel_de_control apoyan en sucursal(id, empresa_id)", async () => {
      const fk = await filas<{ t: string; def: string }>(
        `select conrelid::regclass::text as t, pg_get_constraintdef(oid) as def from pg_constraint
         where contype = 'f' and connamespace = 'public'::regnamespace and conrelid = any($1::regclass[])
         order by 1, 2`,
        [TABLAS_NUEVAS.map((t) => `public.${t}`)],
      );
      expect(fk.map((f) => `${f.t}: ${f.def}`)).toEqual([
        "ajuste_de_perilla: FOREIGN KEY (empresa_id) REFERENCES empresa(id)",
        "ajuste_de_perilla: FOREIGN KEY (tenant_id) REFERENCES tenant(id)",
        "dominio: FOREIGN KEY (duenio_empresa_id) REFERENCES empresa(id)",
        "dominio: FOREIGN KEY (duenio_marca_id) REFERENCES marca(id)",
        "dominio: FOREIGN KEY (marca_id) REFERENCES marca(id)",
        "marca: FOREIGN KEY (marca_padre_id) REFERENCES marca(id)",
        "modulo_de_empresa: FOREIGN KEY (empresa_id) REFERENCES empresa(id)",
        "nivel_de_control: FOREIGN KEY (empresa_id) REFERENCES empresa(id)",
        "nivel_de_control: FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal(id, empresa_id)",
        "plan_de_tenant: FOREIGN KEY (tenant_id) REFERENCES tenant(id)",
        "plan_de_tenant: FOREIGN KEY (version_de_plan_id) REFERENCES version_de_plan(id)",
        "version_de_marca: FOREIGN KEY (marca_id) REFERENCES marca(id)",
        "version_de_marca: FOREIGN KEY (plan_por_defecto_id) REFERENCES plan(id)",
        "version_de_plan: FOREIGN KEY (plan_id) REFERENCES plan(id)",
      ]);
    });

    it("las únicas de las tablas con empresa_id la incluyen, y las parciales son las declaradas", async () => {
      const unicas = await filas<{ tabla: string; indice: string; def: string }>(
        `select c.relname as tabla, ic.relname as indice, pg_get_indexdef(i.indexrelid) as def
         from pg_index i join pg_class c on c.oid = i.indrelid join pg_class ic on ic.oid = i.indexrelid
         where c.relnamespace = 'public'::regnamespace and i.indisunique and c.relname = any($1)
         order by 1, 2`,
        [TABLAS_NUEVAS],
      );
      const sinPk = unicas.filter((u) => !u.indice.endsWith("_pkey"));
      expect(sinPk.map((u) => `${u.tabla}.${u.indice}`)).toEqual([
        "ajuste_de_perilla.ajuste_de_perilla_numero_uk",
        "dominio.dominio_canonico_uk",
        "dominio.dominio_host_uk",
        "marca.marca_codigo_uk",
        "marca.marca_principal_uk",
        "nivel_de_control.nivel_de_control_uk",
        "plan.plan_codigo_uk",
        "plan_de_tenant.plan_de_tenant_numero_uk",
        "version_de_marca.version_de_marca_borrador_uk",
        "version_de_marca.version_de_marca_numero_uk",
        "version_de_plan.version_de_plan_borrador_uk",
        "version_de_plan.version_de_plan_numero_uk",
      ]);
      const def = (indice: string) => unicas.find((u) => u.indice === indice)?.def ?? "";
      // Las parciales: el host solo vale mientras no está retirado, el canónico es uno por marca y
      // superficie, un borrador por marca y por plan, una sola principal.
      expect(def("dominio_host_uk")).toMatch(/\(host\) WHERE \(estado <> 'RETIRADO'::text\)$/);
      expect(def("dominio_canonico_uk")).toMatch(
        /\(duenio_marca_id, superficie\) WHERE \(es_canonico AND \(estado <> 'RETIRADO'::text\)\)$/,
      );
      expect(def("version_de_marca_borrador_uk")).toMatch(
        /\(marca_id\) WHERE \(estado = 'BORRADOR'::text\)$/,
      );
      expect(def("version_de_plan_borrador_uk")).toMatch(
        /\(plan_id\) WHERE \(estado = 'BORRADOR'::text\)$/,
      );
      expect(def("marca_principal_uk")).toMatch(/\(\(true\)\) WHERE es_principal$/);
      // Las que llevan una columna nula comparan los nulos como iguales (NULLS NOT DISTINCT).
      expect(def("ajuste_de_perilla_numero_uk")).toMatch(/NULLS NOT DISTINCT/);
      expect(def("nivel_de_control_uk")).toMatch(/NULLS NOT DISTINCT/);
      // Y las dos con empresa_id la incluyen.
      expect(def("ajuste_de_perilla_numero_uk")).toMatch(
        /\(tenant_id, empresa_id, perilla, numero\)/,
      );
      expect(def("nivel_de_control_uk")).toMatch(/\(empresa_id, sucursal_id, control\)/);
    });

    it("la única vista es resolucion_de_host (con los privilegios de quien consulta) y la única SECURITY DEFINER sigue siendo contexto_firmado", async () => {
      const definer = await filas<{ proname: string }>(
        `select proname from pg_proc where pronamespace = 'public'::regnamespace and prosecdef order by 1`,
      );
      expect(definer.map((f) => f.proname)).toEqual(["contexto_firmado"]);
      expect(
        await filas(
          `select relname, relkind, reloptions from pg_class
           where relnamespace = 'public'::regnamespace and relkind in ('v', 'm')`,
        ),
      ).toEqual([
        { relname: "resolucion_de_host", relkind: "v", reloptions: ["security_invoker=true"] },
      ]);
    });

    it("las funciones nuevas fijan su search_path, nacen cerradas para PUBLIC y las de validación son IMMUTABLE y las ejecuta solo la plataforma", async () => {
      const funciones = await filas<{
        firma: string;
        volatilidad: string;
        proconfig: string[] | null;
        publica: boolean;
      }>(
        `select p.oid::regprocedure::text as firma, p.provolatile as volatilidad, p.proconfig,
                (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a
                                              where a.grantee = 0 and a.privilege_type = 'EXECUTE')) as publica
         from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname in ('host_valido', 'texto_visible_valido', 'tema_valido', 'vocabulario_valido',
                             'perillas_validas', 'claves_de_modulo_validas', 'sin_borrado',
                             'version_congelada_no_se_borra', 'marca_validar_alta', 'marca_validar_cambio',
                             'dominio_validar_alta', 'dominio_validar_cambio',
                             'plan_validar_cambio', 'version_de_plan_validar_alta', 'version_de_plan_validar_cambio',
                             'version_de_marca_validar_alta', 'version_de_marca_validar_cambio',
                             'plan_de_tenant_validar_alta', 'ajuste_de_perilla_validar_alta', 'tenant_validar_marca')
         order by 1`,
      );
      expect(funciones).toHaveLength(20);
      for (const f of funciones) {
        expect(f.proconfig, f.firma).toContain("search_path=pg_catalog, public, pg_temp");
        expect(f.publica, `${f.firma} abierta a PUBLIC`).toBe(false);
      }
      const validacion = funciones.filter((f) =>
        FUNCIONES_DE_VALIDACION.includes(f.firma.replace("public.", "") as never),
      );
      expect(validacion).toHaveLength(6);
      for (const f of validacion) expect(f.volatilidad, f.firma).toBe("i");
      for (const firma of FUNCIONES_DE_VALIDACION) {
        for (const rol of ROLES) {
          const { rows } = await dueno.query<{ puede: boolean }>(
            `select has_function_privilege($1, $2::regprocedure, 'EXECUTE') as puede`,
            [rol, `public.${firma}`],
          );
          expect(rows[0]?.puede, `${rol} ejecuta ${firma}`).toBe(rol === "zuluhub_plataforma");
        }
      }
    });

    it("las funciones de validación no leen ninguna tabla", async () => {
      const funciones = await filas<{ firma: string; fuente: string }>(
        `select p.oid::regprocedure::text as firma, p.prosrc as fuente from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname in ('host_valido', 'texto_visible_valido', 'tema_valido', 'vocabulario_valido',
                             'perillas_validas', 'claves_de_modulo_validas')`,
      );
      expect(funciones).toHaveLength(6);
      const tablas = new Set(
        (
          await filas<{ relname: string }>(
            `select relname from pg_class where relnamespace = 'public'::regnamespace`,
          )
        ).map((t) => t.relname),
      );
      for (const f of funciones) {
        for (const tabla of tablas) {
          expect(f.fuente, `${f.firma} menciona la tabla ${tabla}`).not.toMatch(
            new RegExp(`\\b(from|join)\\s+(public\\.)?${tabla}\\b`, "i"),
          );
        }
      }
    });
  });

  // ===========================================================================================
  // 2. El rol público
  // ===========================================================================================
  describe("el sexto rol, zuluhub_publico", () => {
    it("sin superusuario, sin BYPASSRLS, sin pertenencias, sin LOGIN en la migración y con los topes de tiempo", async () => {
      const [rol] = await filas<Record<string, unknown>>(
        `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit
         from pg_roles where rolname = 'zuluhub_publico'`,
      );
      expect(rol).toMatchObject({
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        rolinherit: false,
      });
      expect(
        await filas(
          `select 1 from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = 'zuluhub_publico'`,
        ),
      ).toEqual([]);
      const [topes] = await filas<{ setconfig: string[] }>(
        `select s.setconfig from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
         where s.setdatabase = 0 and r.rolname = 'zuluhub_publico'`,
      );
      expect([...(topes?.setconfig ?? [])].sort()).toEqual([
        "idle_in_transaction_session_timeout=60s",
        "lock_timeout=15s",
        "statement_timeout=30s",
      ]);
      const { rows: temp } = await dueno.query<{ temp: boolean }>(
        `select has_database_privilege('zuluhub_publico', current_database(), 'TEMP') as temp`,
      );
      expect(temp).toEqual([{ temp: false }]);
    });

    it("solo lee: ni escribe, ni borra, ni ejecuta funciones, ni crea objetos, ni es dueño de nada", async () => {
      expect(
        await filas(
          `select table_name, privilege_type from information_schema.table_privileges
           where grantee = 'zuluhub_publico' and privilege_type <> 'SELECT'`,
        ),
      ).toEqual([]);
      expect(
        await filas(
          `select table_name, column_name, privilege_type from information_schema.column_privileges
           where grantee = 'zuluhub_publico' and privilege_type not in ('SELECT')
             and table_schema = 'public'`,
        ),
      ).toEqual([]);
      const { rows: ejecutables } = await dueno.query<{ firma: string }>(
        `select p.oid::regprocedure::text as firma from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
           and has_function_privilege('zuluhub_publico', p.oid, 'EXECUTE')`,
      );
      // Ninguna función propia (las nuevas nacen cerradas); las que nacieron en otras migraciones tampoco.
      expect(ejecutables.map((f) => f.firma)).toEqual([]);
      const { rows: esquema } = await dueno.query<{ crear: boolean; usar: boolean }>(
        `select has_schema_privilege('zuluhub_publico', 'public', 'CREATE') as crear,
                has_schema_privilege('zuluhub_publico', 'public', 'USAGE') as usar`,
      );
      expect(esquema).toEqual([{ crear: false, usar: true }]);
      const { rows: bd } = await dueno.query<{ crear: boolean }>(
        `select has_database_privilege('zuluhub_publico', current_database(), 'CREATE') as crear`,
      );
      expect(bd).toEqual([{ crear: false }]);
      expect(
        await filas(
          `select 1 from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = 'zuluhub_publico'`,
        ),
      ).toEqual([]);
    });

    it("lee exactamente las columnas públicas de tres tablas y de la vista de resolución, y ninguna tiene nombre de secreto (NOMBRE_DE_SECRETO)", async () => {
      const columnas = await filas<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.column_privileges
         where grantee = 'zuluhub_publico' and privilege_type = 'SELECT' and table_schema = 'public'
         order by 1, 2`,
      );
      expect([...new Set(columnas.map((c) => c.table_name))]).toEqual([
        "dominio",
        "marca",
        "resolucion_de_host",
        "version_de_marca",
      ]);
      // marca (5) + dominio (6) + la vista (5) + version_de_marca (7)
      expect(columnas).toHaveLength(23);
      const nombres = Object.fromEntries(
        columnas.map((c) => [`${c.table_name}.${c.column_name}`, ""]),
      );
      for (const campo of Object.keys(nombres)) {
        expect(campoConPosibleSecreto({ [campo.split(".")[1] as string]: "" }), campo).toBeNull();
      }
      // Lo que NUNCA ve: módulos iniciales, plan por defecto, motivo, quién y cuándo se confirmó.
      const vistas = new Set(columnas.map((c) => `${c.table_name}.${c.column_name}`));
      for (const privada of [
        "version_de_marca.modulos_iniciales",
        "version_de_marca.plan_por_defecto_id",
        "version_de_marca.motivo",
        "version_de_marca.confirmada_por",
        "version_de_marca.estado",
        "dominio.registrado_por",
        "dominio.motivo",
        "dominio.titular",
        "dominio.verificado_en",
        "dominio.es_canonico",
        "resolucion_de_host.titular",
        "resolucion_de_host.estado",
        "marca.estado",
      ]) {
        expect(vistas.has(privada), privada).toBe(false);
      }
    });

    it("sus políticas son exactamente tres, y filtran por estado y vigencia", async () => {
      const politicas = await filas<{ p: string; qual: string }>(
        `select format('%s.%s:%s:%s', tablename, policyname, cmd, permissive) as p, qual
         from pg_policies where schemaname = 'public' and 'zuluhub_publico' = any (roles) order by 1`,
      );
      expect(politicas.map((f) => f.p)).toEqual([
        "dominio.dominio_publico_leer:SELECT:PERMISSIVE",
        "marca.marca_publico_leer:SELECT:PERMISSIVE",
        "version_de_marca.version_de_marca_publico_leer:SELECT:PERMISSIVE",
      ]);
      expect(politicas[0]?.qual).toBe("(estado = 'ACTIVO'::text)");
      expect(politicas[1]?.qual).toBe("(estado = 'ACTIVA'::text)");
      expect(politicas[2]?.qual).toBe(
        "((estado = 'CONFIRMADA'::text) AND (vigente_desde <= now()))",
      );
    });
  });

  // ===========================================================================================
  // 3. Las funciones de validación frente a sus pares de TypeScript
  // ===========================================================================================
  describe("host_valido es exactamente normalizarHost sobre un host ya normalizado", () => {
    // Los casos de las pruebas de M1, los más hostiles (el signo Kelvin y la «i con punto» se escriben con
    // escapes para que el archivo no los esconda).
    const FIJOS = [
      "micalendario.com",
      "app.micalendario.com",
      "localhost",
      "a",
      "a.b.c.d.e.f",
      "mi-calendario.com",
      "1abc.com",
      "123abc.com",
      "1.a",
      "xn--cala-9qa.com",
      "xn--mi-calendario-x1b.xn--p1ai",
      "a.1a",
      "a.0xg",
      "a.com.ar",
      "www.micalendario.com",
      "micalendario.com.otro.net",
      "x.micalendario.com",
      "MiCalendario.COM",
      "micalendario.com:3000",
      "micalendario.com.",
      "micalendario.com.:443",
      "a.com:65535",
      "a.com:65536",
      "a".repeat(63) + ".com",
      "a".repeat(64) + ".com",
      [63, 63, 63, 61].map((n) => "a".repeat(n)).join("."),
      [63, 63, 63, 62].map((n) => "a".repeat(n)).join("."),
      "",
      ".",
      "..",
      "a..b",
      ".a.com",
      "a.com..",
      ":80",
      "-a.com",
      "a-.com",
      "a.-b.com",
      "-",
      "a b.com",
      " a.com",
      "a.com ",
      "a.com\n",
      "a.com\t",
      "a_b.com",
      "ñandu.com",
      "café.com",
      "münchen.de",
      "日本.jp",
      "\u212alendar.com",
      "\u212aalendar.com",
      "\u0130stanbul.com",
      "\uff41.com",
      "\u017fecret.com",
      "a\u3002com",
      "a\u200b.com",
      "😀.com",
      "a.com:",
      "a.com:abc",
      "a.com:80a",
      "a.com:-1",
      "a.com:80:80",
      "a.com::80",
      "a.com:80.",
      "a.com/",
      "a.com/ruta",
      "http://a.com",
      "usuario@a.com",
      "a.com?x=1",
      "a.com#x",
      "*.a.com",
      "*",
      "a.com,b.com",
      "a.com;b.com",
      "a.com\\b",
      "a(b).com",
      "::1",
      "[::1]",
      "[::1]:3000",
      "2001:db8:85a3::8a2e:370:7334",
      "127.0.0.1",
      "127.0.0.1:3000",
      "192.168.0.1.",
      "0.0.0.0",
      "255.255.255.255",
      "1.2.3",
      "127.1",
      "2130706433",
      "12345",
      "0",
      "0x7f.0.0.1",
      "127.0.0.0x1",
      "0x7f000001",
      "0X7F.1",
      "a.0x",
      "a.0xdeadbeef",
      "a.com.1",
      "mi-sitio.123",
      "1.2.3.com",
      "0x7f.com",
      "a.0xfg",
      "a.x0x1",
    ];

    // El mismo alfabeto rico en lo peligroso de las propiedades de M1.
    const caracter = fc.constantFrom(..."abcxyzABCXYZ019-.:x_ []/\u212a\u0130é\u3002\n".split(""));
    const textoCualquiera = fc.oneof(
      fc.string({ unit: caracter, maxLength: 24 }),
      fc.string({ maxLength: 40 }),
    );
    const etiqueta = fc.stringMatching(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,10}[a-zA-Z0-9])?$/);
    const hostBienFormado = fc
      .tuple(
        fc.array(etiqueta, { minLength: 1, maxLength: 5 }),
        fc.constantFrom("a", "com", "ar", "xn--p1ai", "9x", "Z", "0xg", "1a"),
      )
      .map(([etiquetas, tld]) => [...etiquetas, tld].join("."));
    const decorado = fc
      .tuple(
        hostBienFormado,
        fc.boolean(),
        fc.option(fc.integer({ min: 0, max: 65_535 }), { nil: undefined }),
      )
      .map(
        ([host, punto, puerto]) =>
          `${host}${punto ? "." : ""}${puerto === undefined ? "" : `:${puerto}`}`,
      );

    it("coincide en los casos fijos, en miles de textos al azar y en la forma normalizada de cada uno", async () => {
      const candidatos = new Set<string>(FIJOS);
      for (const t of fc.sample(fc.oneof(textoCualquiera, decorado, hostBienFormado), 6000))
        candidatos.add(t);
      // La forma normalizada de lo que normalizarHost acepta: la base la tiene que aceptar siempre.
      for (const t of [...candidatos]) {
        const r = normalizarHost(t);
        if (r.ok) candidatos.add(r.valor);
      }
      // Postgres no guarda el carácter nulo: ese caso se prueba solo del lado de TypeScript.
      expect(normalizarHost("a\u0000.com").ok).toBe(false);
      const lista = [...candidatos].filter((t) => !t.includes("\u0000"));
      const { rows } = await dueno.query<{ t: string; v: boolean }>(
        `select t, host_valido(t) as v from unnest($1::text[]) as t`,
        [lista],
      );
      expect(rows).toHaveLength(lista.length);
      const distintos = rows
        .filter((r) => {
          const n = normalizarHost(r.t);
          return r.v !== (n.ok && n.valor === r.t);
        })
        .map((r) => r.t);
      expect(distintos).toEqual([]);
      // El control positivo: hay de las dos clases, y la forma normalizada nunca se rechaza.
      expect(rows.some((r) => r.v)).toBe(true);
      expect(rows.some((r) => !r.v)).toBe(true);
      expect(lista.length).toBeGreaterThan(3000);
    });

    it("NULL no es un host válido", async () => {
      const { rows } = await dueno.query<{ v: boolean }>("select host_valido(null) as v");
      expect(rows).toEqual([{ v: false }]);
    });
  });

  describe("texto_visible_valido es validarTextoVisible sobre un texto ya canónico", () => {
    // Todos los puntos de código salvo el nulo (Postgres no lo guarda) y los sustitutos (no son texto).
    const SQL_TODOS = `select cp from generate_series(1, 1114111) as cp
                       where cp not between 55296 and 57343`;

    it("rechaza exactamente los caracteres de control, de formato, «<» y «>»: la misma lista que Node, sobre TODOS los puntos de código", async () => {
      const { rows: noNfcEnLaBase } = await dueno.query<{ cp: number }>(
        `select cp from (${SQL_TODOS}) t where not (chr(cp) is nfc normalized)`,
      );
      const noNfcSql = new Set(noNfcEnLaBase.map((r) => r.cp));
      const noNfcJs = new Set<number>();
      for (let cp = 1; cp <= 0x10ffff; cp++) {
        if (cp >= 0xd800 && cp <= 0xdfff) continue;
        const s = String.fromCodePoint(cp);
        if (s.normalize("NFC") !== s) noNfcJs.add(cp);
      }
      // Postgres y Node pueden tener versiones de Unicode distintas: los pocos caracteres cuya forma NFC
      // difiere entre ambos no entran en esta comparación (la prueba del NFC es la de abajo).
      const dudosos = new Set<number>();
      for (const cp of noNfcSql) if (!noNfcJs.has(cp)) dudosos.add(cp);
      for (const cp of noNfcJs) if (!noNfcSql.has(cp)) dudosos.add(cp);
      expect(dudosos.size, "la diferencia de Unicode entre Postgres y Node es chica").toBeLessThan(
        200,
      );

      const { rows } = await dueno.query<{ cp: number }>(
        `select cp from (${SQL_TODOS}) t
         where not texto_visible_valido('1' || chr(cp) || '1', 60) order by cp`,
      );
      const rechazadosSql = rows.map((r) => r.cp).filter((cp) => !dudosos.has(cp));
      const rechazadosJs: number[] = [];
      for (let cp = 1; cp <= 0x10ffff; cp++) {
        if (cp >= 0xd800 && cp <= 0xdfff) continue;
        if (dudosos.has(cp)) continue;
        const s = `1${String.fromCodePoint(cp)}1`;
        const r = validarTextoVisible(s, 60);
        if (!(r.ok && r.valor === s)) rechazadosJs.push(cp);
      }
      // Si Node cambia de versión de Unicode y suma un carácter de formato, esta comparación avisa: hay
      // que actualizar la lista de `texto_visible_valido` en una migración nueva.
      expect(rechazadosSql).toEqual(rechazadosJs);
      expect(rechazadosJs.length).toBeGreaterThan(200);
    });

    it("rechaza todo blanco al principio o al final que String.prototype.trim recortaría", async () => {
      const blancos: number[] = [];
      for (let cp = 1; cp <= 0xffff; cp++) {
        if (/\s/u.test(String.fromCodePoint(cp))) blancos.push(cp);
      }
      expect(blancos.length).toBeGreaterThan(20);
      const { rows } = await dueno.query<{
        cp: number;
        al_inicio: boolean;
        al_final: boolean;
        medio: boolean;
      }>(
        `select cp, texto_visible_valido(chr(cp) || 'x', 60) as al_inicio,
                texto_visible_valido('x' || chr(cp), 60) as al_final,
                texto_visible_valido('x' || chr(cp) || 'x', 60) as medio
         from unnest($1::int[]) as cp`,
        [blancos],
      );
      for (const r of rows) {
        expect(r.al_inicio, `U+${r.cp.toString(16)} al inicio`).toBe(false);
        expect(r.al_final, `U+${r.cp.toString(16)} al final`).toBe(false);
        // En el medio un espacio es texto: solo lo rechaza lo que ya es control o formato.
        const s = `x${String.fromCodePoint(r.cp)}x`;
        const js = validarTextoVisible(s, 60);
        expect(r.medio, `U+${r.cp.toString(16)} en el medio`).toBe(js.ok && js.valor === s);
      }
    });

    it("el largo se mide en caracteres (puntos de código), igual que el dominio: 60 pasan, 61 no", async () => {
      const casos = [
        "🙂".repeat(60),
        "🙂".repeat(61),
        "a".repeat(60),
        "a".repeat(61),
        "é".repeat(60),
      ];
      const { rows } = await dueno.query<{ t: string; v60: boolean; v200: boolean }>(
        `select t, texto_visible_valido(t, 60) as v60, texto_visible_valido(t, 200) as v200 from unnest($1::text[]) as t`,
        [casos],
      );
      for (const r of rows) {
        const js60 = validarTextoVisible(r.t, 60);
        const js200 = validarTextoVisible(r.t, 200);
        expect(r.v60, `60: ${r.t.slice(0, 5)}…`).toBe(js60.ok && js60.valor === r.t);
        expect(r.v200, `200: ${r.t.slice(0, 5)}…`).toBe(js200.ok && js200.valor === r.t);
      }
      expect(rows.map((r) => r.v60)).toEqual([true, false, true, false, true]);
    });

    it("pide la forma NFC (el dominio la entrega canónica) y rechaza vacío, NULL y un máximo imposible", async () => {
      const { rows } = await dueno.query<{
        nfc: boolean;
        nfd: boolean;
        vacio: boolean;
        nulo: boolean;
        max0: boolean;
      }>(
        `select texto_visible_valido(chr(233), 60) as nfc,
                texto_visible_valido('e' || chr(769), 60) as nfd,
                texto_visible_valido('', 60) as vacio,
                texto_visible_valido(null, 60) as nulo,
                texto_visible_valido('a', 0) as max0`,
      );
      expect(rows).toEqual([{ nfc: true, nfd: false, vacio: false, nulo: false, max0: false }]);
      expect(validarTextoVisible("e\u0301", 60)).toEqual({ ok: true, valor: "é" });
    });

    it("todo texto por defecto del catálogo del código es un texto válido para la base (con el tope de 200)", async () => {
      const textos = Object.values(CATALOGO_DE_TEXTOS).map((d) => d.porDefecto);
      const { rows } = await dueno.query<{ t: string; v: boolean }>(
        `select t, texto_visible_valido(t, 200) as v from unnest($1::text[]) as t`,
        [textos],
      );
      expect(rows.filter((r) => !r.v)).toEqual([]);
      expect(rows.length).toBeGreaterThan(5);
    });
  });

  describe("tema_valido es validarTema", () => {
    const CASOS: Record<string, unknown>[] = [
      {},
      { primary: "#aabbcc" },
      { "on-primary": "#ffffff", secondary: "#000000", accent: "#123abc", primary: "#00ff00" },
      { primary: "#AABBCC" },
      { primary: "#FFF" },
      { primary: "#fff" },
      { primary: "#aabbcc00" },
      { primary: "aabbcc" },
      { primary: "rgb(1,2,3)" },
      { primary: "url(javascript:alert(1))" },
      { primary: "#aabbcc;}" },
      { primary: "#aabbcc\n" },
      { primary: "red" },
      { primary: "" },
      { primary: 5 },
      { primary: null },
      { primary: ["#aabbcc"] },
      { primary: { x: "#aabbcc" } },
      { fondo: "#aabbcc" },
      { Primary: "#aabbcc" },
      { "--brand-primary": "#aabbcc" },
      { primary: "#aabbcc", extra: "#aabbcc" },
    ];

    it("coincide en cada caso (clave fuera de la lista, formato del color, tipos)", async () => {
      const { rows } = await dueno.query<{ i: number; v: boolean }>(
        `select i - 1 as i, tema_valido(t) as v from unnest($1::jsonb[]) with ordinality as x(t, i)`,
        [CASOS.map((c) => JSON.stringify(c))],
      );
      expect(rows).toHaveLength(CASOS.length);
      for (const r of rows) {
        expect(r.v, JSON.stringify(CASOS[r.i])).toBe(
          validarTema(CASOS[r.i] as Record<string, unknown>).ok,
        );
      }
      expect(rows.some((r) => r.v) && rows.some((r) => !r.v)).toBe(true);
    });

    it("solo un objeto: un arreglo, un texto, un número, un booleano o NULL no son un tema", async () => {
      const { rows } = await dueno.query<{ v: boolean }>(
        `select tema_valido(t) as v from unnest(array['[]', '"x"', '1', 'true', 'null']::jsonb[]) as t
         union all select tema_valido(null)`,
      );
      expect(rows.map((r) => r.v)).toEqual([false, false, false, false, false, false]);
    });
  });

  describe("vocabulario_valido", () => {
    const FORMATO_DE_CLAVE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,5}$/;

    it("la clave tiene la forma del catálogo, en minúsculas (la misma expresión del dominio)", async () => {
      const claves = [
        "modulo.administracion.nombre",
        "motivo.sin_permiso",
        "error.limite_del_plan",
        "a.b",
        "a.b.c.d.e.f",
        "a.b.c.d.e.f.g",
        "a",
        "",
        ".a",
        "a.",
        "a..b",
        "A.b",
        "a.B",
        "rol.GERENTE.nombre",
        "motivo.SIN_PERMISO",
        "1a.b",
        "_a.b",
        "a-b.c",
        "a b.c",
        "a.b\n",
        "á.b",
        "a.b".repeat(41),
        ...fc.sample(
          fc.string({ unit: fc.constantFrom(..."ab_9.AB-é \n".split("")), maxLength: 14 }),
          1500,
        ),
      ];
      const lista = claves.filter((c) => !c.includes("\u0000"));
      const { rows } = await dueno.query<{ c: string; v: boolean }>(
        `select c, vocabulario_valido(jsonb_build_object(c, 'Texto')) as v from unnest($1::text[]) as c`,
        [lista],
      );
      // El tope de 120 caracteres de la clave es solo de la base (el catálogo no tiene claves tan largas).
      const distintos = rows
        .filter((r) => r.v !== (FORMATO_DE_CLAVE.test(r.c) && r.c.length <= 120))
        .map((r) => r.c);
      expect(distintos).toEqual([]);
      expect(rows.some((r) => r.v) && rows.some((r) => !r.v)).toBe(true);
    });

    it("el valor es un texto visible de 1 a 200 caracteres en forma canónica; el resto, no", async () => {
      const valores: unknown[] = [
        "Nueva reserva",
        "x",
        "a".repeat(200),
        "a".repeat(201),
        "",
        " x",
        "x ",
        "a<b",
        "a>b",
        "a\u200bb",
        "a\u0007b",
        "e\u0301",
        5,
        null,
        true,
        ["x"],
        { x: "y" },
      ];
      const { rows } = await dueno.query<{ i: number; v: boolean }>(
        `select i - 1 as i, vocabulario_valido(jsonb_build_object('a.b', v)) as v
         from unnest($1::jsonb[]) with ordinality as x(v, i)`,
        [valores.map((v) => JSON.stringify(v))],
      );
      for (const r of rows) {
        const v = valores[r.i];
        const esperado =
          typeof v === "string" &&
          (() => {
            const t = validarTextoVisible(v, 200);
            return t.ok && t.valor === v;
          })();
        expect(r.v, JSON.stringify(v)).toBe(esperado);
      }
    });

    it("a lo sumo 500 textos; vacío vale; solo un objeto", async () => {
      const con = (n: number) =>
        Object.fromEntries(Array.from({ length: n }, (_, i) => [`a.k${i}`, "t"]));
      const { rows } = await dueno.query<{ v: boolean }>(
        `select vocabulario_valido(v::jsonb) as v from unnest($1::text[]) as v`,
        [[{}, con(500), con(501)].map((v) => JSON.stringify(v))],
      );
      expect(rows.map((r) => r.v)).toEqual([true, true, false]);
      const { rows: otros } = await dueno.query<{ v: boolean }>(
        `select vocabulario_valido(v) as v from unnest(array['[]', '"x"', '1', 'null']::jsonb[]) as v
         union all select vocabulario_valido(null)`,
      );
      expect(otros.map((r) => r.v)).toEqual([false, false, false, false, false]);
    });

    it("todo el catálogo de textos del código, como diccionario, es un vocabulario válido para la base", async () => {
      const diccionario = Object.fromEntries(
        Object.entries(CATALOGO_DE_TEXTOS).map(([clave, d]) => [clave, d.porDefecto]),
      );
      const { rows } = await dueno.query<{ v: boolean }>(
        "select vocabulario_valido($1::jsonb) as v",
        [JSON.stringify(diccionario)],
      );
      expect(rows).toEqual([{ v: true }]);
    });
  });

  describe("perillas_validas es esValorDeLaPerilla (con la forma exacta de ValorDePerilla)", () => {
    const interruptor = { tipo: "INTERRUPTOR" } as const;
    const limite = { tipo: "LIMITE" } as const;
    const CASOS: { valor: unknown; sinExtras: boolean }[] = [
      ...[
        { tipo: "INTERRUPTOR", encendida: true },
        { tipo: "INTERRUPTOR", encendida: false },
        { tipo: "INTERRUPTOR", encendida: 1 },
        { tipo: "INTERRUPTOR", encendida: "true" },
        { tipo: "INTERRUPTOR" },
        { tipo: "LIMITE", limite: 0 },
        { tipo: "LIMITE", limite: 1 },
        { tipo: "LIMITE", limite: 999_999_999 },
        { tipo: "LIMITE", limite: 1_000_000_000 },
        { tipo: "LIMITE", limite: -1 },
        { tipo: "LIMITE", limite: 1.5 },
        { tipo: "LIMITE", limite: "ILIMITADO" },
        { tipo: "LIMITE", limite: "ilimitado" },
        { tipo: "LIMITE", limite: "5" },
        { tipo: "LIMITE", limite: null },
        { tipo: "LIMITE", limite: true },
        { tipo: "LIMITE" },
        { tipo: "LIMITE", encendida: true },
        { tipo: "INTERRUPTOR", limite: 3 },
        { tipo: "NIVEL", limite: 3 },
        { encendida: true },
        { limite: 3 },
        {},
        "ILIMITADO",
        5,
        true,
        null,
        [],
      ].map((valor) => ({ valor, sinExtras: true })),
    ];

    it("coincide con el dominio en cada caso (un valor es de un interruptor o de un límite)", async () => {
      const { rows } = await dueno.query<{ i: number; v: boolean }>(
        `select i - 1 as i, perillas_validas(jsonb_build_object('empresas_por_tenant', v), false) as v
         from unnest($1::jsonb[]) with ordinality as x(v, i)`,
        [CASOS.map((c) => JSON.stringify(c.valor))],
      );
      for (const r of rows) {
        const c = CASOS[r.i] as (typeof CASOS)[number];
        const esperado =
          esValorDeLaPerilla(interruptor, c.valor) || esValorDeLaPerilla(limite, c.valor);
        expect(r.v, JSON.stringify(c.valor)).toBe(esperado);
      }
      expect(rows.some((r) => r.v) && rows.some((r) => !r.v)).toBe(true);
    });

    it("la base es MÁS estricta que el dominio en una cosa: rechaza campos de más (el dominio los deja pasar)", async () => {
      const conExtra = [
        { tipo: "INTERRUPTOR", encendida: true, extra: 1 },
        { tipo: "LIMITE", limite: 1, extra: 1 },
      ];
      for (const v of conExtra) {
        expect(esValorDeLaPerilla(v.tipo === "LIMITE" ? limite : interruptor, v)).toBe(true);
        const { rows } = await dueno.query<{ v: boolean }>(
          "select perillas_validas(jsonb_build_object('empresas_por_tenant', $1::jsonb), false) as v",
          [JSON.stringify(v)],
        );
        expect(rows, JSON.stringify(v)).toEqual([{ v: false }]);
      }
    });

    it("DEL_PLAN solo vale si se lo admite (una versión de plan no lo admite); el nombre de la perilla tiene su forma", async () => {
      const { rows } = await dueno.query<{ sin: boolean; con: boolean }>(
        `select perillas_validas('{"empresas_por_tenant":"DEL_PLAN"}', false) as sin,
                perillas_validas('{"empresas_por_tenant":"DEL_PLAN"}', true) as con`,
      );
      expect(rows).toEqual([{ sin: false, con: true }]);
      const valor = '{"tipo":"INTERRUPTOR","encendida":true}';
      const nombres = [
        "a1",
        "empresas_por_tenant",
        "a.b",
        "A1",
        "1a",
        "a",
        "a b",
        "_a",
        "a".repeat(64),
        "a".repeat(65),
      ];
      const { rows: n } = await dueno.query<{ nombre: string; v: boolean }>(
        `select nombre, perillas_validas(jsonb_build_object(nombre, $1::jsonb), false) as v
         from unnest($2::text[]) as nombre`,
        [valor, nombres],
      );
      expect(n.map((r) => r.v)).toEqual([
        true,
        true,
        true,
        false,
        false,
        false,
        false,
        false,
        true,
        false,
      ]);
    });

    it("vacío vale; a lo sumo 200 perillas; solo un objeto", async () => {
      const con = (k: number) =>
        Object.fromEntries(
          Array.from({ length: k }, (_, i) => [`p${i}`, { tipo: "LIMITE", limite: 1 }]),
        );
      const { rows } = await dueno.query<{ v: boolean }>(
        `select perillas_validas(p::jsonb, false) as v from unnest($1::text[]) as p`,
        [[{}, con(200), con(201)].map((p) => JSON.stringify(p))],
      );
      expect(rows.map((r) => r.v)).toEqual([true, true, false]);
      const { rows: otros } = await dueno.query<{ v: boolean }>(
        `select perillas_validas(p, false) as v from unnest(array['[]', '"x"', '1', 'null']::jsonb[]) as p
         union all select perillas_validas(null, false) union all select perillas_validas('{}', null)`,
      );
      expect(otros.map((r) => r.v)).toEqual([false, false, false, false, false, false]);
    });
  });

  describe("claves_de_modulo_validas", () => {
    it("sin NULL, sin repetidos, de una dimensión, con la forma de la clave de módulo y a lo sumo 100", async () => {
      const casos: [string, boolean][] = [
        ["{}", true],
        ["{administracion}", true],
        ["{administracion,clientes,reservas}", true],
        ["{a1}", true],
        ["{a}", false],
        ["{A1}", false],
        ["{1a}", false],
        ["{a-b}", false],
        ["{a1,a1}", false],
        ["{a1,NULL}", false],
        ["{{a1,b1},{c1,d1}}", false],
        [`{${"a".repeat(41)}}`, false],
        [`{${"a".repeat(40)}}`, true],
        [`{${Array.from({ length: 100 }, (_, i) => `m${i}`).join(",")}}`, true],
        [`{${Array.from({ length: 101 }, (_, i) => `m${i}`).join(",")}}`, false],
      ];
      const { rows } = await dueno.query<{ i: number; v: boolean }>(
        `select i - 1 as i, claves_de_modulo_validas(m::text[]) as v
         from unnest($1::text[]) with ordinality as x(m, i)`,
        [casos.map(([m]) => m)],
      );
      for (const r of rows) expect(r.v, casos[r.i]?.[0]).toBe(casos[r.i]?.[1]);
      const { rows: nulo } = await dueno.query<{ v: boolean }>(
        "select claves_de_modulo_validas(null) as v",
      );
      expect(nulo).toEqual([{ v: false }]);
    });
  });

  describe("los códigos y las rutas con restricción propia coinciden con el dominio", () => {
    it("marca_codigo_ck es validarCodigoDeMarca; plan_codigo_ck tiene la misma forma", async () => {
      const codigos = [
        "zuluhub",
        "micalendario",
        "ab",
        "a",
        "a".repeat(40),
        "a".repeat(41),
        "1ab",
        "-ab",
        "Ab",
        "ab_c",
        "a-b",
        "a--b-",
        "ab\n",
        "",
        "áb",
        ...fc.sample(
          fc.string({ unit: fc.constantFrom(..."ab-9_A".split("")), maxLength: 8 }),
          400,
        ),
      ];
      const { rows } = await dueno.query<{ c: string; marca: boolean }>(
        `select c, c ~ '^[a-z][a-z0-9-]{1,39}$' as marca from unnest($1::text[]) as c`,
        [codigos],
      );
      for (const r of rows) expect(r.marca, r.c).toBe(validarCodigoDeMarca(r.c).ok);
      // Las dos restricciones de la base escriben la misma expresión que el dominio.
      const defs = await filas<{ conname: string; def: string }>(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint
         where conname in ('marca_codigo_ck', 'plan_codigo_ck') order by 1`,
      );
      expect(defs.map((d) => d.def)).toEqual([
        "CHECK ((codigo ~ '^[a-z][a-z0-9-]{1,39}$'::text))",
        "CHECK ((codigo ~ '^[a-z][a-z0-9-]{1,39}$'::text))",
      ]);
    });
  });
});
