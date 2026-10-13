import { randomUUID } from "node:crypto";
import fc from "fast-check";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { domicilioDesdeDatos } from "../../src/primitivas/domicilio/domicilio";
import { PROVINCIAS } from "../../src/primitivas/domicilio/provincias";
import {
  REGLA_DE_EMISOR_POR_DEFECTO,
  TIPOS_DE_COMPROBANTE,
  TRANSICIONES_DE_SERIE,
  confirmarDatosFiscales,
  domicilioId,
  editarBorrador,
  emisorId,
  nuevoBorrador,
  puntoDeVentaId,
  solicitudId,
  transicionDeSerieValida,
  versionId,
  type Serie,
} from "../../src/modulos/fiscal/publico";
import "../propiedades/configuracion";
import { crearEmpresaActiva, crearEntornoDePrueba, cuitAlAzar } from "./entorno";
import {
  acepta,
  check,
  clave,
  conAppDe,
  conPlataformaDe,
  type ActorDePrueba,
  crearDomicilio,
  crearMundo,
  crearPuntoDeVenta,
  crearSerie,
  denegado,
  type DatosDeDomicilio,
  filas,
  intentoDelDueno,
  referencia,
  sinConfirmar,
  usarSerie,
  type Mundo,
} from "./fiscal-apoyo";
import { SesionDePrueba } from "./sesiones";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";

