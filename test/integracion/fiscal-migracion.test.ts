import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { instalarClaveDeContexto } from "../../src/adaptadores/postgres/contexto-firmado";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { sembrarAdminsDePrueba } from "./admins-de-prueba";
import { crearBaseAparte, crearEmpresaActiva, crearEntornoDePrueba, cuitAlAzar } from "./entorno";
import {
  crearDomicilio,
  crearMundo,
  crearPuntoDeVenta,
  crearSerie,
  type EstadoDeEmpresaDePrueba,
} from "./fiscal-apoyo";

/**
 * H7 (fiscal base), tramo T3: la migración 0006 sobre una base con datos reales (relleno del emisor
 * principal, compatibilidad hacia atrás, atomicidad, el bloqueo contra altas concurrentes) y su
 * reversión (un script aparte, destructivo, que deja el catálogo como estaba antes de 0006).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const MIGRACIONES = join(import.meta.dirname, "../../migraciones");
/** Para leer los archivos (también la reversión). */
const REAL = MIGRACIONES;
const HASTA_0005 = [
  "0001_base.sql",
  "0002_identidad.sql",
  "0003_trabajos.sql",
  "0004_plataforma.sql",
  "0005_administracion.sql",
] as const;
const ESTADOS: readonly EstadoDeEmpresaDePrueba[] = [
  "PROVISIONING",
  "ACTIVE",
  "SUSPENDED",
  "CANCELLED",
  "DELETING",
];
/** Las tablas de 0001 a 0005 cuyo contenido la migración 0006 no puede tocar. */
const TABLAS_VIEJAS = [
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
  "traspaso_gerencia",
] as const;

const carpetaCon = async (archivos: readonly string[]): Promise<string> => {
  const carpeta = await mkdtemp(join(tmpdir(), "zuluhub-mig-0006-"));
  for (const archivo of archivos)
    await copyFile(join(MIGRACIONES, archivo), join(carpeta, archivo));
  return carpeta;
};

/** Una base aparte con esas migraciones aplicadas, la clave de contexto y los administradores de prueba. */
async function baseCon(archivos: readonly string[]) {
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
}

/** Un resumen del contenido de las tablas (md5 de todas las filas, ordenadas por su texto). */
async function huella(c: pg.Client): Promise<Record<string, string>> {
  const r: Record<string, string> = {};
  for (const tabla of TABLAS_VIEJAS) {
    const { rows } = await c.query<{ h: string }>(
      `select coalesce(md5(string_agg(t::text, '|' order by t::text)), '-') as h from ${tabla} t`,
    );
    r[tabla] = rows[0]?.h as string;
  }
  return r;
}

/**
 * Todo lo que el catálogo declara del esquema `public`: columnas, restricciones (sin los NOT NULL de
 * Postgres 18), índices, disparadores, políticas, funciones y privilegios. Dos bases con la misma
 * huella tienen el mismo esquema.
 */
async function huellaDeCatalogo(c: pg.Client): Promise<Record<string, string[]>> {
  const lista = async (texto: string) =>
    (await c.query<{ x: string }>(texto)).rows.map((f) => f.x).sort();
  return {
    columnas: await lista(
      `select format('%s.%s:%s:%s:%s:%s', table_name, column_name, ordinal_position, data_type, is_nullable,
                     coalesce(column_default, '')) as x
       from information_schema.columns where table_schema = 'public'`,
    ),
    restricciones: await lista(
      `select format('%s.%s:%s:%s', conrelid::regclass, conname, contype, pg_get_constraintdef(oid)) as x
       from pg_constraint where connamespace = 'public'::regnamespace and contype <> 'n'`,
    ),
    indices: await lista(`select indexdef as x from pg_indexes where schemaname = 'public'`),
    disparadores: await lista(
      `select pg_get_triggerdef(t.oid) as x from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where not t.tgisinternal and c.relnamespace = 'public'::regnamespace`,
    ),
    politicas: await lista(
      `select format('%s.%s:%s:%s:%s:%s:%s', tablename, policyname, permissive, array_to_string(roles, '+'), cmd,
                     coalesce(qual, ''), coalesce(with_check, '')) as x
       from pg_policies where schemaname = 'public'`,
    ),
    funciones: await lista(
      `select format('%s(%s):%s:%s:%s:%s:%s', proname, pg_get_function_identity_arguments(oid), prosecdef,
                     provolatile, coalesce(array_to_string(proconfig, ','), ''), md5(prosrc), coalesce(proacl::text, ''))
              as x
       from pg_proc where pronamespace = 'public'::regnamespace`,
    ),
    tablas: await lista(
      `select format('%s:%s:%s:%s:%s', relname, relkind, relrowsecurity, relforcerowsecurity, coalesce(relacl::text, ''))
              as x
       from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p', 'v', 'S')`,
    ),
    privilegiosPorColumna: await lista(
      `select format('%s.%s:%s', c.relname, a.attname, a.attacl::text) as x
       from pg_attribute a join pg_class c on c.oid = a.attrelid
       where c.relnamespace = 'public'::regnamespace and a.attacl is not null and not a.attisdropped`,
    ),
  };
}