/**
 * H7 (fiscal base), tramo T3: la migración 0006 contra una base real. Qué prueba, en cinco bloques:
 *  1. Catálogo: lo que la base DECLARA (columnas, restricciones, índices, políticas, disparadores,
 *     funciones y privilegios exactos).
 *  2. Emisor: el principal nace con la empresa; el secundario, el CUIT único, la inmutabilidad tras
 *     el primer número y la desactivación.
 *  3. Domicilio y datos fiscales (y la regla del emisor): restricciones y versiones.
 *  4. Punto de venta.
 *  5. Serie de comprobantes: restricciones y la máquina de estados.
 * El aislamiento entre empresas y entre roles está en `fiscal-aislamiento.test.ts`, la concurrencia
 * en `fiscal-concurrencia.test.ts`, el relleno y la reversión en `fiscal-migracion.test.ts` y los
 * debilitamientos propios del SQL en `fiscal-debilitamientos.test.ts`. Las conexiones son directas
 * por `pg` con el rol real y su contexto firmado: no pasan por los repositorios (eso es T4).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000 });

const ROLES = [
  "zuluhub_app",
  "zuluhub_grupo",
  "zuluhub_trabajos",
  "zuluhub_plataforma",
  "zuluhub_autenticacion",
] as const;
const SEARCH_PATH_FIJO = "search_path=pg_catalog, public, pg_temp";
const TABLAS_FISCALES = [
  "datos_fiscales",
  "domicilio",
  "emisor",
  "provincia",
  "punto_de_venta",
  "regla_emisor",
  "serie_comprobante",
] as const;

const FUNCIONES_NUEVAS = [
  "datos_fiscales_validar_alta",
  "datos_fiscales_validar_cambio",
  "emisor_validar_cambio",
  "empresa_crear_emisor_principal",
  "empresa_validar_cuit_fiscal",
  "punto_de_venta_validar_cambio",
  "regla_emisor_validar_alta",
  "regla_emisor_validar_cambio",
  "serie_comprobante_validar_cambio",
] as const;

const AHORA = new Date("2026-10-12T12:00:00Z");
const MAS_TARDE = new Date("2026-10-13T12:00:00Z");

describe.skipIf(base === null)("fiscal: la migración 0006 contra una base real", () => {
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
  const intento = (texto: string, parametros: unknown[] = []) =>
    intentoDelDueno(dueno, texto, parametros);
  const deshacible = <T>(trabajo: () => Promise<T>) => sinConfirmar(dueno, trabajo);

  /** Una sesión de la aplicación en esa empresa; todo se deshace al terminar. */
  const conApp = <T>(
    m: Mundo,
    trabajo: (s: SesionDePrueba) => Promise<T>,
    persona: string | null = m.persona,
  ): Promise<T> => conAppDe(base!, m, trabajo, persona);
  const conPlataforma = <T>(actor: ActorDePrueba, trabajo: (s: SesionDePrueba) => Promise<T>) =>
    conPlataformaDe(base!, actor, trabajo);

  // ===============================================================================================
  // 1. Catálogo
  // ===============================================================================================
  describe("catálogo", () => {
    const columnasDe = async (tabla: string) =>
      (
        await consultar<{ column_name: string }>(
          `select column_name from information_schema.columns
           where table_schema = 'public' and table_name = $1 order by ordinal_position`,
          [tabla],
        )
      ).map((c) => c.column_name);

    it("las tablas existen con exactamente estas columnas, en este orden", async () => {
      expect(await columnasDe("provincia")).toEqual(["codigo", "nombre", "codigo_arca"]);
      expect(await columnasDe("emisor")).toEqual([
        "id",
        "empresa_id",
        "es_principal",
        "activo",
        "cuit",
        "creado_en",
        "actualizado_en",
        "version",
      ]);
      expect(await columnasDe("domicilio")).toEqual([
        "id",
        "empresa_id",
        "calle",
        "numero",
        "piso",
        "departamento",
        "localidad",
        "provincia",
        "codigo_postal",
        "creado_en",
      ]);
      expect(await columnasDe("datos_fiscales")).toEqual([
        "id",
        "empresa_id",
        "emisor_id",
        "estado",
        "numero",
        "razon_social",
        "condicion_iva",
        "domicilio_fiscal_id",
        "inicio_actividades",
        "iibb_numero",
        "iibb_condicion",
        "vigente_desde",
        "confirmada_en",
        "confirmada_por",
        "motivo",
        "creado_por",
        "creado_en",
        "actualizado_en",
        "version",
      ]);
      expect(await columnasDe("regla_emisor")).toEqual([
        "id",
        "empresa_id",
        "estado",
        "numero",
        "permitir_eleccion_manual",
        "vigente_desde",
        "confirmada_en",
        "confirmada_por",
        "motivo",
        "creado_por",
        "creado_en",
        "actualizado_en",
        "version",
      ]);
      expect(await columnasDe("punto_de_venta")).toEqual([
        "id",
        "empresa_id",
        "emisor_id",
        "sucursal_id",
        "domicilio_id",
        "numero",
        "estado",
        "verificacion_arca",
        "creado_en",
        "actualizado_en",
        "version",
        "ambiente", // 0009
      ]);
      expect(await columnasDe("serie_comprobante")).toEqual([
        "empresa_id",
        "punto_de_venta_id",
        "emisor_id",
        "tipo_comprobante",
        "ultimo_numero",
        "estado",
        "numero_en_curso",
        "solicitud_en_curso",
        "en_curso_hasta",
        "motivo_bloqueo",
        "creado_en",
        "actualizado_en",
        "version",
        "ambiente", // 0009
      ]);
    });

    it("RLS activo y forzado, ningún privilegio para PUBLIC, dueña ajena a los roles limitados y clave foránea a empresa", async () => {
      for (const tabla of TABLAS_FISCALES) {
        const [t] = await consultar<{
          relrowsecurity: boolean;
          relforcerowsecurity: boolean;
          dueno: string;
        }>(
          `select c.relrowsecurity, c.relforcerowsecurity, r.rolname as dueno
           from pg_class c join pg_roles r on r.oid = c.relowner
           where c.oid = format('public.%I', $1::text)::regclass`,
          [tabla],
        );
        expect(t?.relrowsecurity, `${tabla}: RLS activo`).toBe(true);
        expect(t?.relforcerowsecurity, `${tabla}: RLS forzado`).toBe(true);
        expect(ROLES, tabla).not.toContain(t?.dueno);
        expect(
          await consultar(
            `select 1 from information_schema.table_privileges
             where table_schema = 'public' and table_name = $1 and grantee = 'PUBLIC'`,
            [tabla],
          ),
          `${tabla}: PUBLIC`,
        ).toEqual([]);
        expect(
          await consultar(
            `select 1 from information_schema.column_privileges
             where table_schema = 'public' and table_name = $1 and grantee = 'PUBLIC'`,
            [tabla],
          ),
          `${tabla}: PUBLIC por columna`,
        ).toEqual([]);
        if ((await columnasDe(tabla)).includes("empresa_id")) {
          const fk = await consultar(
            `select 1 from pg_constraint
             where conrelid = format('public.%I', $1::text)::regclass and contype = 'f'
               and confrelid = 'public.empresa'::regclass`,
            [tabla],
          );
          expect(fk.length, `${tabla}: FK a empresa`).toBeGreaterThan(0);
        }
      }
    });

    it("las restricciones de cada tabla son exactamente estas", async () => {
      const restricciones = await consultar<{ t: string; c: string }>(
        // Postgres 18 registra cada NOT NULL como restricción propia (contype 'n'); Postgres 16 no.
        // Se excluyen para que la lista sea la misma en ambas versiones.
        `select conrelid::regclass::text as t, conname || ':' || contype::text as c from pg_constraint
         where conrelid = any (array['public.provincia','public.emisor','public.domicilio','public.datos_fiscales',
                                     'public.regla_emisor','public.punto_de_venta','public.serie_comprobante']::regclass[])
           and contype <> 'n' order by 1, 2`,
      );
      const de = (tabla: string) => restricciones.filter((r) => r.t === tabla).map((r) => r.c);
      expect(de("provincia")).toEqual([
        "provincia_codigo_arca_uk:u",
        "provincia_codigo_ck:c",
        "provincia_nombre_uk:u",
        "provincia_pkey:p",
      ]);
      expect(de("emisor")).toEqual([
        "emisor_cuit_ck:c",
        "emisor_empresa_id_fkey:f",
        "emisor_id_empresa_uk:u",
        "emisor_pkey:p",
        "emisor_principal_activo_ck:c",
      ]);
      expect(de("domicilio")).toEqual([
        "domicilio_calle_ck:c",
        "domicilio_codigo_postal_ck:c",
        "domicilio_departamento_ck:c",
        "domicilio_empresa_id_fkey:f",
        "domicilio_id_empresa_uk:u",
        "domicilio_localidad_ck:c",
        "domicilio_numero_ck:c",
        "domicilio_piso_ck:c",
        "domicilio_pkey:p",
        "domicilio_provincia_fkey:f",
      ]);
      expect(de("datos_fiscales")).toEqual([
        "datos_fiscales_condicion_iva_ck:c",
        "datos_fiscales_confirmada_ck:c",
        "datos_fiscales_confirmada_por_fkey:f",
        "datos_fiscales_creado_por_fkey:f",
        "datos_fiscales_domicilio_fkey:f",
        "datos_fiscales_emisor_fkey:f",
        "datos_fiscales_empresa_id_fkey:f",
        "datos_fiscales_estado_ck:c",
        "datos_fiscales_id_empresa_emisor_uk:u", // 0009: para la clave foránea del comprobante
        "datos_fiscales_iibb_condicion_ck:c",
        "datos_fiscales_iibb_numero_ck:c",
        "datos_fiscales_inicio_actividades_ck:c",
        "datos_fiscales_motivo_ck:c",
        "datos_fiscales_numero_uk:u",
        "datos_fiscales_pkey:p",
        "datos_fiscales_razon_social_ck:c",
      ]);
      expect(de("regla_emisor")).toEqual([
        "regla_emisor_confirmada_ck:c",
        "regla_emisor_confirmada_por_fkey:f",
        "regla_emisor_creado_por_fkey:f",
        "regla_emisor_empresa_id_fkey:f",
        "regla_emisor_estado_ck:c",
        "regla_emisor_motivo_ck:c",
        "regla_emisor_numero_uk:u",
        "regla_emisor_pkey:p",
      ]);
      expect(de("punto_de_venta")).toEqual([
        "punto_de_venta_ambiente_ck:c", // 0009
        "punto_de_venta_domicilio_ck:c",
        "punto_de_venta_domicilio_fkey:f",
        "punto_de_venta_emisor_fkey:f",
        "punto_de_venta_empresa_id_fkey:f",
        "punto_de_venta_estado_ck:c",
        "punto_de_venta_numero_ck:c",
        "punto_de_venta_numero_uk:u",
        "punto_de_venta_pkey:p",
        "punto_de_venta_serie_uk:u",
        "punto_de_venta_sucursal_fkey:f",
        "punto_de_venta_verificacion_ck:c",
      ]);
      expect(de("serie_comprobante")).toEqual([
        "serie_ambiente_ck:c", // 0009
        "serie_bloqueo_ck:c",
        "serie_comprobante_con_reserva:t", // 0009: disparador de restricción diferido (D3)
        "serie_comprobante_empresa_id_fkey:f",
        "serie_en_curso_ck:c",
        "serie_estado_ck:c",
        "serie_pkey:p",
        "serie_punto_de_venta_fkey:f",
        "serie_tipo_ck:c",
        "serie_ultimo_ck:c",
      ]);
    });

    it("las claves foráneas compuestas atan cada hijo a la misma empresa (y la serie, emisor y punto de venta)", async () => {
      const fk = await consultar<{ conname: string; def: string }>(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint
         where contype = 'f' and conrelid = any (array['public.datos_fiscales','public.punto_de_venta',
                                                      'public.serie_comprobante']::regclass[])
           and conname in ('datos_fiscales_emisor_fkey', 'datos_fiscales_domicilio_fkey', 'punto_de_venta_emisor_fkey',
                           'punto_de_venta_sucursal_fkey', 'punto_de_venta_domicilio_fkey', 'serie_punto_de_venta_fkey')
         order by 1`,
      );
      expect(Object.fromEntries(fk.map((f) => [f.conname, f.def]))).toEqual({
        datos_fiscales_domicilio_fkey:
          "FOREIGN KEY (domicilio_fiscal_id, empresa_id) REFERENCES domicilio(id, empresa_id)",
        datos_fiscales_emisor_fkey:
          "FOREIGN KEY (emisor_id, empresa_id) REFERENCES emisor(id, empresa_id)",
        punto_de_venta_domicilio_fkey:
          "FOREIGN KEY (domicilio_id, empresa_id) REFERENCES domicilio(id, empresa_id)",
        punto_de_venta_emisor_fkey:
          "FOREIGN KEY (emisor_id, empresa_id) REFERENCES emisor(id, empresa_id)",
        punto_de_venta_sucursal_fkey:
          "FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal(id, empresa_id)",
        serie_punto_de_venta_fkey:
          "FOREIGN KEY (punto_de_venta_id, emisor_id, empresa_id) REFERENCES punto_de_venta(id, emisor_id, empresa_id)",
      });
    });

    it("los índices de cada tabla son exactamente estos, y todos los únicos incluyen empresa_id salvo emisor_cuit_uk y los catálogos globales", async () => {
      const indices = await consultar<{ t: string; i: string; def: string }>(
        `select tablename as t, indexname as i, indexdef as def from pg_indexes
         where schemaname = 'public' and tablename = any ($1) order by 1, 2`,
        [[...TABLAS_FISCALES]],
      );
      expect(indices.map((i) => `${i.t}.${i.i}`)).toEqual([
        "datos_fiscales.datos_fiscales_borrador_uk",
        "datos_fiscales.datos_fiscales_id_empresa_emisor_uk", // 0009
        "datos_fiscales.datos_fiscales_numero_uk",
        "datos_fiscales.datos_fiscales_pkey",
        "domicilio.domicilio_id_empresa_uk",
        "domicilio.domicilio_pkey",
        "emisor.emisor_cuit_uk",
        "emisor.emisor_id_empresa_uk",
        "emisor.emisor_pkey",
        "emisor.emisor_principal_uk",
        "provincia.provincia_codigo_arca_uk",
        "provincia.provincia_nombre_uk",
        "provincia.provincia_pkey",
        "punto_de_venta.punto_de_venta_numero_uk",
        "punto_de_venta.punto_de_venta_pkey",
        "punto_de_venta.punto_de_venta_serie_uk",
        "punto_de_venta.punto_de_venta_sucursal_ix",
        "regla_emisor.regla_emisor_borrador_uk",
        "regla_emisor.regla_emisor_numero_uk",
        "regla_emisor.regla_emisor_pkey",
        "serie_comprobante.serie_comprobante_emisor_ix",
        "serie_comprobante.serie_pkey",
      ]);
      const def = (nombre: string) => indices.find((i) => i.i === nombre)?.def ?? "";
      // Parciales: un solo borrador por emisor / por empresa, un solo principal, CUIT solo si lo hay.
      expect(def("datos_fiscales_borrador_uk")).toMatch(
        /UNIQUE INDEX .*\(empresa_id, emisor_id\) WHERE \(estado = 'BORRADOR'/,
      );
      expect(def("regla_emisor_borrador_uk")).toMatch(
        /UNIQUE INDEX .*\(empresa_id\) WHERE \(estado = 'BORRADOR'/,
      );
      expect(def("emisor_principal_uk")).toMatch(
        /UNIQUE INDEX .*\(empresa_id\) WHERE es_principal/,
      );
      expect(def("emisor_cuit_uk")).toMatch(/UNIQUE INDEX .*\(cuit\) WHERE \(cuit IS NOT NULL\)/);
    });

    it("las políticas de las tablas fiscales son exactamente estas (una abierta de más sumaría acceso)", async () => {
      const politicas = await consultar<{ p: string }>(
        `select format('%s.%s:%s:%s:%s', tablename, policyname, cmd, permissive, array_to_string(roles, '+')) as p
         from pg_policies where schemaname = 'public' and tablename = any ($1) order by 1`,
        [[...TABLAS_FISCALES]],
      );
      expect(politicas.map((f) => f.p)).toEqual(
        [
          "datos_fiscales.datos_fiscales_app_alta:INSERT:PERMISSIVE:zuluhub_app",
          "datos_fiscales.datos_fiscales_app_cambiar:UPDATE:PERMISSIVE:zuluhub_app",
          "datos_fiscales.datos_fiscales_app_leer:SELECT:PERMISSIVE:zuluhub_app",
          "domicilio.domicilio_app_alta:INSERT:PERMISSIVE:zuluhub_app",
          "domicilio.domicilio_app_leer:SELECT:PERMISSIVE:zuluhub_app",
          "emisor.emisor_app_leer:SELECT:PERMISSIVE:zuluhub_app",
          "emisor.emisor_plataforma_admin_alta:INSERT:RESTRICTIVE:zuluhub_plataforma",
          "emisor.emisor_plataforma_admin_cambiar:UPDATE:RESTRICTIVE:zuluhub_plataforma",
          "emisor.emisor_plataforma_alta:INSERT:PERMISSIVE:zuluhub_plataforma",
          "emisor.emisor_plataforma_cambiar:UPDATE:PERMISSIVE:zuluhub_plataforma",
          "emisor.emisor_plataforma_con_actor:SELECT:RESTRICTIVE:zuluhub_plataforma",
          "emisor.emisor_plataforma_leer:SELECT:PERMISSIVE:zuluhub_plataforma",
          "provincia.provincia_app_leer:SELECT:PERMISSIVE:zuluhub_app",
          "punto_de_venta.punto_de_venta_app_alta:INSERT:PERMISSIVE:zuluhub_app",
          "punto_de_venta.punto_de_venta_app_cambiar:UPDATE:PERMISSIVE:zuluhub_app",
          "punto_de_venta.punto_de_venta_app_leer:SELECT:PERMISSIVE:zuluhub_app",
          "punto_de_venta.punto_de_venta_plataforma_con_actor:SELECT:RESTRICTIVE:zuluhub_plataforma",
          "punto_de_venta.punto_de_venta_plataforma_leer:SELECT:PERMISSIVE:zuluhub_plataforma",
          "regla_emisor.regla_emisor_app_alta:INSERT:PERMISSIVE:zuluhub_app",
          "regla_emisor.regla_emisor_app_cambiar:UPDATE:PERMISSIVE:zuluhub_app",
          "regla_emisor.regla_emisor_app_leer:SELECT:PERMISSIVE:zuluhub_app",
          "serie_comprobante.serie_comprobante_app_alta:INSERT:PERMISSIVE:zuluhub_app",
          "serie_comprobante.serie_comprobante_app_cambiar:UPDATE:PERMISSIVE:zuluhub_app",
          "serie_comprobante.serie_comprobante_app_leer:SELECT:PERMISSIVE:zuluhub_app",
          "serie_comprobante.serie_comprobante_plataforma_con_actor:SELECT:RESTRICTIVE:zuluhub_plataforma",
          "serie_comprobante.serie_comprobante_plataforma_leer:SELECT:PERMISSIVE:zuluhub_plataforma",
        ].sort(),
      );
    });

    it("toda política de alta o cambio de la aplicación sobre las tablas fiscales exige empresa_operable, y la lista de las que existen es exacta", async () => {
      const escriben = await consultar<{
        tablename: string;
        policyname: string;
        cmd: string;
        texto: string;
      }>(
        `select tablename, policyname, cmd, coalesce(with_check, '') || ' ' || coalesce(qual, '') as texto
         from pg_policies
         where schemaname = 'public' and 'zuluhub_app' = any (roles) and tablename = any ($1)
           and cmd in ('INSERT', 'UPDATE', 'ALL') order by 1, 2`,
        [[...TABLAS_FISCALES]],
      );
      expect(escriben.map((p) => `${p.tablename}:${p.cmd}`)).toEqual([
        "datos_fiscales:INSERT",
        "datos_fiscales:UPDATE",
        "domicilio:INSERT",
        "punto_de_venta:INSERT",
        "punto_de_venta:UPDATE",
        "regla_emisor:INSERT",
        "regla_emisor:UPDATE",
        "serie_comprobante:INSERT",
        "serie_comprobante:UPDATE",
      ]);
      for (const p of escriben) {
        expect(p.texto, p.policyname).toMatch(/empresa_operable\(/);
        expect(p.texto, p.policyname).toMatch(/app_empresa_id\(\)/);
      }
    });

    it("las políticas de la plataforma evalúan el actor una sola vez por sentencia: (SELECT f()), nunca la función suelta", async () => {
      const todas = await consultar<{ policyname: string; texto: string }>(
        `select policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as texto
         from pg_policies
         where schemaname = 'public' and tablename = any ($1) and 'zuluhub_plataforma' = any (roles)
           and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(app_actor_plataforma|admin_plataforma_con_rol|plataforma_actor_vigente)'`,
        [[...TABLAS_FISCALES]],
      );
      expect(todas.map((p) => p.policyname).sort()).toEqual([
        "emisor_plataforma_admin_alta",
        "emisor_plataforma_admin_cambiar",
        "emisor_plataforma_con_actor",
        "punto_de_venta_plataforma_con_actor",
        "serie_comprobante_plataforma_con_actor",
      ]);
      for (const p of todas) {
        for (const f of ["admin_plataforma_con_rol", "plataforma_actor_vigente"]) {
          const total = (p.texto.match(new RegExp(`${f}\\(`, "g")) ?? []).length;
          const conSelect = (p.texto.match(new RegExp(`SELECT ${f}\\(`, "g")) ?? []).length;
          expect(conSelect, `${p.policyname} (${f})`).toBe(total);
        }
      }
    });

    it("los disparadores de cada tabla son exactamente estos", async () => {
      const disparadores = await consultar<{ n: string; def: string }>(
        `select c.relname || '.' || t.tgname as n, pg_get_triggerdef(t.oid) as def
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where not t.tgisinternal and (c.relname = any ($1) or t.tgname in ('empresa_crear_emisor_principal', 'empresa_validar_cuit_fiscal'))
         order by 1`,
        [[...TABLAS_FISCALES]],
      );
      expect(disparadores.map((d) => d.n)).toEqual([
        "datos_fiscales.datos_fiscales_alta",
        "datos_fiscales.datos_fiscales_cambio",
        "datos_fiscales.datos_fiscales_version",
        "domicilio.domicilio_sin_truncate",
        "domicilio.domicilio_solo_insercion",
        "emisor.emisor_cambio",
        "emisor.emisor_version",
        "empresa.empresa_crear_emisor_principal",
        "empresa.empresa_validar_cuit_fiscal",
        "punto_de_venta.punto_de_venta_ambiente", // 0009
        "punto_de_venta.punto_de_venta_cambio",
        "punto_de_venta.punto_de_venta_version",
        "regla_emisor.regla_emisor_alta",
        "regla_emisor.regla_emisor_cambio",
        "regla_emisor.regla_emisor_version",
        "serie_comprobante.serie_comprobante_alta", // 0009
        "serie_comprobante.serie_comprobante_cambio",
        "serie_comprobante.serie_comprobante_con_reserva", // 0009
        "serie_comprobante.serie_comprobante_version",
      ]);
      const def = (n: string) => disparadores.find((d) => d.n === n)?.def ?? "";
      expect(def("empresa.empresa_crear_emisor_principal")).toMatch(
        /AFTER INSERT ON .*empresa FOR EACH ROW/,
      );
      expect(def("empresa.empresa_validar_cuit_fiscal")).toMatch(
        /BEFORE INSERT OR UPDATE OF cuit ON .*empresa FOR EACH ROW/,
      );
      expect(def("domicilio.domicilio_sin_truncate")).toMatch(
        /BEFORE TRUNCATE ON .*domicilio FOR EACH STATEMENT/,
      );
      expect(def("domicilio.domicilio_solo_insercion")).toMatch(
        /BEFORE DELETE OR UPDATE ON .*domicilio FOR EACH ROW/,
      );
      // `_cambio` valida con OLD/NEW antes de que `_version` los toque: Postgres los dispara por orden alfabético.
      for (const t of [
        "emisor",
        "punto_de_venta",
        "regla_emisor",
        "serie_comprobante",
        "datos_fiscales",
      ]) {
        expect(def(`${t}.${t}_cambio`), t).toMatch(/BEFORE (INSERT OR )?UPDATE ON/);
        expect(def(`${t}.${t}_version`), t).toMatch(
          /BEFORE UPDATE ON .*EXECUTE FUNCTION fijar_version_y_fecha\(\)/,
        );
      }
    });

    it("las funciones nuevas fijan su search_path, no son SECURITY DEFINER y nadie puede ejecutarlas (solo las dispara la base)", async () => {
      const funciones = await consultar<{
        proname: string;
        prosecdef: boolean;
        proconfig: string[] | null;
      }>(
        `select proname, prosecdef, proconfig from pg_proc
         where pronamespace = 'public'::regnamespace and proname = any ($1) order by 1`,
        [[...FUNCIONES_NUEVAS]],
      );
      expect(funciones.map((f) => f.proname)).toEqual([...FUNCIONES_NUEVAS]);
      for (const f of funciones) {
        expect(f.prosecdef, f.proname).toBe(false);
        expect(f.proconfig, f.proname).toContain(SEARCH_PATH_FIJO);
        for (const rol of ROLES) {
          const { rows } = await dueno.query<{ puede: boolean }>(
            `select has_function_privilege($1, $2::regprocedure, 'EXECUTE') as puede`,
            [rol, `public.${f.proname}()`],
          );
          expect(rows[0]?.puede, `${rol} ejecuta ${f.proname}`).toBe(false);
        }
      }
      const definer = await consultar<{ proname: string }>(
        `select proname from pg_proc where pronamespace = 'public'::regnamespace and prosecdef`,
      );
      expect(definer.map((d) => d.proname)).toEqual(["contexto_firmado"]);
    });

    it("los privilegios por columna: la plataforma lee 4 columnas del punto de venta y ninguna de domicilio, datos fiscales, regla ni provincia; grupo, trabajos y autenticación no reciben nada", async () => {
      const lecturaDeLaPlataforma = await consultar<{ t: string; c: string }>(
        `select table_name as t, column_name as c from information_schema.column_privileges
         where table_schema = 'public' and grantee = 'zuluhub_plataforma' and privilege_type = 'SELECT'
           and table_name = any ($1) order by 1, 2`,
        [[...TABLAS_FISCALES]],
      );
      const porTabla = new Map<string, string[]>();
      for (const { t, c } of lecturaDeLaPlataforma)
        porTabla.set(t, [...(porTabla.get(t) ?? []), c]);
      expect([...porTabla.keys()]).toEqual(["emisor", "punto_de_venta", "serie_comprobante"]);
      expect(porTabla.get("punto_de_venta")).toEqual(["emisor_id", "empresa_id", "estado", "id"]);
      expect(porTabla.get("emisor")).toEqual((await columnasDe("emisor")).sort());
      expect(porTabla.get("serie_comprobante")).toEqual(
        (await columnasDe("serie_comprobante")).sort(),
      );
      for (const rol of ["zuluhub_grupo", "zuluhub_trabajos", "zuluhub_autenticacion"]) {
        expect(
          await consultar(
            `select table_name, column_name, privilege_type from information_schema.column_privileges
             where table_schema = 'public' and grantee = $1 and table_name = any ($2)`,
            [rol, [...TABLAS_FISCALES]],
          ),
          rol,
        ).toEqual([]);
      }
      // Nadie recibe DELETE, TRUNCATE, REFERENCES ni TRIGGER (el meta-test global lo exige; acá, para las nuevas).
      expect(
        await consultar(
          `select grantee, table_name, privilege_type from information_schema.table_privileges
           where table_schema = 'public' and table_name = any ($1) and grantee = any ($2)
             and privilege_type in ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')`,
          [[...TABLAS_FISCALES], [...ROLES]],
        ),
      ).toEqual([]);
      // La plataforma no escribe nada que no sea el emisor.
      expect(
        await consultar<{ t: string }>(
          `select distinct table_name as t from information_schema.column_privileges
           where table_schema = 'public' and grantee = 'zuluhub_plataforma' and table_name = any ($1)
             and privilege_type in ('INSERT', 'UPDATE')`,
          [[...TABLAS_FISCALES]],
        ),
      ).toEqual([{ t: "emisor" }]);
    });

    it("las provincias sembradas son las 24 del dominio, sin código de ARCA (NO VERIFICADO)", async () => {
      const sembradas = await consultar<{
        codigo: string;
        nombre: string;
        codigo_arca: number | null;
      }>("select codigo, nombre, codigo_arca from provincia order by codigo");
      expect(sembradas).toHaveLength(24);
      expect(sembradas.map((p) => ({ codigo: p.codigo, nombre: p.nombre }))).toEqual(
        [...PROVINCIAS]
          .map((p) => ({ codigo: p.codigo, nombre: p.nombre }))
          .sort((a, b) => (a.codigo < b.codigo ? -1 : 1)),
      );
      expect(sembradas.every((p) => p.codigo_arca === null)).toBe(true);
    });

    it("los errores con nombre propio que lanzan los disparadores son exactamente estos (T4 los traduce; cada uno tiene su prueba más abajo)", async () => {
      const { rows } = await dueno.query<{ prosrc: string }>(
        "select prosrc from pg_proc where pronamespace = 'public'::regnamespace and proname = any ($1)",
        [[...FUNCIONES_NUEVAS]],
      );
      const nombres = new Set<string>();
      for (const f of rows) {
        for (const m of f.prosrc.matchAll(/CONSTRAINT = '([a-z_]+)'/g)) nombres.add(m[1] as string);
      }
      expect([...nombres].sort()).toEqual(
        [
          "datos_fiscales_confirmada_inmutable",
          "datos_fiscales_inmutable",
          "datos_fiscales_numero_invalido",
          "datos_fiscales_transicion_invalida",
          "emisor_con_pv_activos",
          "emisor_cuit_es_empresa",
          "emisor_cuit_inmutable",
          "emisor_empresa_no_operable",
          "emisor_inmutable",
          "empresa_cuit_es_emisor",
          "empresa_cuit_inmutable",
          "punto_de_venta_emisor_inactivo",
          "punto_de_venta_inmutable",
          "punto_de_venta_numero_inmutable",
          "regla_emisor_confirmada_inmutable",
          "regla_emisor_inmutable",
          "regla_emisor_numero_invalido",
          "regla_emisor_transicion_invalida",
          "serie_inmutable",
          "serie_numero_invalido",
          "serie_transicion_invalida",
        ].sort(),
      );
    });

    it("los nueve tipos de comprobante de la serie son exactamente los del dominio", async () => {
      const { rows } = await dueno.query<{ def: string }>(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'serie_tipo_ck'",
      );
      const tipos = [...(rows[0]?.def.matchAll(/'([A-Z_]+)'::text/g) ?? [])].map((m) => m[1]);
      expect([...new Set(tipos)].sort()).toEqual([...TIPOS_DE_COMPROBANTE].sort());
      expect(TIPOS_DE_COMPROBANTE).toHaveLength(9);
    });
  });

  // ===============================================================================================
  // 2. Emisor
  // ===============================================================================================
  describe("emisor", () => {
    const altaDeSecundario = (s: SesionDePrueba, empresa: string, cuit: string | null) =>
      s.intentar(
        "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning id",
        [empresa, cuit],
      );

    it("la plataforma que da de alta una empresa deja su emisor principal (sin CUIT propio y activo) en la misma transacción", async () => {
      const e = await crearEmpresaActiva(entorno);
      expect(
        await consultar(
          "select es_principal, activo, cuit, version from emisor where empresa_id = $1",
          [e.empresa],
        ),
      ).toEqual([{ es_principal: true, activo: true, cuit: null, version: 1 }]);
    });

    it("si el alta de la empresa se revierte, no queda emisor huérfano; y toda empresa de la base tiene exactamente un principal", async () => {
      await deshacible(async () => {
        const { rows: t } = await dueno.query<{ id: string }>(
          "insert into tenant (nombre) values ('revierte') returning id",
        );
        const { rows: e } = await dueno.query<{ id: string }>(
          "insert into empresa (tenant_id, cuit, razon_social) values ($1, $2, 'revierte') returning id",
          [t[0]?.id, cuitAlAzar()],
        );
        expect(
          (
            await consultar("select 1 from emisor where empresa_id = $1 and es_principal", [
              e[0]?.id,
            ])
          ).length,
        ).toBe(1);
      });
      expect(
        await consultar(
          `select e.id from empresa e
           where (select count(*) from emisor x where x.empresa_id = e.id and x.es_principal) <> 1`,
        ),
      ).toEqual([]);
      expect(
        await consultar(
          "select 1 from emisor x where not exists (select 1 from empresa e where e.id = x.empresa_id)",
        ),
      ).toEqual([]);
    });

    it("el principal tiene CUIT NULL y el secundario uno válido; el principal es único por empresa y siempre activo", async () => {
      const m = await crearMundo(dueno);
      await deshacible(async () => {
        check(
          await intento(
            "insert into emisor (empresa_id, es_principal, cuit) values ($1, true, $2)",
            [m.empresa, cuitAlAzar()],
          ),
          "emisor_cuit_ck",
        );
        check(
          await intento(
            "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, null)",
            [m.empresa],
          ),
          "emisor_cuit_ck",
        );
        for (const malo of ["20123456787", "2012345678", "abcdefghijk", ""]) {
          check(
            await intento(
              "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2)",
              [m.empresa, malo],
            ),
            "emisor_cuit_ck",
          );
        }
        // Un segundo principal (con CUIT NULL como corresponde) choca con la única parcial.
        clave(
          await intento("insert into emisor (empresa_id, es_principal) values ($1, true)", [
            m.empresa,
          ]),
          "emisor_principal_uk",
        );
        // El principal no se desactiva (lo dice el CHECK, aun para el dueño).
        check(
          await intento("update emisor set activo = false where id = $1", [m.emisor]),
          "emisor_principal_activo_ck",
        );
        // Un secundario sí es activo por defecto y su `version` arranca en 1.
        const alta = await intento(
          "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning activo, version",
          [m.empresa, cuitAlAzar()],
        );
        acepta(alta);
        expect(alta.ok && alta.rows[0]).toEqual({ activo: true, version: 1 });
      });
    });

    it("la empresa y el carácter de principal de un emisor no cambian nunca, ni para el dueño", async () => {
      const m = await crearMundo(dueno);
      const otra = await crearMundo(dueno);
      await deshacible(async () => {
        check(
          await intento("update emisor set empresa_id = $2 where id = $1", [
            m.emisor,
            otra.empresa,
          ]),
          "emisor_inmutable",
        );
        const { rows } = await dueno.query<{ id: string }>(
          "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning id",
          [m.empresa, cuitAlAzar()],
        );
        const secundario = rows[0]?.id;
        check(
          await intento("update emisor set es_principal = true, cuit = null where id = $1", [
            secundario,
          ]),
          "emisor_inmutable",
        );
        check(
          await intento("update emisor set id = gen_random_uuid() where id = $1", [secundario]),
          "emisor_inmutable",
        );
      });
    });

    it("la plataforma (ADMIN) crea un secundario solo en una empresa activa o suspendida", async () => {
      for (const estado of ["ACTIVE", "SUSPENDED"] as const) {
        const m = await crearMundo(dueno, { estado });
        await conPlataforma("ADMIN", async (s) => {
          acepta(await altaDeSecundario(s, m.empresa, cuitAlAzar()));
        });
      }
      for (const estado of ["PROVISIONING", "CANCELLED", "DELETING"] as const) {
        const m = await crearMundo(dueno, { estado });
        await conPlataforma("ADMIN", async (s) => {
          check(await altaDeSecundario(s, m.empresa, cuitAlAzar()), "emisor_empresa_no_operable");
        });
      }
      // Una empresa que no existe la rechaza la clave foránea.
      await conPlataforma("ADMIN", async (s) => {
        referencia(await altaDeSecundario(s, randomUUID(), cuitAlAzar()), "emisor_empresa_id_fkey");
      });
    });

    it("el CUIT de un secundario es único en toda la instalación: ni el de otro secundario (de otro tenant) ni el de una empresa no cancelada; el de un alta cancelada se reutiliza", async () => {
      const a = await crearMundo(dueno);
      const b = await crearMundo(dueno); // otro tenant
      const cancelada = await crearMundo(dueno, { estado: "CANCELLED" });
      const cuit = cuitAlAzar();
      await conPlataforma("ADMIN", async (s) => {
        acepta(await altaDeSecundario(s, a.empresa, cuit));
        // Otro secundario (de otra empresa y otro tenant) con el mismo CUIT: la única global.
        clave(await altaDeSecundario(s, b.empresa, cuit), "emisor_cuit_uk");
        // El CUIT de una empresa activa, propia o ajena.
        check(await altaDeSecundario(s, a.empresa, a.cuit), "emisor_cuit_es_empresa");
        check(await altaDeSecundario(s, a.empresa, b.cuit), "emisor_cuit_es_empresa");
        // El de un alta cancelada, libre desde el caso 0c.
        acepta(await altaDeSecundario(s, b.empresa, cancelada.cuit));
      });
    });

    it("el alta de una empresa (y el cambio de su CUIT) con el CUIT de un secundario se rechaza; el de un alta cancelada sigue libre", async () => {
      const a = await crearMundo(dueno);
      const secundario = cuitAlAzar();
      await conPlataforma("ADMIN", async (s) => {
        acepta(await altaDeSecundario(s, a.empresa, secundario));
        const alta = (cuit: string) =>
          s.intentar(
            "insert into empresa (tenant_id, cuit, razon_social) values ($1, $2, 'nueva') returning id",
            [a.tenant, cuit],
          );
        check(await alta(secundario), "empresa_cuit_es_emisor");
        acepta(await alta(cuitAlAzar()));
        check(
          await s.intentar("update empresa set cuit = $2 where id = $1", [a.empresa, secundario]),
          "empresa_cuit_es_emisor",
        );
        // Sin conflicto, el cambio de CUIT pasa (todavía no hay series usadas).
        filas(
          await s.intentar("update empresa set cuit = $2 where id = $1", [a.empresa, cuitAlAzar()]),
          1,
        );
      });
      // Y un CUIT que fue de una empresa cancelada vuelve a poder usarse para un alta (caso 0c).
      const cancelada = await crearMundo(dueno, { estado: "CANCELLED" });
      await conPlataforma("ADMIN", async (s) => {
        acepta(
          await s.intentar(
            "insert into empresa (tenant_id, cuit, razon_social) values ($1, $2, 'reusa') returning id",
            [a.tenant, cancelada.cuit],
          ),
        );
      });
    });

    it("el CUIT no cambia una vez usado el primer número (ni el del secundario ni el de la empresa), aun para el dueño; antes del primer número sí", async () => {
      for (const como of ["NUMERO", "EN_CURSO", "BLOQUEADA"] as const) {
        const m = await crearMundo(dueno);
        const { rows } = await dueno.query<{ id: string }>(
          "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning id",
          [m.empresa, cuitAlAzar()],
        );
        const secundario = rows[0]?.id as string;
        const pvPrincipal = await crearPuntoDeVenta(dueno, m, { numero: 1 });
        const pvSecundario = await crearPuntoDeVenta(dueno, m, { numero: 1, emisor: secundario });
        await crearSerie(dueno, m.empresa, pvPrincipal, m.emisor);
        await crearSerie(dueno, m.empresa, pvSecundario, secundario);
        // Sin números usados, los dos CUIT se corrigen.
        await deshacible(async () => {
          filas(
            await intento("update emisor set cuit = $2 where id = $1", [secundario, cuitAlAzar()]),
            1,
          );
          filas(
            await intento("update empresa set cuit = $2 where id = $1", [m.empresa, cuitAlAzar()]),
            1,
          );
        });
        await usarSerie(dueno, pvPrincipal, como);
        await usarSerie(dueno, pvSecundario, como);
        await deshacible(async () => {
          check(
            await intento("update emisor set cuit = $2 where id = $1", [secundario, cuitAlAzar()]),
            "emisor_cuit_inmutable",
          );
          check(
            await intento("update empresa set cuit = $2 where id = $1", [m.empresa, cuitAlAzar()]),
            "empresa_cuit_inmutable",
          );
          // Repetir el mismo CUIT no es un cambio.
          filas(await intento("update empresa set cuit = cuit where id = $1", [m.empresa]), 1);
        });
        // La plataforma, con su rol real, tampoco (y no toca el CUIT del otro emisor de la empresa).
        await conPlataforma("ADMIN", async (s) => {
          check(
            await s.intentar("update emisor set cuit = $2 where id = $1", [
              secundario,
              cuitAlAzar(),
            ]),
            "emisor_cuit_inmutable",
          );
          check(
            await s.intentar("update empresa set cuit = $2 where id = $1", [
              m.empresa,
              cuitAlAzar(),
            ]),
            "empresa_cuit_inmutable",
          );
        });
      }
    });

    it("el CUIT de un emisor no se bloquea por las series de OTRO emisor de la misma empresa", async () => {
      const m = await crearMundo(dueno);
      const { rows } = await dueno.query<{ id: string }>(
        "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning id",
        [m.empresa, cuitAlAzar()],
      );
      const secundario = rows[0]?.id as string;
      const pvPrincipal = await crearPuntoDeVenta(dueno, m, { numero: 1 });
      await crearSerie(dueno, m.empresa, pvPrincipal, m.emisor);
      await usarSerie(dueno, pvPrincipal, "NUMERO");
      await deshacible(async () => {
        filas(
          await intento("update emisor set cuit = $2 where id = $1", [secundario, cuitAlAzar()]),
          1,
        );
      });
    });

    it("un secundario se desactiva solo sin puntos de venta activos, se reactiva, y la plataforma lo ve con los datos de aislamiento", async () => {
      const m = await crearMundo(dueno);
      const { rows } = await dueno.query<{ id: string }>(
        "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning id",
        [m.empresa, cuitAlAzar()],
      );
      const secundario = rows[0]?.id as string;
      const pv = await crearPuntoDeVenta(dueno, m, { numero: 7, emisor: secundario, activo: true });
      await conPlataforma("ADMIN", async (s) => {
        check(
          await s.intentar("update emisor set activo = false where id = $1", [secundario]),
          "emisor_con_pv_activos",
        );
      });
      await dueno.query("update punto_de_venta set estado = 'INACTIVO' where id = $1", [pv]);
      await conPlataforma("ADMIN", async (s) => {
        filas(await s.intentar("update emisor set activo = false where id = $1", [secundario]), 1);
        // Desactivado, no deja activar un punto de venta.
        filas(await s.intentar("update emisor set activo = true where id = $1", [secundario]), 1);
      });
      // Desactivación real y sin punto de venta activo: se confirma.
      await dueno.query("update emisor set activo = false where id = $1", [secundario]);
      check(
        await deshacible(() =>
          intento("update punto_de_venta set estado = 'ACTIVO' where id = $1", [pv]),
        ),
        "punto_de_venta_emisor_inactivo",
      );
    });

    it("la plataforma solo escribe cuit y activo, solo como ADMIN: el SOPORTE, el sistema y quien no tiene actor no escriben; nadie borra", async () => {
      const m = await crearMundo(dueno);
      const cuit = cuitAlAzar();
      await conPlataforma("ADMIN", async (s) => {
        denegado(
          await s.intentar("update emisor set es_principal = true where id = $1", [m.emisor]),
        );
        denegado(
          await s.intentar("update emisor set empresa_id = $2 where id = $1", [
            m.emisor,
            m.empresa,
          ]),
        );
        denegado(
          await s.intentar(
            "insert into emisor (empresa_id, es_principal, activo) values ($1, true, true)",
            [m.empresa],
          ),
        );
        denegado(await s.intentar("delete from emisor where id = $1", [m.emisor]));
        denegado(await s.intentar("truncate emisor"));
      });
      for (const actor of ["SOPORTE", "SISTEMA"] as const) {
        await conPlataforma(actor, async (s) => {
          // Lee (control positivo), pero no escribe: la restrictiva exige un ADMIN.
          const visibles = await s.intentar("select count(*)::int as n from emisor");
          expect(visibles.ok && Number(visibles.rows[0]?.["n"])).toBeGreaterThan(0);
          denegado(await altaDeSecundario(s, m.empresa, cuit));
          filas(await s.intentar("update emisor set activo = false where id = $1", [m.emisor]), 0);
        });
      }
      // Sin contexto firmado no ve ninguna fila.
      const sinContexto = await SesionDePrueba.abrir(base!, "zuluhub_plataforma", null);
      try {
        const r = await sinContexto.intentar("select count(*)::int as n from emisor");
        expect(r.ok && r.rows[0]?.["n"]).toBe(0);
      } finally {
        await sinContexto.cerrar();
      }
    });

    it("la empresa ve sus emisores pero no los escribe ni los borra", async () => {
      const m = await crearMundo(dueno);
      await conApp(m, async (s) => {
        const r = await s.intentar("select id, cuit from emisor");
        expect(r.ok && r.rows).toEqual([{ id: m.emisor, cuit: null }]);
        denegado(
          await s.intentar(
            "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2)",
            [m.empresa, cuitAlAzar()],
          ),
        );
        denegado(await s.intentar("update emisor set activo = false where id = $1", [m.emisor]));
        denegado(await s.intentar("delete from emisor where id = $1", [m.emisor]));
      });
    });
  });

  // ===============================================================================================
  // 3. Domicilio, datos fiscales y regla del emisor
  // ===============================================================================================
  describe("domicilio", () => {
    const alta = (s: SesionDePrueba, m: Mundo, d: DatosDeDomicilio = {}) =>
      s.intentar(
        `insert into domicilio (id, empresa_id, calle, numero, piso, departamento, localidad, provincia, codigo_postal)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [
          d.id ?? randomUUID(),
          m.empresa,
          d.calle ?? "Av. Corrientes",
          d.numero ?? "1234",
          d.piso ?? null,
          d.departamento ?? null,
          d.localidad ?? "Rosario",
          d.provincia ?? "AR-S",
          d.codigo_postal ?? null,
        ],
      );

    it("la empresa da de alta un domicilio válido (con los opcionales ausentes o presentes)", async () => {
      const m = await crearMundo(dueno);
      await conApp(m, async (s) => {
        acepta(await alta(s, m));
        acepta(await alta(s, m, { numero: "S/N" }));
        acepta(await alta(s, m, { numero: "1" }));
        acepta(
          await alta(s, m, {
            numero: "123456",
            piso: "5",
            departamento: "B",
            codigo_postal: "S2000",
          }),
        );
        acepta(await alta(s, m, { codigo_postal: "C1425ABC" }));
        // Los límites exactos del dominio.
        acepta(await alta(s, m, { calle: "c".repeat(100), localidad: "l".repeat(100) }));
        acepta(await alta(s, m, { piso: "p".repeat(20), departamento: "d".repeat(20) }));
        // Un texto con espacios en el medio y con acentos y eñes.
        acepta(await alta(s, m, { calle: "Pasaje José  Hernández", localidad: "Ñandú" }));
      });
    });

    it.each<[string, DatosDeDomicilio, string]>([
      ["calle con un blanco al principio", { calle: " Corrientes" }, "domicilio_calle_ck"],
      ["calle con un blanco al final", { calle: "Corrientes " }, "domicilio_calle_ck"],
      ["calle vacía", { calle: "" }, "domicilio_calle_ck"],
      ["calle con una tabulación", { calle: "Av.\tCorrientes" }, "domicilio_calle_ck"],
      ["calle con un salto de línea", { calle: "Av.\nCorrientes" }, "domicilio_calle_ck"],
      ["calle de 101 caracteres", { calle: "c".repeat(101) }, "domicilio_calle_ck"],
      ["número con una letra", { numero: "12A" }, "domicilio_numero_ck"],
      ["número de 7 dígitos", { numero: "1234567" }, "domicilio_numero_ck"],
      ["número vacío", { numero: "" }, "domicilio_numero_ck"],
      ["sin número en minúsculas", { numero: "s/n" }, "domicilio_numero_ck"],
      ["número con un blanco", { numero: " 12" }, "domicilio_numero_ck"],
      ["piso vacío", { piso: "" }, "domicilio_piso_ck"],
      ["piso con un blanco al principio", { piso: " 5" }, "domicilio_piso_ck"],
      ["piso de 21 caracteres", { piso: "p".repeat(21) }, "domicilio_piso_ck"],
      ["departamento vacío", { departamento: "" }, "domicilio_departamento_ck"],
      ["departamento con un blanco al final", { departamento: "B " }, "domicilio_departamento_ck"],
      [
        "departamento de 21 caracteres",
        { departamento: "d".repeat(21) },
        "domicilio_departamento_ck",
      ],
      ["localidad vacía", { localidad: "" }, "domicilio_localidad_ck"],
      ["localidad con un blanco al final", { localidad: "Rosario " }, "domicilio_localidad_ck"],
      [
        "localidad con un carácter de control",
        { localidad: "Ros\u0085ario" },
        "domicilio_localidad_ck",
      ],
      ["localidad de 101 caracteres", { localidad: "l".repeat(101) }, "domicilio_localidad_ck"],
      ["código postal en minúsculas", { codigo_postal: "s2000" }, "domicilio_codigo_postal_ck"],
      ["código postal de 3 caracteres", { codigo_postal: "S20" }, "domicilio_codigo_postal_ck"],
      [
        "código postal de 9 caracteres",
        { codigo_postal: "S20000000" },
        "domicilio_codigo_postal_ck",
      ],
      ["código postal con un guion", { codigo_postal: "S-2000" }, "domicilio_codigo_postal_ck"],
      ["código postal vacío", { codigo_postal: "" }, "domicilio_codigo_postal_ck"],
    ])("se rechaza: %s", async (_nombre, datos, restriccion) => {
      const m = await crearMundo(dueno);
      await conApp(m, async (s) => {
        check(await alta(s, m, datos), restriccion);
      });
    });

    it("la provincia tiene que existir en el catálogo (en mayúsculas y con su clave ISO exacta)", async () => {
      const m = await crearMundo(dueno);
      await conApp(m, async (s) => {
        for (const provincia of ["AR-ZZ", "ar-s", "AR-", "", "Santa Fe"]) {
          const r = await alta(s, m, { provincia });
          expect(r.ok, provincia).toBe(false);
          if (!r.ok) expect(["23503", "23514"], r.mensaje).toContain(r.codigo);
        }
        referencia(await alta(s, m, { provincia: "AR-ZZ" }), "domicilio_provincia_fkey");
        for (const { codigo } of PROVINCIAS) acepta(await alta(s, m, { provincia: codigo }));
      });
    });

    it("es de solo inserción: no se edita, no se borra ni se trunca, ni siquiera el dueño; la empresa tampoco", async () => {
      const m = await crearMundo(dueno);
      const id = await crearDomicilio(dueno, m.empresa);
      await deshacible(async () => {
        const r1 = await intento("update domicilio set calle = 'Otra' where id = $1", [id]);
        denegado(r1);
        denegado(await intento("delete from domicilio where id = $1", [id]));
        // Sin CASCADE ya lo frenan las claves foráneas que apuntan a la tabla; con CASCADE, el disparador.
        denegado(await intento("truncate domicilio cascade"));
        expect(await consultar("select calle from domicilio where id = $1", [id])).toEqual([
          { calle: "Av. Corrientes" },
        ]);
      });
      await conApp(m, async (s) => {
        denegado(await s.intentar("update domicilio set calle = 'Otra' where id = $1", [id]));
        denegado(await s.intentar("delete from domicilio where id = $1", [id]));
        // Y no puede elegir `creado_en`.
        denegado(
          await s.intentar(
            "insert into domicilio (empresa_id, calle, numero, localidad, provincia, creado_en) values ($1, 'c', '1', 'l', 'AR-S', now())",
            [m.empresa],
          ),
        );
      });
    });

    it("el alta repetida con el mismo id es idempotente: una sola fila, sin error con ON CONFLICT DO NOTHING", async () => {
      const m = await crearMundo(dueno);
      const id = randomUUID();
      await conApp(m, async (s) => {
        acepta(await alta(s, m, { id }));
        clave(await alta(s, m, { id }), "domicilio_pkey");
        const repetido = await s.intentar(
          `insert into domicilio (id, empresa_id, calle, numero, localidad, provincia)
           values ($1, $2, 'Av. Corrientes', '1234', 'Rosario', 'AR-S') on conflict (id) do nothing`,
          [id, m.empresa],
        );
        filas(repetido, 0);
        const r = await s.intentar("select count(*)::int as n from domicilio where id = $1", [id]);
        expect(r.ok && r.rows[0]?.["n"]).toBe(1);
      });
    });

    it("todo domicilio que acepta el dominio lo acepta la base (propiedad con textos al azar)", async () => {
      const m = await crearMundo(dueno);
      const unidad = fc.constantFrom(..."abc XYZ ñÁ09.-\t");
      const texto = fc.string({ maxLength: 130, unit: unidad });
      const datos = fc.record({
        calle: texto,
        numero: fc.oneof(
          fc.stringMatching(/^[0-9]{1,8}$/),
          fc.constantFrom("s/n", "S/N", " 12 ", ""),
        ),
        piso: fc.option(fc.string({ maxLength: 25, unit: unidad }), { nil: null }),
        departamento: fc.option(fc.string({ maxLength: 25, unit: unidad }), { nil: null }),
        localidad: texto,
        provincia: fc.constantFrom(...PROVINCIAS.map((p) => p.codigo), "AR-ZZ", "ar-s", ""),
        codigoPostal: fc.option(fc.stringMatching(/^[A-Za-z0-9]{0,10}$/), { nil: null }),
      });
      let aceptados = 0;
      await deshacible(async () => {
        await fc.assert(
          fc.asyncProperty(datos, async (d) => {
            const dominio = domicilioDesdeDatos(d);
            if (!dominio.ok) return;
            aceptados += 1;
            const r = await intento(
              `insert into domicilio (empresa_id, calle, numero, piso, departamento, localidad, provincia, codigo_postal)
               values ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                m.empresa,
                dominio.valor.calle,
                dominio.valor.numero,
                dominio.valor.piso,
                dominio.valor.departamento,
                dominio.valor.localidad,
                dominio.valor.provincia,
                dominio.valor.codigoPostal,
              ],
            );
            expect(r.ok, JSON.stringify(dominio.valor) + (r.ok ? "" : r.mensaje)).toBe(true);
          }),
        );
      });
      // La propiedad no es vacía: el generador produce domicilios válidos.
      expect(aceptados).toBeGreaterThan(5);
    });
  });

  describe("datos fiscales", () => {
    type Datos = Partial<{
      id: string;
      emisor: string;
      razon: string | null;
      iva: string | null;
      domicilio: string | null;
      inicio: string | null;
      iibbNumero: string | null;
      iibbCondicion: string | null;
      creadoPor: string | null;
    }>;
    const borrador = (s: SesionDePrueba, m: Mundo, d: Datos = {}) =>
      s.intentar(
        `insert into datos_fiscales (id, empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id,
                                    inicio_actividades, iibb_numero, iibb_condicion, creado_por)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [
          d.id ?? randomUUID(),
          m.empresa,
          d.emisor ?? m.emisor,
          d.razon === undefined ? "Mi Empresa SA" : d.razon,
          d.iva === undefined ? "RESPONSABLE_INSCRIPTO" : d.iva,
          d.domicilio === undefined ? null : d.domicilio,
          d.inicio === undefined ? "2020-03-01" : d.inicio,
          d.iibbNumero ?? null,
          d.iibbCondicion ?? null,
          d.creadoPor === undefined ? m.persona : d.creadoPor,
        ],
      );
    type Confirmacion = Partial<{
      numero: number | null;
      vigente: Date | null;
      confirmadaEn: Date | null;
      por: string | null;
      motivo: string | null;
    }>;
    const confirmar = (s: SesionDePrueba, m: Mundo, id: string, c: Confirmacion = {}) =>
      s.intentar(
        `update datos_fiscales set estado = 'CONFIRMADA', numero = $2, vigente_desde = $3, confirmada_en = $4,
                confirmada_por = $5, motivo = $6 where id = $1`,
        [
          id,
          c.numero === undefined ? 1 : c.numero,
          c.vigente === undefined ? AHORA : c.vigente,
          c.confirmadaEn === undefined ? AHORA : c.confirmadaEn,
          c.por === undefined ? m.persona : c.por,
          c.motivo === undefined ? "Alta inicial" : c.motivo,
        ],
      );
    /** Un borrador completo, creado por el dueño (con su domicilio fiscal). */
    const borradorDeBase = async (m: Mundo, d: Datos = {}): Promise<string> => {
      const id = d.id ?? randomUUID();
      const domicilio =
        d.domicilio === undefined ? await crearDomicilio(dueno, m.empresa) : d.domicilio;
      await dueno.query(
        `insert into datos_fiscales (id, empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id,
                                    inicio_actividades, creado_por)
         values ($1, $2, $3, 'Mi Empresa SA', 'RESPONSABLE_INSCRIPTO', $4, '2020-03-01', $5)`,
        [id, m.empresa, d.emisor ?? m.emisor, domicilio, m.persona],
      );
      return id;
    };

    it("el flujo completo: borrador incompleto, edición, confirmación con número 1, nueva versión con número 2; nada de la confirmada cambia", async () => {
      const m = await crearMundo(dueno);
      const domicilio = await crearDomicilio(dueno, m.empresa);
      await conApp(m, async (s) => {
        // Un borrador puede estar vacío: solo se pide quién lo crea.
        const vacio = await s.intentar(
          "insert into datos_fiscales (empresa_id, emisor_id, creado_por) values ($1, $2, $3) returning id, estado, numero, version",
          [m.empresa, m.emisor, m.persona],
        );
        acepta(vacio);
        const id = (vacio.ok && vacio.rows[0]?.["id"]) as string;
        expect(vacio.ok && vacio.rows[0]).toMatchObject({
          estado: "BORRADOR",
          numero: null,
          version: 1,
        });
        // Incompleto no se confirma.
        check(await confirmar(s, m, id), "datos_fiscales_confirmada_ck");
        // Se edita (cada edición sube la versión de la fila).
        filas(
          await s.intentar(
            `update datos_fiscales set razon_social = 'Mi Empresa SA', condicion_iva = 'MONOTRIBUTO',
                    domicilio_fiscal_id = $2, inicio_actividades = '2019-12-31', iibb_numero = '901-123456-7',
                    iibb_condicion = 'CONVENIO_MULTILATERAL' where id = $1`,
            [id, domicilio],
          ),
          1,
        );
        acepta(await confirmar(s, m, id, { vigente: MAS_TARDE }));
        const confirmada = await s.intentar(
          "select estado, numero, vigente_desde, confirmada_en, confirmada_por, motivo, version from datos_fiscales where id = $1",
          [id],
        );
        expect(confirmada.ok && confirmada.rows[0]).toMatchObject({
          estado: "CONFIRMADA",
          numero: 1,
          vigente_desde: MAS_TARDE,
          confirmada_en: AHORA,
          confirmada_por: m.persona,
          motivo: "Alta inicial",
          version: 3,
        });
        // Confirmar de nuevo la misma fila no la modifica: no hay nada que editar en una confirmada.
        filas(await confirmar(s, m, id), 0);
        // La versión siguiente es otro borrador con su propio id.
        const siguiente = await borrador(s, m, {
          domicilio,
          razon: "Mi Empresa SA (nuevo nombre)",
        });
        acepta(siguiente);
        const id2 = (siguiente.ok && siguiente.rows[0]?.["id"]) as string;
        acepta(await confirmar(s, m, id2, { numero: 2, motivo: "Cambió la razón social" }));
        const numeros = await s.intentar(
          "select numero from datos_fiscales where emisor_id = $1 order by numero",
          [m.emisor],
        );
        expect(numeros.ok && numeros.rows.map((r) => r["numero"])).toEqual([1, 2]);
      });
    });

    it("hay un solo borrador por emisor (cada emisor tiene el suyo) y, al confirmarlo, se puede abrir otro", async () => {
      const m = await crearMundo(dueno);
      const { rows } = await dueno.query<{ id: string }>(
        "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning id",
        [m.empresa, cuitAlAzar()],
      );
      const secundario = rows[0]?.id as string;
      const domicilio = await crearDomicilio(dueno, m.empresa);
      await conApp(m, async (s) => {
        const primero = await borrador(s, m, { domicilio });
        acepta(primero);
        clave(await borrador(s, m, { domicilio }), "datos_fiscales_borrador_uk");
        acepta(await borrador(s, m, { domicilio, emisor: secundario }));
        acepta(await confirmar(s, m, (primero.ok && primero.rows[0]?.["id"]) as string));
        acepta(await borrador(s, m, { domicilio }));
      });
    });

    it("el borrador con el mismo id repetido es idempotente: una sola fila con ON CONFLICT DO NOTHING", async () => {
      const m = await crearMundo(dueno);
      const id = randomUUID();
      await conApp(m, async (s) => {
        acepta(await borrador(s, m, { id }));
        clave(await borrador(s, m, { id }), "datos_fiscales_pkey");
        filas(
          await s.intentar(
            `insert into datos_fiscales (id, empresa_id, emisor_id, creado_por) values ($1, $2, $3, $4)
             on conflict (id) do nothing`,
            [id, m.empresa, m.emisor, m.persona],
          ),
          0,
        );
      });
    });

    it.each<[string, Confirmacion, string]>([
      ["sin fecha de vigencia", { vigente: null }, "datos_fiscales_confirmada_ck"],
      ["sin instante de confirmación", { confirmadaEn: null }, "datos_fiscales_confirmada_ck"],
      ["sin quién confirma", { por: null }, "datos_fiscales_confirmada_ck"],
      ["sin motivo", { motivo: null }, "datos_fiscales_confirmada_ck"],
      [
        "con vigencia retroactiva",
        { vigente: new Date(AHORA.getTime() - 1) },
        "datos_fiscales_confirmada_ck",
      ],
      ["con un motivo en blanco", { motivo: "" }, "datos_fiscales_motivo_ck"],
      [
        "con un motivo con blancos en los extremos",
        { motivo: " Alta" },
        "datos_fiscales_motivo_ck",
      ],
      [
        "con un número que no es el siguiente (2 en vez de 1)",
        { numero: 2 },
        "datos_fiscales_numero_invalido",
      ],
      ["con número 0", { numero: 0 }, "datos_fiscales_numero_invalido"],
      ["con número negativo", { numero: -1 }, "datos_fiscales_numero_invalido"],
      ["sin número", { numero: null }, "datos_fiscales_numero_invalido"],
    ])(
      "al confirmar se rechaza %s (también para el dueño de la base)",
      async (_nombre, confirmacion, restriccion) => {
        const m = await crearMundo(dueno);
        const id = await borradorDeBase(m);
        await deshacible(async () => {
          const r = await intento(
            `update datos_fiscales set estado = 'CONFIRMADA', numero = $2, vigente_desde = $3, confirmada_en = $4,
                  confirmada_por = $5, motivo = $6 where id = $1`,
            [
              id,
              confirmacion.numero === undefined ? 1 : confirmacion.numero,
              confirmacion.vigente === undefined ? AHORA : confirmacion.vigente,
              confirmacion.confirmadaEn === undefined ? AHORA : confirmacion.confirmadaEn,
              confirmacion.por === undefined ? m.persona : confirmacion.por,
              confirmacion.motivo === undefined ? "Alta inicial" : confirmacion.motivo,
            ],
          );
          // `numero` NULL: el estado CONFIRMADA sin número lo ve primero el disparador (espera el siguiente).
          check(r, restriccion);
        });
      },
    );

    it.each<[string, Datos, string]>([
      ["sin razón social", { razon: null }, "datos_fiscales_confirmada_ck"],
      ["sin condición de IVA", { iva: null }, "datos_fiscales_confirmada_ck"],
      ["sin inicio de actividades", { inicio: null }, "datos_fiscales_confirmada_ck"],
      ["sin domicilio fiscal", { domicilio: null }, "datos_fiscales_confirmada_ck"],
    ])(
      "una versión confirmada exige todo lo obligatorio: se rechaza %s",
      async (_nombre, datos, restriccion) => {
        const m = await crearMundo(dueno);
        const id = await borradorDeBase(m, datos.domicilio === null ? { domicilio: null } : {});
        await deshacible(async () => {
          await dueno.query(
            `update datos_fiscales set razon_social = $2, condicion_iva = $3, inicio_actividades = $4 where id = $1`,
            [
              id,
              datos.razon === undefined ? "Mi Empresa SA" : datos.razon,
              datos.iva === undefined ? "MONOTRIBUTO" : datos.iva,
              datos.inicio === undefined ? "2020-03-01" : datos.inicio,
            ],
          );
          check(
            await intento(
              `update datos_fiscales set estado = 'CONFIRMADA', numero = 1, vigente_desde = $2, confirmada_en = $2,
                    confirmada_por = $3, motivo = 'Alta' where id = $1`,
              [id, AHORA, m.persona],
            ),
            restriccion,
          );
        });
      },
    );

    it("el borrador no trae nada de la confirmación, y nada nace ya confirmado", async () => {
      const m = await crearMundo(dueno);
      const id = await borradorDeBase(m);
      await deshacible(async () => {
        for (const columna of [
          "vigente_desde = now()",
          "confirmada_en = now()",
          `confirmada_por = '${m.persona}'`,
          "motivo = 'algo'",
          "numero = 1",
        ]) {
          check(
            await intento(`update datos_fiscales set ${columna} where id = $1`, [id]),
            "datos_fiscales_confirmada_ck",
          );
        }
        // Nace confirmada: ni siquiera con todos los datos de una confirmación.
        check(
          await intento(
            `insert into datos_fiscales (empresa_id, emisor_id, estado, numero, razon_social, condicion_iva,
                    domicilio_fiscal_id, inicio_actividades, vigente_desde, confirmada_en, confirmada_por, motivo, creado_por)
             select empresa_id, emisor_id, 'CONFIRMADA', 1, razon_social, condicion_iva, domicilio_fiscal_id,
                    inicio_actividades, now(), now(), $2, 'Alta', $2 from datos_fiscales where id = $1`,
            [id, m.persona],
          ),
          "datos_fiscales_transicion_invalida",
        );
      });
    });

    it("una versión confirmada está congelada entera y no vuelve a borrador (ni para el dueño); el borrador no cambia su identidad", async () => {
      const m = await crearMundo(dueno);
      const id = await borradorDeBase(m);
      const otro = await crearMundo(dueno);
      await deshacible(async () => {
        // La identidad del borrador no se cambia.
        for (const [columna, valor] of [
          ["id", randomUUID()],
          ["empresa_id", otro.empresa],
          ["emisor_id", otro.emisor],
          ["creado_por", otro.persona],
          ["creado_en", new Date(0)],
        ] as const) {
          check(
            await intento(`update datos_fiscales set ${columna} = $2 where id = $1`, [id, valor]),
            "datos_fiscales_inmutable",
          );
        }
        acepta(
          await intento(
            `update datos_fiscales set estado = 'CONFIRMADA', numero = 1, vigente_desde = $2, confirmada_en = $2,
                    confirmada_por = $3, motivo = 'Alta' where id = $1`,
            [id, AHORA, m.persona],
          ),
        );
        for (const cambio of [
          "razon_social = 'Otra SA'",
          "condicion_iva = 'EXENTO'",
          "inicio_actividades = '2000-01-01'",
          "iibb_numero = '1'",
          "iibb_condicion = 'LOCAL'",
          "motivo = 'otro'",
          "vigente_desde = vigente_desde + interval '1 day'",
          "numero = 5",
          // Sin cambiar nada de la fila: cualquier UPDATE sobre una confirmada se rechaza.
          "razon_social = razon_social",
        ]) {
          check(
            await intento(`update datos_fiscales set ${cambio} where id = $1`, [id]),
            "datos_fiscales_confirmada_inmutable",
          );
        }
        check(
          await intento(
            `update datos_fiscales set estado = 'BORRADOR', numero = null, vigente_desde = null, confirmada_en = null,
                    confirmada_por = null, motivo = null where id = $1`,
            [id],
          ),
          "datos_fiscales_transicion_invalida",
        );
      });
    });

    it.each<[string, Datos, string]>([
      ["una condición de IVA desconocida", { iva: "OTRA" }, "datos_fiscales_condicion_iva_ck"],
      ["una condición de IVA en minúsculas", { iva: "exento" }, "datos_fiscales_condicion_iva_ck"],
      [
        "una condición de IIBB desconocida",
        { iibbCondicion: "OTRA" },
        "datos_fiscales_iibb_condicion_ck",
      ],
      ["una razón social vacía", { razon: "" }, "datos_fiscales_razon_social_ck"],
      [
        "una razón social con blancos al principio",
        { razon: " Mi Empresa" },
        "datos_fiscales_razon_social_ck",
      ],
      [
        "una razón social con un salto de línea",
        { razon: "Mi\nEmpresa" },
        "datos_fiscales_razon_social_ck",
      ],
      [
        "una razón social de 201 caracteres",
        { razon: "r".repeat(201) },
        "datos_fiscales_razon_social_ck",
      ],
      [
        "un número de IIBB con blancos al final",
        { iibbNumero: "901 " },
        "datos_fiscales_iibb_numero_ck",
      ],
      [
        "un número de IIBB de 31 caracteres",
        { iibbNumero: "9".repeat(31) },
        "datos_fiscales_iibb_numero_ck",
      ],
      ["un número de IIBB vacío", { iibbNumero: "" }, "datos_fiscales_iibb_numero_ck"],
    ])("el borrador rechaza %s", async (_nombre, datos, restriccion) => {
      const m = await crearMundo(dueno);
      await conApp(m, async (s) => {
        check(await borrador(s, m, datos), restriccion);
      });
    });

    it("acepta los límites exactos y todas las condiciones de IVA y de IIBB", async () => {
      const m = await crearMundo(dueno);
      await deshacible(async () => {
        const ins = (razon: string, iva: string, iibb: string | null, inicio: string) =>
          intento(
            `insert into datos_fiscales (empresa_id, emisor_id, razon_social, condicion_iva, inicio_actividades,
                                        iibb_numero, iibb_condicion, creado_por)
             values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              m.empresa,
              m.emisor,
              razon,
              iva,
              inicio,
              iibb === null ? null : "9".repeat(30),
              iibb,
              m.persona,
            ],
          );
        // Hay un solo borrador por emisor: cada combinación se prueba y se deshace.
        for (const iva of ["RESPONSABLE_INSCRIPTO", "MONOTRIBUTO", "EXENTO"]) {
          for (const iibb of [null, "LOCAL", "CONVENIO_MULTILATERAL", "EXENTO"]) {
            await dueno.query("savepoint combinacion");
            acepta(await ins("r".repeat(200), iva, iibb, "0001-01-01"));
            await dueno.query("rollback to savepoint combinacion");
          }
        }
        // Antes del año 1 no hay fecha civil.
        check(
          await ins("Mi SA", "EXENTO", null, "0100-01-01 BC"),
          "datos_fiscales_inicio_actividades_ck",
        );
      });
    });

    it("las claves foráneas compuestas: ni el emisor ni el domicilio fiscal pueden ser de otra empresa", async () => {
      const m = await crearMundo(dueno);
      const otra = await crearMundo(dueno);
      const domicilioAjeno = await crearDomicilio(dueno, otra.empresa);
      await deshacible(async () => {
        referencia(
          await intento(
            "insert into datos_fiscales (empresa_id, emisor_id, creado_por) values ($1, $2, $3)",
            [m.empresa, otra.emisor, m.persona],
          ),
          "datos_fiscales_emisor_fkey",
        );
        referencia(
          await intento(
            "insert into datos_fiscales (empresa_id, emisor_id, domicilio_fiscal_id, creado_por) values ($1, $2, $3, $4)",
            [m.empresa, m.emisor, domicilioAjeno, m.persona],
          ),
          "datos_fiscales_domicilio_fkey",
        );
      });
    });

    it("la aplicación: el autor es la persona del contexto, no edita lo confirmado y no toca lo que no se le dio", async () => {
      const m = await crearMundo(dueno);
      const otraPersona = (await crearMundo(dueno)).persona;
      const domicilio = await crearDomicilio(dueno, m.empresa);
      const confirmada = await borradorDeBase(m, { domicilio });
      await dueno.query(
        `update datos_fiscales set estado = 'CONFIRMADA', numero = 1, vigente_desde = $2, confirmada_en = $2,
                confirmada_por = $3, motivo = 'Alta' where id = $1`,
        [confirmada, AHORA, m.persona],
      );
      await conApp(m, async (s) => {
        // Otra persona como autora, o ninguna: la política lo rechaza.
        denegado(await borrador(s, m, { creadoPor: otraPersona }));
        denegado(await borrador(s, m, { creadoPor: null }));
        // La confirmada no se actualiza: la política ni la deja ver para cambiarla (0 filas).
        filas(
          await s.intentar("update datos_fiscales set razon_social = 'Otra' where id = $1", [
            confirmada,
          ]),
          0,
        );
        const propio = await borrador(s, m, { domicilio });
        acepta(propio);
        const id = (propio.ok && propio.rows[0]?.["id"]) as string;
        // Confirmar a nombre de otra persona.
        denegado(await confirmar(s, m, id, { numero: 2, por: otraPersona }));
        // Lo que no se le dio a la aplicación.
        for (const columna of ["empresa_id", "emisor_id", "creado_por", "creado_en", "version"]) {
          denegado(
            await s.intentar(`update datos_fiscales set ${columna} = ${columna} where id = $1`, [
              id,
            ]),
          );
        }
        denegado(await s.intentar("delete from datos_fiscales where id = $1", [id]));
      });
      // Sin persona en el contexto no se crea nada.
      await conApp(
        m,
        async (s) => {
          denegado(await borrador(s, m, { creadoPor: m.persona }));
        },
        null,
      );
    });

    it("lo que produce el dominio (borrador, edición, confirmación) la base lo acepta tal cual", async () => {
      const m = await crearMundo(dueno);
      const domicilio = await crearDomicilio(dueno, m.empresa);
      const id = versionId(randomUUID());
      const vacio = nuevoBorrador({
        id,
        empresaId: empresaId(m.empresa),
        emisorId: emisorId(m.emisor),
        creadoPor: personaId(m.persona),
      });
      const editado = editarBorrador(vacio, {
        razonSocial: "  Mi Empresa SA  ",
        condicionIva: "MONOTRIBUTO",
        domicilioFiscalId: domicilioId(domicilio),
        inicioActividades: "2019-02-28",
        iibbNumero: "901-123456-7",
        iibbCondicion: "CONVENIO_MULTILATERAL",
      });
      expect(editado.ok).toBe(true);
      if (!editado.ok) return;
      const confirmada = confirmarDatosFiscales(editado.valor, [], {
        ahora: AHORA,
        vigenteDesde: MAS_TARDE,
        motivo: " Alta inicial ",
        confirmadaPor: personaId(m.persona),
      });
      expect(confirmada.ok).toBe(true);
      if (!confirmada.ok) return;
      const v = confirmada.valor;
      await conApp(m, async (s) => {
        acepta(
          await s.intentar(
            `insert into datos_fiscales (id, empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id,
                    inicio_actividades, iibb_numero, iibb_condicion, creado_por)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              editado.valor.id,
              editado.valor.empresaId,
              editado.valor.emisorId,
              editado.valor.razonSocial,
              editado.valor.condicionIva,
              editado.valor.domicilioFiscalId,
              editado.valor.inicioActividades,
              editado.valor.iibbNumero,
              editado.valor.iibbCondicion,
              editado.valor.creadoPor,
            ],
          ),
        );
        acepta(
          await s.intentar(
            `update datos_fiscales set estado = 'CONFIRMADA', numero = $2, vigente_desde = $3, confirmada_en = $4,
                    confirmada_por = $5, motivo = $6 where id = $1`,
            [v.id, v.numero, v.vigenteDesde, v.confirmadaEn, v.confirmadaPor, v.motivo],
          ),
        );
        const r = await s.intentar(
          "select razon_social, inicio_actividades::text as inicio, motivo, numero from datos_fiscales where id = $1",
          [v.id],
        );
        expect(r.ok && r.rows[0]).toEqual({
          razon_social: "Mi Empresa SA",
          inicio: "2019-02-28",
          motivo: "Alta inicial",
          numero: 1,
        });
      });
    });

    it("toda razón social, número de IIBB y motivo que acepta el dominio los acepta la base (propiedad con textos al azar)", async () => {
      const m = await crearMundo(dueno);
      const domicilio = await crearDomicilio(dueno, m.empresa);
      const unidad = fc.constantFrom(..."abc XYZ ñÁ09.-\t");
      const texto = fc.string({ maxLength: 215, unit: unidad });
      let aceptados = 0;
      await deshacible(async () => {
        await fc.assert(
          fc.asyncProperty(texto, texto, async (razon, iibb) => {
            const base0 = nuevoBorrador({
              id: versionId(randomUUID()),
              empresaId: empresaId(m.empresa),
              emisorId: emisorId(m.emisor),
              creadoPor: personaId(m.persona),
            });
            const editado = editarBorrador(base0, {
              razonSocial: razon,
              condicionIva: "EXENTO",
              domicilioFiscalId: domicilioId(domicilio),
              inicioActividades: "2020-02-29",
              iibbNumero: iibb,
            });
            if (!editado.ok) return;
            aceptados += 1;
            await dueno.query("savepoint propiedad");
            const r = await intento(
              `insert into datos_fiscales (empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id,
                      inicio_actividades, iibb_numero, creado_por) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                m.empresa,
                m.emisor,
                editado.valor.razonSocial,
                editado.valor.condicionIva,
                domicilio,
                editado.valor.inicioActividades,
                editado.valor.iibbNumero,
                m.persona,
              ],
            );
            await dueno.query("rollback to savepoint propiedad");
            expect(r.ok, JSON.stringify([razon, iibb]) + (r.ok ? "" : r.mensaje)).toBe(true);
          }),
        );
      });
      expect(aceptados).toBeGreaterThan(5);
    });
  });

  describe("regla del emisor", () => {
    const borrador = (
      s: SesionDePrueba,
      m: Mundo,
      manual: boolean | null = null,
      creadoPor = m.persona,
    ) =>
      s.intentar(
        manual === null
          ? "insert into regla_emisor (empresa_id, creado_por) values ($1, $2) returning id, permitir_eleccion_manual"
          : "insert into regla_emisor (empresa_id, creado_por, permitir_eleccion_manual) values ($1, $2, $3) returning id, permitir_eleccion_manual",
        manual === null ? [m.empresa, creadoPor] : [m.empresa, creadoPor, manual],
      );
    const confirmar = (
      s: SesionDePrueba,
      m: Mundo,
      id: string,
      numero: number | null = 1,
      motivo: string | null = "Alta",
    ) =>
      s.intentar(
        `update regla_emisor set estado = 'CONFIRMADA', numero = $2, vigente_desde = $3, confirmada_en = $3,
                confirmada_por = $4, motivo = $5 where id = $1`,
        [id, numero, AHORA, m.persona, motivo],
      );

    it("por defecto se permite la elección manual (igual que la regla del dominio), un borrador por empresa y versiones 1, 2…", async () => {
      expect(REGLA_DE_EMISOR_POR_DEFECTO).toEqual({ permitirEleccionManual: true });
      const m = await crearMundo(dueno);
      await conApp(m, async (s) => {
        const primero = await borrador(s, m);
        acepta(primero);
        expect(primero.ok && primero.rows[0]?.["permitir_eleccion_manual"]).toBe(true);
        clave(await borrador(s, m), "regla_emisor_borrador_uk");
        const id = (primero.ok && primero.rows[0]?.["id"]) as string;
        filas(
          await s.intentar(
            "update regla_emisor set permitir_eleccion_manual = false where id = $1",
            [id],
          ),
          1,
        );
        acepta(await confirmar(s, m, id, 1));
        const segundo = await borrador(s, m, false);
        acepta(segundo);
        acepta(
          await confirmar(
            s,
            m,
            (segundo.ok && segundo.rows[0]?.["id"]) as string,
            2,
            "Sin elección manual",
          ),
        );
        const r = await s.intentar(
          "select numero, permitir_eleccion_manual from regla_emisor order by numero",
        );
        expect(r.ok && r.rows).toEqual([
          { numero: 1, permitir_eleccion_manual: false },
          { numero: 2, permitir_eleccion_manual: false },
        ]);
      });
    });

    it("al confirmar exige número siguiente, vigencia, quién confirma y motivo; la confirmada está congelada; nada nace confirmado", async () => {
      const m = await crearMundo(dueno);
      const { rows } = await dueno.query<{ id: string }>(
        "insert into regla_emisor (empresa_id, creado_por) values ($1, $2) returning id",
        [m.empresa, m.persona],
      );
      const id = rows[0]?.id as string;
      await deshacible(async () => {
        const confirmarDueno = (
          numero: number | null,
          motivo: string | null,
          vigente: Date | null = AHORA,
        ) =>
          intento(
            `update regla_emisor set estado = 'CONFIRMADA', numero = $2, vigente_desde = $3, confirmada_en = $4,
                    confirmada_por = $5, motivo = $6 where id = $1`,
            [id, numero, vigente, AHORA, m.persona, motivo],
          );
        check(await confirmarDueno(2, "Alta"), "regla_emisor_numero_invalido");
        check(await confirmarDueno(0, "Alta"), "regla_emisor_numero_invalido");
        check(await confirmarDueno(null, "Alta"), "regla_emisor_numero_invalido");
        check(await confirmarDueno(1, null), "regla_emisor_confirmada_ck");
        check(await confirmarDueno(1, ""), "regla_emisor_motivo_ck");
        check(await confirmarDueno(1, "Alta", null), "regla_emisor_confirmada_ck");
        check(
          await confirmarDueno(1, "Alta", new Date(AHORA.getTime() - 1)),
          "regla_emisor_confirmada_ck",
        );
        acepta(await confirmarDueno(1, "Alta"));
        check(
          await intento("update regla_emisor set permitir_eleccion_manual = false where id = $1", [
            id,
          ]),
          "regla_emisor_confirmada_inmutable",
        );
        check(
          await intento(
            "update regla_emisor set estado = 'BORRADOR', numero = null, vigente_desde = null, confirmada_en = null, confirmada_por = null, motivo = null where id = $1",
            [id],
          ),
          "regla_emisor_transicion_invalida",
        );
        check(
          await intento(
            `insert into regla_emisor (empresa_id, estado, numero, vigente_desde, confirmada_en, confirmada_por, motivo, creado_por)
             values ($1, 'CONFIRMADA', 2, now(), now(), $2, 'x', $2)`,
            [m.empresa, m.persona],
          ),
          "regla_emisor_transicion_invalida",
        );
        check(
          await intento("update regla_emisor set empresa_id = $2 where id = $1", [id, m.empresa]),
          "regla_emisor_confirmada_inmutable",
        );
      });
      await deshacible(async () => {
        const otra = await crearMundo(dueno);
        check(
          await intento("update regla_emisor set empresa_id = $2 where id = $1", [
            id,
            otra.empresa,
          ]),
          "regla_emisor_inmutable",
        );
      });
    });

    it("la aplicación: el autor es la persona del contexto, confirma a su nombre y no edita lo confirmado", async () => {
      const m = await crearMundo(dueno);
      const otraPersona = (await crearMundo(dueno)).persona;
      await conApp(m, async (s) => {
        denegado(await borrador(s, m, null, otraPersona));
        const propio = await borrador(s, m);
        acepta(propio);
        const id = (propio.ok && propio.rows[0]?.["id"]) as string;
        denegado(
          await s.intentar(
            `update regla_emisor set estado = 'CONFIRMADA', numero = 1, vigente_desde = $2, confirmada_en = $2,
                    confirmada_por = $3, motivo = 'x' where id = $1`,
            [id, AHORA, otraPersona],
          ),
        );
        acepta(await confirmar(s, m, id));
        filas(
          await s.intentar(
            "update regla_emisor set permitir_eleccion_manual = false where id = $1",
            [id],
          ),
          0,
        );
        denegado(
          await s.intentar("update regla_emisor set empresa_id = empresa_id where id = $1", [id]),
        );
        denegado(await s.intentar("delete from regla_emisor where id = $1", [id]));
      });
    });
  });

  // ===============================================================================================
  // 4. Punto de venta
  // ===============================================================================================
  describe("punto de venta", () => {
    const alta = (
      s: SesionDePrueba,
      m: Mundo,
      d: {
        id?: string;
        numero?: number;
        emisor?: string;
        sucursal?: string;
        domicilio?: string | null;
      } = {},
    ) =>
      s.intentar(
        `insert into punto_de_venta (id, empresa_id, emisor_id, sucursal_id, numero, domicilio_id)
         values ($1, $2, $3, $4, $5, $6) returning id, estado, verificacion_arca`,
        [
          d.id ?? randomUUID(),
          m.empresa,
          d.emisor ?? m.emisor,
          d.sucursal ?? m.sucursal,
          d.numero ?? 1,
          d.domicilio === undefined ? null : d.domicilio,
        ],
      );
    const secundarioDe = async (m: Mundo): Promise<string> =>
      (
        await dueno.query<{ id: string }>(
          "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning id",
          [m.empresa, cuitAlAzar()],
        )
      ).rows[0]?.id as string;

    it("nace INACTIVO y sin verificar contra ARCA; el número es único por emisor (dos CUIT pueden tener el punto de venta 1)", async () => {
      const m = await crearMundo(dueno);
      const secundario = await secundarioDe(m);
      await conApp(m, async (s) => {
        const r = await alta(s, m, { numero: 1 });
        acepta(r);
        expect(r.ok && r.rows[0]).toMatchObject({
          estado: "INACTIVO",
          verificacion_arca: "NO_VERIFICADO",
        });
        clave(await alta(s, m, { numero: 1 }), "punto_de_venta_numero_uk");
        acepta(await alta(s, m, { numero: 1, emisor: secundario }));
        acepta(await alta(s, m, { numero: 2 }));
        // Otra sucursal de la misma empresa también choca: la unicidad es por emisor, no por sucursal.
      });
    });

    it("el número está entre 1 y 99999", async () => {
      const m = await crearMundo(dueno);
      await conApp(m, async (s) => {
        for (const numero of [0, -1, 100000])
          check(await alta(s, m, { numero }), "punto_de_venta_numero_ck");
        acepta(await alta(s, m, { numero: 1 }));
        acepta(await alta(s, m, { numero: 99999 }));
      });
    });

    it("el alta repetida con el mismo id es idempotente: una sola fila con ON CONFLICT DO NOTHING", async () => {
      const m = await crearMundo(dueno);
      const id = randomUUID();
      await conApp(m, async (s) => {
        acepta(await alta(s, m, { id }));
        clave(await alta(s, m, { id, numero: 2 }), "punto_de_venta_pkey");
        filas(
          await s.intentar(
            `insert into punto_de_venta (id, empresa_id, emisor_id, sucursal_id, numero)
             values ($1, $2, $3, $4, 1) on conflict (id) do nothing`,
            [id, m.empresa, m.emisor, m.sucursal],
          ),
          0,
        );
      });
    });

    it("el emisor, la sucursal y el domicilio tienen que ser de la misma empresa", async () => {
      const m = await crearMundo(dueno);
      const otra = await crearMundo(dueno);
      const domicilioAjeno = await crearDomicilio(dueno, otra.empresa);
      await conApp(m, async (s) => {
        referencia(await alta(s, m, { emisor: otra.emisor }), "punto_de_venta_emisor_fkey");
        referencia(await alta(s, m, { sucursal: otra.sucursal }), "punto_de_venta_sucursal_fkey");
        referencia(
          await alta(s, m, { domicilio: domicilioAjeno }),
          "punto_de_venta_domicilio_fkey",
        );
        // Y no se puede dar de alta a nombre de otra empresa.
        denegado(await alta(s, { ...m, empresa: otra.empresa }));
      });
    });

    it("no se activa sin domicilio ni con el emisor inactivo; se desactiva siempre; no se borra", async () => {
      const m = await crearMundo(dueno);
      const secundario = await secundarioDe(m);
      const domicilio = await crearDomicilio(dueno, m.empresa);
      const sinDomicilio = await crearPuntoDeVenta(dueno, m, { numero: 1 });
      const conDomicilio = await crearPuntoDeVenta(dueno, m, { numero: 2, domicilio });
      const delSecundario = await crearPuntoDeVenta(dueno, m, {
        numero: 3,
        emisor: secundario,
        domicilio,
      });
      await conApp(m, async (s) => {
        check(
          await s.intentar("update punto_de_venta set estado = 'ACTIVO' where id = $1", [
            sinDomicilio,
          ]),
          "punto_de_venta_domicilio_ck",
        );
        filas(
          await s.intentar("update punto_de_venta set estado = 'ACTIVO' where id = $1", [
            conDomicilio,
          ]),
          1,
        );
        // Repetir la activación es «ya estaba»: no cambia nada de lo que importa.
        filas(
          await s.intentar("update punto_de_venta set estado = 'ACTIVO' where id = $1", [
            conDomicilio,
          ]),
          1,
        );
        // Un punto de venta activo no pierde su domicilio.
        check(
          await s.intentar("update punto_de_venta set domicilio_id = null where id = $1", [
            conDomicilio,
          ]),
          "punto_de_venta_domicilio_ck",
        );
        filas(
          await s.intentar("update punto_de_venta set estado = 'INACTIVO' where id = $1", [
            conDomicilio,
          ]),
          1,
        );
        denegado(await s.intentar("delete from punto_de_venta where id = $1", [conDomicilio]));
        denegado(await s.intentar("truncate punto_de_venta"));
      });
      await dueno.query("update emisor set activo = false where id = $1", [secundario]);
      await conApp(m, async (s) => {
        check(
          await s.intentar("update punto_de_venta set estado = 'ACTIVO' where id = $1", [
            delSecundario,
          ]),
          "punto_de_venta_emisor_inactivo",
        );
      });
      // Reactivado el emisor, se puede activar.
      await dueno.query("update emisor set activo = true where id = $1", [secundario]);
      await conApp(m, async (s) => {
        filas(
          await s.intentar("update punto_de_venta set estado = 'ACTIVO' where id = $1", [
            delSecundario,
          ]),
          1,
        );
      });
    });

    it("el emisor no cambia nunca (ni la empresa), y la aplicación no puede elegir la verificación de ARCA ni el estado inicial", async () => {
      const m = await crearMundo(dueno);
      const secundario = await secundarioDe(m);
      const pv = await crearPuntoDeVenta(dueno, m, { numero: 1 });
      await deshacible(async () => {
        check(
          await intento("update punto_de_venta set emisor_id = $2 where id = $1", [pv, secundario]),
          "punto_de_venta_inmutable",
        );
        check(
          await intento("update punto_de_venta set empresa_id = $2 where id = $1", [
            pv,
            randomUUID(),
          ]),
          "punto_de_venta_inmutable",
        );
        // Un único valor de verificación en H7.
        check(
          await intento(
            "update punto_de_venta set verificacion_arca = 'VERIFICADO' where id = $1",
            [pv],
          ),
          "punto_de_venta_verificacion_ck",
        );
      });
      await conApp(m, async (s) => {
        for (const columna of [
          "emisor_id",
          "empresa_id",
          "verificacion_arca",
          "creado_en",
          "version",
        ]) {
          denegado(
            await s.intentar(`update punto_de_venta set ${columna} = ${columna} where id = $1`, [
              pv,
            ]),
          );
        }
        denegado(
          await s.intentar(
            `insert into punto_de_venta (empresa_id, emisor_id, sucursal_id, numero, estado) values ($1, $2, $3, 9, 'ACTIVO')`,
            [m.empresa, m.emisor, m.sucursal],
          ),
        );
        denegado(
          await s.intentar(
            `insert into punto_de_venta (empresa_id, emisor_id, sucursal_id, numero, verificacion_arca) values ($1, $2, $3, 9, 'NO_VERIFICADO')`,
            [m.empresa, m.emisor, m.sucursal],
          ),
        );
      });
    });

    it("con números usados el punto de venta no cambia de número (ni para el dueño); sin ellos sí; sucursal y domicilio cambian siempre", async () => {
      for (const como of ["NUMERO", "EN_CURSO", "BLOQUEADA"] as const) {
        const m = await crearMundo(dueno);
        const segundaSucursal = (
          await dueno.query<{ id: string }>(
            "insert into sucursal (empresa_id, nombre) values ($1, 'Norte') returning id",
            [m.empresa],
          )
        ).rows[0]?.id as string;
        const otroDomicilio = await crearDomicilio(dueno, m.empresa, { calle: "Mitre" });
        const pv = await crearPuntoDeVenta(dueno, m, { numero: 1 });
        await crearSerie(dueno, m.empresa, pv, m.emisor, "FACTURA_B");
        await crearSerie(dueno, m.empresa, pv, m.emisor, "FACTURA_A", 0);
        await deshacible(async () => {
          // Con las series sin usar, el número cambia.
          filas(await intento("update punto_de_venta set numero = 2 where id = $1", [pv]), 1);
        });
        await usarSerie(dueno, pv, como, "FACTURA_B");
        await deshacible(async () => {
          check(
            await intento("update punto_de_venta set numero = 2 where id = $1", [pv]),
            "punto_de_venta_numero_inmutable",
          );
          // Repetir el mismo número no es un cambio; la sucursal y el domicilio sí pueden cambiar.
          filas(await intento("update punto_de_venta set numero = 1 where id = $1", [pv]), 1);
          filas(
            await intento(
              "update punto_de_venta set sucursal_id = $2, domicilio_id = $3 where id = $1",
              [pv, segundaSucursal, otroDomicilio],
            ),
            1,
          );
        });
        // También con el rol real de la aplicación.
        await conApp(m, async (s) => {
          check(
            await s.intentar("update punto_de_venta set numero = 2 where id = $1", [pv]),
            "punto_de_venta_numero_inmutable",
          );
          filas(
            await s.intentar("update punto_de_venta set sucursal_id = $2 where id = $1", [
              pv,
              segundaSucursal,
            ]),
            1,
          );
        });
      }
      // Sin ninguna serie, el número también cambia.
      const m = await crearMundo(dueno);
      const pv = await crearPuntoDeVenta(dueno, m, { numero: 1 });
      await conApp(m, async (s) => {
        filas(await s.intentar("update punto_de_venta set numero = 5 where id = $1", [pv]), 1);
        clave(
          await s.intentar(
            `insert into punto_de_venta (empresa_id, emisor_id, sucursal_id, numero) values ($1, $2, $3, 5)`,
            [m.empresa, m.emisor, m.sucursal],
          ),
          "punto_de_venta_numero_uk",
        );
      });
    });

    it("el número usado de un punto de venta de un emisor no depende de las series del mismo número en otro emisor", async () => {
      const m = await crearMundo(dueno);
      const secundario = await secundarioDe(m);
      const pvPrincipal = await crearPuntoDeVenta(dueno, m, { numero: 1 });
      const pvSecundario = await crearPuntoDeVenta(dueno, m, { numero: 1, emisor: secundario });
      await crearSerie(dueno, m.empresa, pvPrincipal, m.emisor);
      await crearSerie(dueno, m.empresa, pvSecundario, secundario);
      await usarSerie(dueno, pvPrincipal, "NUMERO");
      await deshacible(async () => {
        filas(
          await intento("update punto_de_venta set numero = 9 where id = $1", [pvSecundario]),
          1,
        );
        check(
          await intento("update punto_de_venta set numero = 9 where id = $1", [pvPrincipal]),
          "punto_de_venta_numero_inmutable",
        );
      });
    });
  });

  // ===============================================================================================
  // 5. Serie de comprobantes
  // ===============================================================================================
  describe("serie de comprobantes", () => {
    const FUTURO = new Date("2026-10-12T12:05:00Z");

    it("se crea con el último número que informa el servicio, LIBRE, para cada uno de los nueve tipos", async () => {
      const m = await crearMundo(dueno);
      const pv = await crearPuntoDeVenta(dueno, m, { numero: 1 });
      await conApp(m, async (s) => {
        for (const [i, tipo] of TIPOS_DE_COMPROBANTE.entries()) {
          const r = await s.intentar(
            `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente)
             values ($1, $2, $3, $4, $5, 'HOMOLOGACION') returning estado, ultimo_numero::text as ultimo, version`,
            [m.empresa, pv, m.emisor, tipo, i * 1000],
          );
          acepta(r);
          expect(r.ok && r.rows[0]).toEqual({
            estado: "LIBRE",
            ultimo: String(i * 1000),
            version: 1,
          });
        }
        // Una serie por (punto de venta, tipo).
        clave(
          await s.intentar(
            `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente)
             values ($1, $2, $3, 'FACTURA_A', 0, 'HOMOLOGACION')`,
            [m.empresa, pv, m.emisor],
          ),
          "serie_pkey",
        );
        // Ni un tipo que no existe, ni un último número negativo, ni elegir el estado.
        check(
          await s.intentar(
            `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente)
             values ($1, $2, $3, 'TICKET', 0, 'HOMOLOGACION')`,
            [m.empresa, pv, m.emisor],
          ),
          "serie_tipo_ck",
        );
        denegado(
          await s.intentar(
            `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente, estado)
             values ($1, $2, $3, 'FACTURA_C', 0, 'HOMOLOGACION', 'LIBRE')`,
            [m.empresa, pv, m.emisor],
          ),
        );
      });
      await deshacible(async () => {
        check(
          await intento(
            `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente)
             values ($1, $2, $3, 'NOTA_DEBITO_A', -1, 'HOMOLOGACION')`,
            [m.empresa, pv, m.emisor],
          ),
          "serie_ultimo_ck",
        );
      });
    });

    it("una serie no mezcla emisor y punto de venta, ni puntos de venta de otra empresa", async () => {
      const m = await crearMundo(dueno);
      const otra = await crearMundo(dueno);
      const { rows } = await dueno.query<{ id: string }>(
        "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning id",
        [m.empresa, cuitAlAzar()],
      );
      const secundario = rows[0]?.id as string;
      const pv = await crearPuntoDeVenta(dueno, m, { numero: 1 });
      const pvAjeno = await crearPuntoDeVenta(dueno, otra, { numero: 1 });
      await deshacible(async () => {
        referencia(
          await intento(
            `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente)
             values ($1, $2, $3, 'FACTURA_A', 0, 'HOMOLOGACION')`,
            [m.empresa, pv, secundario],
          ),
          "serie_punto_de_venta_fkey",
        );
        referencia(
          await intento(
            `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente)
             values ($1, $2, $3, 'FACTURA_A', 0, 'HOMOLOGACION')`,
            [m.empresa, pvAjeno, otra.emisor],
          ),
          "serie_punto_de_venta_fkey",
        );
      });
    });

    it.each<[string, "LIBRE" | "EN_CURSO", string, string]>([
      ["EN_CURSO sin número reservado", "LIBRE", "estado = 'EN_CURSO'", "serie_en_curso_ck"],
      [
        "un número reservado con la serie LIBRE",
        "LIBRE",
        "numero_en_curso = 6, solicitud_en_curso = gen_random_uuid(), en_curso_hasta = now()",
        "serie_en_curso_ck",
      ],
      [
        "EN_CURSO con un número que no es el siguiente",
        "LIBRE",
        "estado = 'EN_CURSO', numero_en_curso = 7, solicitud_en_curso = gen_random_uuid(), en_curso_hasta = now()",
        "serie_en_curso_ck",
      ],
      [
        "EN_CURSO sin solicitud",
        "LIBRE",
        "estado = 'EN_CURSO', numero_en_curso = 6, en_curso_hasta = now()",
        "serie_en_curso_ck",
      ],
      [
        "EN_CURSO sin plazo",
        "LIBRE",
        "estado = 'EN_CURSO', numero_en_curso = 6, solicitud_en_curso = gen_random_uuid()",
        "serie_en_curso_ck",
      ],
      [
        "una solicitud suelta en una serie LIBRE",
        "LIBRE",
        "solicitud_en_curso = gen_random_uuid()",
        "serie_en_curso_ck",
      ],
      [
        "un plazo suelto en una serie LIBRE",
        "LIBRE",
        "en_curso_hasta = now()",
        "serie_en_curso_ck",
      ],
      [
        "un motivo de bloqueo en una serie LIBRE",
        "LIBRE",
        "motivo_bloqueo = 'desfase'",
        "serie_bloqueo_ck",
      ],
      [
        "un motivo en blanco en una serie LIBRE",
        "LIBRE",
        "motivo_bloqueo = ''",
        "serie_bloqueo_ck",
      ],
      [
        "BLOQUEADA sin motivo",
        "EN_CURSO",
        "estado = 'BLOQUEADA', numero_en_curso = null, solicitud_en_curso = null, en_curso_hasta = null",
        "serie_bloqueo_ck",
      ],
      [
        "BLOQUEADA con un motivo en blanco",
        "EN_CURSO",
        "estado = 'BLOQUEADA', numero_en_curso = null, solicitud_en_curso = null, en_curso_hasta = null, motivo_bloqueo = '   '",
        "serie_bloqueo_ck",
      ],
      [
        "BLOQUEADA que conserva el número reservado",
        "EN_CURSO",
        "estado = 'BLOQUEADA', motivo_bloqueo = 'desfase'",
        "serie_en_curso_ck",
      ],
    ])("el CHECK de la serie impide %s", async (_nombre, inicial, cambios, restriccion) => {
      const m = await crearMundo(dueno);
      const pv = await crearPuntoDeVenta(dueno, m, { numero: 1 });
      await crearSerie(dueno, m.empresa, pv, m.emisor, "FACTURA_B", 5);
      if (inicial === "EN_CURSO") await usarSerie(dueno, pv, "EN_CURSO");
      await deshacible(async () => {
        check(
          await intento(`update serie_comprobante set ${cambios} where punto_de_venta_id = $1`, [
            pv,
          ]),
          restriccion,
        );
      });
    });

    it("los errores con nombre de la serie: identidad, último número y transiciones (también para el dueño)", async () => {
      const m = await crearMundo(dueno);
      const otra = await crearMundo(dueno);
      const pv = await crearPuntoDeVenta(dueno, m, { numero: 1 });
      const pvOtro = await crearPuntoDeVenta(dueno, m, { numero: 2 });
      await crearSerie(dueno, m.empresa, pv, m.emisor, "FACTURA_B", 5);
      const parcial = (cambios: string) =>
        `update serie_comprobante set ${cambios} where punto_de_venta_id = $1 and tipo_comprobante = 'FACTURA_B'`;
      const reservar =
        "estado = 'EN_CURSO', numero_en_curso = 6, solicitud_en_curso = gen_random_uuid(), en_curso_hasta = now() + interval '5 minutes'";
      await deshacible(async () => {
        // La identidad de la serie no cambia.
        for (const cambio of [
          "tipo_comprobante = 'FACTURA_A'",
          `punto_de_venta_id = '${pvOtro}'`,
          `empresa_id = '${otra.empresa}'`,
          `emisor_id = '${otra.emisor}'`,
          "creado_en = now() - interval '1 day'",
        ]) {
          check(await intento(parcial(cambio), [pv]), "serie_inmutable");
        }
        // El último número no baja ni salta; solo sube de a uno cerrando la EN_CURSO que lo reservó.
        check(await intento(parcial("ultimo_numero = 4"), [pv]), "serie_numero_invalido");
        check(await intento(parcial("ultimo_numero = 6"), [pv]), "serie_numero_invalido");
        check(await intento(parcial("ultimo_numero = 100"), [pv]), "serie_numero_invalido");
        // Desde LIBRE solo se llega a EN_CURSO.
        check(
          await intento(parcial("estado = 'BLOQUEADA', motivo_bloqueo = 'desfase'"), [pv]),
          "serie_transicion_invalida",
        );
        acepta(await intento(parcial(reservar), [pv]));
        // EN_CURSO no cambia su reserva (una autorización incierta sigue como está).
        check(
          await intento(parcial("solicitud_en_curso = gen_random_uuid()"), [pv]),
          "serie_transicion_invalida",
        );
        check(
          await intento(parcial("en_curso_hasta = en_curso_hasta + interval '1 minute'"), [pv]),
          "serie_transicion_invalida",
        );
        // Cerrar subiendo más de uno, o quedándose en EN_CURSO con otro último número, tampoco.
        check(
          await intento(
            parcial(
              "estado = 'LIBRE', ultimo_numero = 7, numero_en_curso = null, solicitud_en_curso = null, en_curso_hasta = null",
            ),
            [pv],
          ),
          "serie_numero_invalido",
        );
        // Bloquear sin avanzar sí; BLOQUEADA no cambia su motivo ni va a EN_CURSO (a LIBRE sí, desde 0009).
        acepta(
          await intento(
            parcial(
              "estado = 'BLOQUEADA', numero_en_curso = null, solicitud_en_curso = null, en_curso_hasta = null, motivo_bloqueo = 'desfase'",
            ),
            [pv],
          ),
        );
        // Desde 0009 BLOQUEADA sale hacia LIBRE (QF1): eso se prueba en facturacion-sql.test.ts. Acá, que
        // el último número no salta si no sale, y que a EN_CURSO no se va.
        check(await intento(parcial("ultimo_numero = 100"), [pv]), "serie_numero_invalido");
        check(await intento(parcial("estado = 'EN_CURSO'"), [pv]), "serie_transicion_invalida");
        check(
          await intento(parcial("motivo_bloqueo = 'otro motivo'"), [pv]),
          "serie_transicion_invalida",
        );
      });
    });

    it("la máquina de estados de la base es exactamente la del dominio (todas las combinaciones de estado, número, solicitud, plazo y motivo)", async () => {
      const m = await crearMundo(dueno);
      const pv = await crearPuntoDeVenta(dueno, m, { numero: 1 });
      const SOLICITUD = randomUUID();
      const OTRA_SOLICITUD = randomUUID();
      const HASTA = FUTURO;
      const OTRO_HASTA = new Date(FUTURO.getTime() + 60_000);
      const identidad = {
        empresaId: empresaId(m.empresa),
        puntoDeVentaId: puntoDeVentaId(pv),
        emisorId: emisorId(m.emisor),
        tipo: "FACTURA_B" as const,
        version: 1,
      };
      type Fila = {
        estado: "LIBRE" | "EN_CURSO" | "BLOQUEADA";
        ultimo: number;
        numero: number | null;
        solicitud: string | null;
        hasta: Date | null;
        motivo: string | null;
      };
      /** La serie del dominio que representa esa fila, o `null` si el dominio no puede representarla. */
      const aSerie = (f: Fila): Serie | null => {
        const sinReserva = f.numero === null && f.solicitud === null && f.hasta === null;
        if (f.estado === "LIBRE") {
          return sinReserva && f.motivo === null
            ? { ...identidad, estado: "LIBRE", ultimoNumero: BigInt(f.ultimo) }
            : null;
        }
        if (f.estado === "EN_CURSO") {
          return f.numero !== null && f.solicitud !== null && f.hasta !== null && f.motivo === null
            ? {
                ...identidad,
                estado: "EN_CURSO",
                ultimoNumero: BigInt(f.ultimo),
                numeroEnCurso: BigInt(f.numero),
                solicitud: solicitudId(f.solicitud),
                enCursoHasta: f.hasta,
              }
            : null;
        }
        return sinReserva && f.motivo !== null
          ? {
              ...identidad,
              estado: "BLOQUEADA",
              ultimoNumero: BigInt(f.ultimo),
              motivoBloqueo: f.motivo,
            }
          : null;
      };
      const ANTES: readonly Fila[] = [
        { estado: "LIBRE", ultimo: 5, numero: null, solicitud: null, hasta: null, motivo: null },
        {
          estado: "EN_CURSO",
          ultimo: 5,
          numero: 6,
          solicitud: SOLICITUD,
          hasta: HASTA,
          motivo: null,
        },
        {
          estado: "BLOQUEADA",
          ultimo: 5,
          numero: null,
          solicitud: null,
          hasta: null,
          motivo: "desfase",
        },
      ];
      const candidatos: Fila[] = [];
      for (const estado of ["LIBRE", "EN_CURSO", "BLOQUEADA"] as const) {
        for (const ultimo of [4, 5, 6, 7]) {
          for (const numero of [null, ultimo + 1, ultimo]) {
            for (const solicitud of [SOLICITUD, OTRA_SOLICITUD, null]) {
              for (const hasta of [HASTA, OTRO_HASTA, null]) {
                for (const motivo of [null, "desfase", "   "]) {
                  candidatos.push({ estado, ultimo, numero, solicitud, hasta, motivo });
                }
              }
            }
          }
        }
      }
      const aceptadas = new Map<string, number>();
      let rechazadas = 0;
      for (const antes of ANTES) {
        const serieAntes = aSerie(antes);
        expect(serieAntes, `${antes.estado} es representable`).not.toBeNull();
        await deshacible(async () => {
          await dueno.query(
            `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero,
                    ambiente, estado, numero_en_curso, solicitud_en_curso, en_curso_hasta, motivo_bloqueo)
             values ($1, $2, $3, 'FACTURA_B', $4, 'HOMOLOGACION', $5, $6, $7, $8, $9)`,
            [
              m.empresa,
              pv,
              m.emisor,
              antes.ultimo,
              antes.estado,
              antes.numero,
              antes.solicitud,
              antes.hasta,
              antes.motivo,
            ],
          );
          for (const despues of candidatos) {
            await dueno.query("savepoint candidato");
            const r = await intento(
              `update serie_comprobante set estado = $2, ultimo_numero = $3, numero_en_curso = $4,
                      solicitud_en_curso = $5, en_curso_hasta = $6, motivo_bloqueo = $7
                where punto_de_venta_id = $1 and tipo_comprobante = 'FACTURA_B'`,
              [
                pv,
                despues.estado,
                despues.ultimo,
                despues.numero,
                despues.solicitud,
                despues.hasta,
                despues.motivo,
              ],
            );
            if (!r.ok) expect(r.codigo, `${JSON.stringify(despues)}: ${r.mensaje}`).toBe("23514");
            const serieDespues = aSerie(despues);
            // EXCEPCIÓN de 0009 (QF1): la base deja salir de BLOQUEADA hacia LIBRE, sin bajar el último
            // número; el dominio (`TRANSICIONES_DE_SERIE`) la recibe en F4 y entonces esta cláusula se borra.
            const salidaDeBloqueada =
              antes.estado === "BLOQUEADA" &&
              despues.estado === "LIBRE" &&
              serieDespues !== null &&
              despues.ultimo >= antes.ultimo;
            const esperada =
              (serieAntes !== null &&
                serieDespues !== null &&
                transicionDeSerieValida(serieAntes, serieDespues)) ||
              salidaDeBloqueada;
            expect(r.ok, `${antes.estado} → ${JSON.stringify(despues)}`).toBe(esperada);
            // Cada candidato se prueba desde el mismo estado de partida.
            await dueno.query("rollback to savepoint candidato");
            if (r.ok) {
              const transicion = `${antes.estado}→${despues.estado}`;
              aceptadas.set(transicion, (aceptadas.get(transicion) ?? 0) + 1);
            } else {
              rechazadas += 1;
            }
          }
        });
      }
      expect(rechazadas).toBeGreaterThan(2000);
      // Las transiciones que existen son exactamente las del dominio (más quedarse en el mismo estado y,
      // desde 0009, la salida de BLOQUEADA hacia LIBRE que el dominio recibe en F4).
      const esperadas = new Set<string>(["BLOQUEADA→LIBRE"]);
      for (const [desde, hacia] of Object.entries(TRANSICIONES_DE_SERIE)) {
        esperadas.add(`${desde}→${desde}`);
        for (const h of hacia) esperadas.add(`${desde}→${h}`);
      }
      expect([...aceptadas.keys()].sort()).toEqual([...esperadas].sort());
    });
  });
});