describe.skipIf(base === null)(
  "fiscal: la migración 0006 sobre datos reales y su reversión",
  () => {
    // Solo hasta 0006: las migraciones posteriores (0007 marcas y planes) tienen sus propias pruebas.
    let CARPETA_HASTA_0006 = "";
    beforeAll(async () => {
      CARPETA_HASTA_0006 = await carpetaCon([...HASTA_0005, "0006_fiscal.sql"]);
    });
    afterAll(async () => {
      await rm(CARPETA_HASTA_0006, { recursive: true, force: true });
    });

    /** Empresas en todos los estados, con sucursales, personas, membresías y demás datos de 0001 a 0005. */
    const sembrar = async (c: pg.Client) => {
      const empresas: Array<{ id: string; estado: EstadoDeEmpresaDePrueba }> = [];
      for (const estado of ESTADOS) {
        const m = await crearMundo(c, { estado, sinEmisor: true });
        empresas.push({ id: m.empresa, estado });
        await c.query("insert into sucursal (empresa_id, nombre) values ($1, 'Norte')", [
          m.empresa,
        ]);
        await c.query(
          "insert into membresia (empresa_id, persona_id, rol) values ($1, $2, 'GERENTE')",
          [m.empresa, m.persona],
        );
        await c.query(
          `insert into auditoria_empresa (empresa_id, accion, entidad, entidad_id) values ($1, 'PRUEBA', 'x', 'y')`,
          [m.empresa],
        );
      }
      return empresas;
    };

    it("el relleno: toda empresa existente (también las canceladas) recibe exactamente un principal, y no cambia ni un dato existente", async () => {
      // Una base a la que le falta 0006 no tiene emisores: el trigger de empresa todavía no existe.
      const previa = await baseCon(HASTA_0005);
      try {
        const empresas: Array<{ id: string; estado: string }> = [];
        for (const estado of ESTADOS) {
          const tenant = (
            await previa.cliente.query<{ id: string }>(
              "insert into tenant (nombre) values ($1) returning id",
              [`t-${estado}`],
            )
          ).rows[0]?.id as string;
          const e = (
            await previa.cliente.query<{ id: string }>(
              `insert into empresa (tenant_id, cuit, razon_social, estado, motivo_estado)
             values ($1, $2, $3, $4, $5) returning id`,
              [
                tenant,
                cuitAlAzar(),
                `empresa ${estado}`,
                estado,
                estado === "SUSPENDED" || estado === "CANCELLED" ? "prueba" : null,
              ],
            )
          ).rows[0]?.id as string;
          empresas.push({ id: e, estado });
          await previa.cliente.query(
            "insert into sucursal (empresa_id, nombre) values ($1, 'Casa central')",
            [e],
          );
        }
        expect(
          (await previa.cliente.query("select to_regclass('public.emisor') as t")).rows[0],
        ).toEqual({ t: null });
        const antes = await huella(previa.cliente);

        const r = await aplicarMigraciones(previa.aparte.base.dueno, CARPETA_HASTA_0006);
        expect(r.aplicadas).toEqual(["0006_fiscal.sql"]);

        // Ni un dato de las tablas viejas cambió.
        expect(await huella(previa.cliente)).toEqual(antes);
        // Cada empresa (de los cinco estados) tiene exactamente un principal, activo y sin CUIT propio.
        const principales = await previa.cliente.query<{
          empresa_id: string;
          n: number;
          activos: number;
          con_cuit: number;
          version: number;
        }>(
          `select empresa_id, count(*)::int as n, count(*) filter (where activo)::int as activos,
                count(cuit)::int as con_cuit, max(version)::int as version
           from emisor where es_principal group by empresa_id order by 1`,
        );
        expect(principales.rows.map((f) => f.empresa_id)).toEqual(empresas.map((e) => e.id).sort());
        for (const f of principales.rows) {
          expect(f, f.empresa_id).toMatchObject({ n: 1, activos: 1, con_cuit: 0, version: 1 });
        }
        expect(
          (await previa.cliente.query("select 1 from emisor where not es_principal")).rowCount,
        ).toBe(0);
        // Y las tablas nuevas sin datos: solo el catálogo de provincias y los emisores.
        for (const tabla of [
          "domicilio",
          "datos_fiscales",
          "regla_emisor",
          "punto_de_venta",
          "serie_comprobante",
        ]) {
          expect((await previa.cliente.query(`select 1 from ${tabla}`)).rowCount, tabla).toBe(0);
        }
        expect((await previa.cliente.query("select 1 from provincia")).rowCount).toBe(24);
        // Volver a correr no cambia nada: la migración ya está registrada.
        const otra = await aplicarMigraciones(previa.aparte.base.dueno, CARPETA_HASTA_0006);
        expect(otra.aplicadas).toEqual([]);
        expect(otra.yaAplicadas).toEqual([...HASTA_0005, "0006_fiscal.sql"]);
      } finally {
        await previa.cerrar();
      }
    });

    it("después de 0006 lo que cada rol veía y escribía sigue igual, y la plataforma que da de alta una empresa recibe su emisor principal", async () => {
      const previa = await baseCon(HASTA_0005);
      try {
        const empresas = await sembrar(previa.cliente);
        await aplicarMigraciones(previa.aparte.base.dueno, CARPETA_HASTA_0006);
        const entorno = crearEntornoDePrueba(previa.aparte.base);
        try {
          // La plataforma (con su actor firmado) da de alta una empresa y la activa: sigue funcionando.
          const nueva = await crearEmpresaActiva(entorno);
          expect(
            (
              await previa.cliente.query(
                "select es_principal, activo, cuit from emisor where empresa_id = $1",
                [nueva.empresa],
              )
            ).rows,
          ).toEqual([{ es_principal: true, activo: true, cuit: null }]);
          // Toda empresa (las viejas y la nueva) tiene exactamente un principal.
          expect(
            (
              await previa.cliente.query(
                `select e.id from empresa e
                where (select count(*) from emisor x where x.empresa_id = e.id and x.es_principal) <> 1`,
              )
            ).rowCount,
          ).toBe(0);
          expect(empresas).toHaveLength(5);
        } finally {
          await entorno.cerrar();
        }
      } finally {
        await previa.cerrar();
      }
    });

    it("se frena sin tocar nada si falta 0004, y también si quien migra no evade RLS", async () => {
      // Sin 0004: se aplican 0001 a 0003 y después 0006 sola.
      const sinCuarta = await baseCon(["0001_base.sql", "0002_identidad.sql", "0003_trabajos.sql"]);
      try {
        const carpeta = await carpetaCon([
          "0001_base.sql",
          "0002_identidad.sql",
          "0003_trabajos.sql",
          "0006_fiscal.sql",
        ]);
        try {
          await expect(aplicarMigraciones(sinCuarta.aparte.base.dueno, carpeta)).rejects.toThrow(
            /0006 necesita 0004_plataforma aplicada antes/,
          );
          expect(
            (await sinCuarta.cliente.query("select to_regclass('public.emisor') as t")).rows[0],
          ).toEqual({ t: null });
          expect(
            (
              await sinCuarta.cliente.query<{ nombre: string }>(
                "select nombre from migracion order by 1",
              )
            ).rows.map((f) => f.nombre),
          ).toEqual(["0001_base.sql", "0002_identidad.sql", "0003_trabajos.sql"]);
        } finally {
          await rm(carpeta, { recursive: true, force: true });
        }
      } finally {
        await sinCuarta.cerrar();
      }
      // Un rol que no evade RLS no puede rellenar: el bloque de verificaciones lo detiene con un mensaje claro.
      if (base === null) return;
      const dueno = new pg.Client({ connectionString: base.dueno });
      await dueno.connect();
      try {
        const sql = await readFile(join(REAL, "0006_fiscal.sql"), "utf8");
        const verificacion = /^DO \$\$[\s\S]*?^\$\$;/m.exec(sql)?.[0] ?? "";
        expect(verificacion).toContain("evada RLS");
        await dueno.query("begin");
        try {
          await expect(dueno.query(verificacion)).resolves.toBeDefined();
        } finally {
          await dueno.query("rollback");
        }
        await dueno.query("begin");
        try {
          await dueno.query("set local role zuluhub_app");
          await expect(dueno.query(verificacion)).rejects.toThrow(/evada RLS/);
        } finally {
          await dueno.query("rollback");
        }
      } finally {
        await dueno.end();
      }
    });

    it("la migración espera a una alta de empresa que está en curso y no se la pisa: con el bloqueo ocupado falla por lock_timeout, sin dejar nada", async () => {
      const previa = await baseCon(HASTA_0005);
      const otra = new pg.Client({ connectionString: previa.aparte.base.dueno });
      await otra.connect();
      try {
        const tenant = (
          await previa.cliente.query<{ id: string }>(
            "insert into tenant (nombre) values ('t') returning id",
          )
        ).rows[0]?.id as string;
        // Un alta de empresa sin confirmar: la migración no puede cerrar el relleno con ella en vuelo.
        await otra.query("begin");
        await otra.query(
          "insert into empresa (tenant_id, cuit, razon_social) values ($1, '30500010912', 'en vuelo')",
          [tenant],
        );
        await expect(
          aplicarMigraciones(previa.aparte.base.dueno, CARPETA_HASTA_0006, {
            esperaDeBloqueoEnMs: 300,
          }),
        ).rejects.toMatchObject({ code: "55P03" });
        expect(
          (await previa.cliente.query("select to_regclass('public.emisor') as t")).rows[0],
        ).toEqual({ t: null });
        await otra.query("commit");
        // Con el alta confirmada, la migración la ve y le da su principal.
        const r = await aplicarMigraciones(previa.aparte.base.dueno, CARPETA_HASTA_0006);
        expect(r.aplicadas).toEqual(["0006_fiscal.sql"]);
        expect(
          (await previa.cliente.query("select 1 from emisor where es_principal")).rowCount,
        ).toBe(1);
      } finally {
        await otra.end().catch(() => undefined);
        await previa.cerrar();
      }
    });

    describe("reversión", () => {
      const REVERSION = join(REAL, "reversiones", "0006_revertir_fiscal.sql");

      /** Siembra datos fiscales de verdad en una base con 0006 (por el dueño). */
      const sembrarFiscal = async (c: pg.Client) => {
        const m = await crearMundo(c);
        const secundario = (
          await c.query<{ id: string }>(
            "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, '30500010912') returning id",
            [m.empresa],
          )
        ).rows[0]?.id as string;
        const domicilio = await crearDomicilio(c, m.empresa);
        await c.query(
          `insert into datos_fiscales (empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id,
                inicio_actividades, creado_por) values ($1, $2, 'Mi SA', 'EXENTO', $3, '2020-01-01', $4)`,
          [m.empresa, m.emisor, domicilio, m.persona],
        );
        await c.query("insert into regla_emisor (empresa_id, creado_por) values ($1, $2)", [
          m.empresa,
          m.persona,
        ]);
        const pv = await crearPuntoDeVenta(c, m, { numero: 1, domicilio });
        // Esta base solo llega hasta 0006: la serie todavía no tiene ambiente.
        await crearSerie(c, m.empresa, pv, m.emisor, "FACTURA_B", 12, null);
        return { m, secundario };
      };

      const revertir = async (c: pg.Client, confirmar: boolean) => {
        const sql = await readFile(REVERSION, "utf8");
        await c.query("begin");
        try {
          if (confirmar) await c.query("set local zuluhub.confirmar_reversion = 'SI'");
          await c.query(sql);
          await c.query("commit");
        } catch (error) {
          await c.query("rollback");
          throw error;
        }
      };

      it("deja el catálogo exactamente como antes de 0006, sin tocar los datos de las tablas viejas, aun con datos fiscales cargados", async () => {
        const antes = await baseCon(HASTA_0005);
        const despues = await baseCon([...HASTA_0005, "0006_fiscal.sql"]);
        try {
          const catalogoAnterior = await huellaDeCatalogo(antes.cliente);
          expect(catalogoAnterior["columnas"]?.length).toBeGreaterThan(100);
          const conFiscal = await huellaDeCatalogo(despues.cliente);
          // Control: la huella distingue las dos bases (si no, la comparación de abajo no probaría nada).
          expect(conFiscal).not.toEqual(catalogoAnterior);
          await sembrarFiscal(despues.cliente);
          const datosAntes = await huella(despues.cliente);

          // Con datos fiscales cargados, sin confirmación, no borra nada.
          await expect(revertir(despues.cliente, false)).rejects.toThrow(/avisar al dueño/);
          expect(
            (await despues.cliente.query("select to_regclass('public.emisor') as t")).rows[0],
          ).not.toEqual({ t: null });
          expect((await despues.cliente.query("select 1 from datos_fiscales")).rowCount).toBe(1);

          // Con la confirmación del dueño, revierte.
          await revertir(despues.cliente, true);
          expect(await huellaDeCatalogo(despues.cliente)).toEqual(catalogoAnterior);
          expect(await huella(despues.cliente)).toEqual(datosAntes);
          // El registro de la migración también vuelve atrás: el ejecutor la volvería a aplicar.
          expect(
            (
              await despues.cliente.query<{ nombre: string }>(
                "select nombre from migracion order by 1",
              )
            ).rows.map((f) => f.nombre),
          ).toEqual([...HASTA_0005]);
          for (const tabla of [
            "emisor",
            "domicilio",
            "datos_fiscales",
            "regla_emisor",
            "punto_de_venta",
            "serie_comprobante",
            "provincia",
          ]) {
            expect(
              (await despues.cliente.query("select to_regclass($1) as t", [`public.${tabla}`]))
                .rows[0],
              tabla,
            ).toEqual({ t: null });
          }
        } finally {
          await antes.cerrar();
          await despues.cerrar();
        }
      });

      it("sin datos fiscales (solo los principales del relleno) no pide confirmación, y se puede aplicar 0006 de nuevo: el relleno vuelve a dejar un principal por empresa", async () => {
        const previa = await baseCon(HASTA_0005);
        try {
          await sembrar(previa.cliente);
          await aplicarMigraciones(previa.aparte.base.dueno, CARPETA_HASTA_0006);
          await revertir(previa.cliente, false);
          // Una empresa que nació mientras estaba revertida no tiene emisor, y el relleno se lo da.
          await crearMundo(previa.cliente, { sinEmisor: true });
          const r = await aplicarMigraciones(previa.aparte.base.dueno, CARPETA_HASTA_0006);
          expect(r.aplicadas).toEqual(["0006_fiscal.sql"]);
          expect(
            (
              await previa.cliente.query(
                `select e.id from empresa e
                where (select count(*) from emisor x where x.empresa_id = e.id and x.es_principal) <> 1`,
              )
            ).rowCount,
          ).toBe(0);
          expect(
            (await previa.cliente.query<{ n: number }>("select count(*)::int as n from empresa"))
              .rows[0]?.n,
          ).toBeGreaterThanOrEqual(6);
        } finally {
          await previa.cerrar();
        }
      });

      it("no usa CASCADE: si otra tabla depende de las nuevas, la reversión falla entera y no borra nada", async () => {
        const previa = await baseCon([...HASTA_0005, "0006_fiscal.sql"]);
        try {
          await previa.cliente.query(
            "create table dependiente (id uuid primary key, emisor_id uuid references emisor (id))",
          );
          await expect(revertir(previa.cliente, false)).rejects.toThrow(/depend/);
          expect(
            (await previa.cliente.query("select to_regclass('public.emisor') as t")).rows[0],
          ).not.toEqual({ t: null });
          expect(
            (
              await previa.cliente.query(
                "select nombre from migracion where nombre = '0006_fiscal.sql'",
              )
            ).rowCount,
          ).toBe(1);
        } finally {
          await previa.cerrar();
        }
      });
    });
  },
);
