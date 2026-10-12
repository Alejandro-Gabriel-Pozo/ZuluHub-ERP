import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { crearMundo, type EstadoDeEmpresaDePrueba, type Mundo } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import {
  ARCHIVO_0007,
  CARPETA_DE_MIGRACIONES,
  HASTA_0006,
  ajustarPerilla,
  asignarPlan,
  baseConMigraciones,
  carpetaCon,
  crearBorradorDeMarca,
  crearDominio,
  crearMarca,
  crearPlan,
  crearPlanPublicado,
  crearVersionDeMarcaConfirmada,
  huellaDeCatalogo,
  marcaPrincipal,
} from "./marcas-apoyo";

/**
 * Marcas y planes (M3): la migración 0007 sobre una base CON DATOS (el relleno de la marca principal, que
 * no cambia ni un dato existente), sus guardas (exige 0004, no tolera referencias repetidas), su atomicidad,
 * el bloqueo contra una alta en curso, el bloque del rol público y su reversión (un script aparte,
 * destructivo, que deja el catálogo como estaba antes de 0007).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const ESTADOS: readonly EstadoDeEmpresaDePrueba[] = [
  "PROVISIONING",
  "ACTIVE",
  "SUSPENDED",
  "CANCELLED",
  "DELETING",
];
/** Las tablas de 0001 a 0006 cuyo contenido 0007 no puede tocar. */
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
  "auditoria_acceso_grupo",
  "admin_plataforma",
  "referencia_de_error",
  "traspaso_gerencia",
  "emisor",
  "datos_fiscales",
  "domicilio",
  "provincia",
] as const;
/** Lo que 0007 agrega a tablas viejas: no cuenta como «dato que cambió». */
const COLUMNAS_NUEVAS = ["marca_id", "hora_de_corte", "resultado"] as const;

const REVERSION = join(CARPETA_DE_MIGRACIONES, "reversiones", "0007_revertir_marcas_y_planes.sql");

/** Un resumen del contenido de las tablas viejas, sin las columnas que 0007 agrega. */
async function huellaDeDatos(
  c: pg.Client,
  /** Columnas de más que no cuentan (lo que la propia prueba cambió a propósito). */
  tambienSacar: Readonly<Record<string, readonly string[]>> = {},
): Promise<Record<string, string>> {
  const r: Record<string, string> = {};
  for (const tabla of TABLAS_VIEJAS) {
    const sacar = [...COLUMNAS_NUEVAS, ...(tambienSacar[tabla] ?? [])]
      .map((col) => ` - '${col}'`)
      .join("");
    const { rows } = await c.query<{ h: string }>(
      `select coalesce(md5(string_agg((to_jsonb(t)${sacar})::text, '|' order by (to_jsonb(t)${sacar})::text)), '-') as h
         from ${tabla} t`,
    );
    r[tabla] = rows[0]?.h as string;
  }
  return r;
}

/** Empresas en todos los estados, con sucursales, personas, membresías y auditorías de 0001 a 0006. */
async function sembrarDatosViejos(c: pg.Client) {
  const mundos = [];
  for (const estado of ESTADOS) {
    const m = await crearMundo(c, { estado });
    mundos.push({ ...m, estado });
    await c.query("insert into sucursal (empresa_id, nombre) values ($1, 'Norte')", [m.empresa]);
    await c.query(
      "insert into membresia (empresa_id, persona_id, rol) values ($1, $2, 'GERENTE')",
      [m.empresa, m.persona],
    );
    await c.query(
      `insert into auditoria_empresa (empresa_id, accion, entidad, entidad_id) values ($1, 'PRUEBA', 'x', 'y')`,
      [m.empresa],
    );
  }
  // otro tenant con dos empresas, uno suspendido
  const t = mundos[0] as (typeof mundos)[number];
  await c.query("update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1", [
    t.tenant,
  ]);
  await c.query(
    "insert into referencia_de_error (referencia, accion, motivo) values ('ZH-AAAA-0001', 'a.b', 'X')",
  );
  await c.query(
    "insert into referencia_de_error (referencia, accion, motivo) values ('ZH-AAAA-0002', 'a.b', 'X')",
  );
  await c.query(
    "insert into membresia_tenant (persona_id, tenant_id, rol) values ($1, $2, 'PROPIETARIO')",
    [t.persona, t.tenant],
  );
  await c.query("insert into auditoria_acceso_grupo (tenant_id, persona_id) values ($1, $2)", [
    t.tenant,
    t.persona,
  ]);
  return mundos;
}

describe.skipIf(base === null)(
  "marcas y planes: la migración 0007 sobre datos reales y su reversión",
  () => {
    const b = () => base as BaseDePruebas;

    async function conMigracionesAplicadas<T>(
      trabajo: (x: Awaited<ReturnType<typeof baseConMigraciones>>, con0007: string) => Promise<T>,
    ): Promise<T> {
      const previa = await baseConMigraciones(b(), HASTA_0006);
      const con0007 = await carpetaCon([...HASTA_0006, ARCHIVO_0007]);
      try {
        return await trabajo(previa, con0007);
      } finally {
        await rm(con0007, { recursive: true, force: true });
        await previa.cerrar();
      }
    }

    it("el relleno: todo tenant existente (en cualquier estado) queda con la marca principal y no cambia NI UN dato existente (ni la versión ni actualizado_en)", async () => {
      await conMigracionesAplicadas(async (previa, con0007) => {
        const mundos = await sembrarDatosViejos(previa.cliente);
        const antes = await huellaDeDatos(previa.cliente);
        const { rows: versionesAntes } = await previa.cliente.query(
          "select id, version, actualizado_en from tenant order by id",
        );
        expect(mundos).toHaveLength(5);

        const r = await aplicarMigraciones(previa.aparte.base.dueno, con0007);
        expect(r.aplicadas).toEqual([ARCHIVO_0007]);

        // todo tenant, de la marca principal (la única que existe)
        const { rows: marcas } = await previa.cliente.query<{
          id: string;
          codigo: string;
          es_principal: boolean;
        }>("select id, codigo, es_principal from marca");
        expect(marcas).toHaveLength(1);
        expect(marcas[0]).toMatchObject({ codigo: "zuluhub", es_principal: true });
        const { rows: tenants } = await previa.cliente.query<{ n: number; marcas: number }>(
          "select count(*)::int as n, count(*) filter (where marca_id = $1)::int as marcas from tenant",
          [marcas[0]?.id],
        );
        expect(tenants).toEqual([{ n: 5, marcas: 5 }]);
        // nada de lo existente cambió: ni los datos, ni la versión, ni la fecha de cambio
        expect(await huellaDeDatos(previa.cliente)).toEqual(antes);
        expect(
          (await previa.cliente.query("select id, version, actualizado_en from tenant order by id"))
            .rows,
        ).toEqual(versionesAntes);
        // las columnas nuevas de las tablas viejas tomaron su valor por defecto
        const { rows: horas } = await previa.cliente.query<{ h: string; n: number }>(
          "select hora_de_corte::text as h, count(*)::int as n from sucursal group by 1",
        );
        expect(horas).toEqual([{ h: "00:00:00", n: 10 }]);
        const { rows: resultados } = await previa.cliente.query(
          "select resultado from auditoria_acceso_grupo",
        );
        expect(resultados).toEqual([{ resultado: "PERMITIDO" }]);
        // y las tablas nuevas están vacías, salvo la marca principal
        for (const tabla of [
          "dominio_de_marca",
          "plan",
          "version_de_plan",
          "version_de_marca",
          "plan_de_tenant",
          "ajuste_de_perilla",
          "modulo_de_empresa",
          "nivel_de_control",
        ]) {
          const { rows } = await previa.cliente.query(`select 1 from ${tabla}`);
          expect(rows, tabla).toEqual([]);
        }
      });
    });

    it("después de 0007 un tenant sin marca falla, y correr las migraciones de nuevo no cambia nada", async () => {
      await conMigracionesAplicadas(async (previa, con0007) => {
        await sembrarDatosViejos(previa.cliente);
        await aplicarMigraciones(previa.aparte.base.dueno, con0007);
        await expect(
          previa.cliente.query("insert into tenant (nombre) values ('sin marca')"),
        ).rejects.toMatchObject({
          code: "23502",
        });
        const catalogo = await huellaDeCatalogo(previa.cliente);
        const otra = await aplicarMigraciones(previa.aparte.base.dueno, con0007);
        expect(otra).toEqual({ aplicadas: [], yaAplicadas: [...HASTA_0006, ARCHIVO_0007] });
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogo);
      });
    });

    it("sobre una base sin datos crea todo y solo escribe una fila: la marca principal", async () => {
      await conMigracionesAplicadas(async (previa, con0007) => {
        await aplicarMigraciones(previa.aparte.base.dueno, con0007);
        const { rows } = await previa.cliente.query<{ tabla: string; n: number }>(
          `select 'marca' as tabla, count(*)::int as n from marca
         union all select 'dominio_de_marca', count(*)::int from dominio_de_marca
         union all select 'plan', count(*)::int from plan
         union all select 'version_de_plan', count(*)::int from version_de_plan
         union all select 'version_de_marca', count(*)::int from version_de_marca
         union all select 'plan_de_tenant', count(*)::int from plan_de_tenant
         union all select 'ajuste_de_perilla', count(*)::int from ajuste_de_perilla
         union all select 'modulo_de_empresa', count(*)::int from modulo_de_empresa
         union all select 'nivel_de_control', count(*)::int from nivel_de_control`,
        );
        expect(Object.fromEntries(rows.map((r) => [r.tabla, r.n]))).toEqual({
          marca: 1,
          dominio_de_marca: 0,
          plan: 0,
          version_de_plan: 0,
          version_de_marca: 0,
          plan_de_tenant: 0,
          ajuste_de_perilla: 0,
          modulo_de_empresa: 0,
          nivel_de_control: 0,
        });
      });
    });

    // ===========================================================================================
    // Guardas y atomicidad
    // ===========================================================================================
    it("exige 0004: sin las funciones del actor de plataforma se frena con un mensaje claro y no deja nada a medias", async () => {
      const sin0004 = await carpetaCon([
        "0001_base.sql",
        "0002_identidad.sql",
        "0003_trabajos.sql",
      ]);
      const previa = await baseConMigraciones(b(), [
        "0001_base.sql",
        "0002_identidad.sql",
        "0003_trabajos.sql",
      ]);
      try {
        await writeFile(
          join(sin0004, ARCHIVO_0007),
          await readFile(join(CARPETA_DE_MIGRACIONES, ARCHIVO_0007), "utf8"),
        );
        await expect(aplicarMigraciones(previa.aparte.base.dueno, sin0004)).rejects.toThrow(
          /0007 requiere 0004_plataforma aplicada antes/,
        );
        const { rows } = await previa.cliente.query<{ nombre: string }>(
          "select nombre from migracion order by nombre",
        );
        expect(rows.map((r) => r.nombre)).toEqual([
          "0001_base.sql",
          "0002_identidad.sql",
          "0003_trabajos.sql",
        ]);
        expect(
          (await previa.cliente.query("select to_regclass('public.marca') as t")).rows,
        ).toEqual([{ t: null }]);
      } finally {
        await rm(sin0004, { recursive: true, force: true });
        await previa.cerrar();
      }
    });

    it("con referencias de error repetidas se frena (la tabla es de solo inserción: hay que decidir con el dueño) y no cambia nada", async () => {
      await conMigracionesAplicadas(async (previa, con0007) => {
        for (const motivo of ["UNO", "DOS"]) {
          await previa.cliente.query(
            "insert into referencia_de_error (referencia, accion, motivo) values ('ZH-BBBB-0001', 'a.b', $1)",
            [motivo],
          );
        }
        const antes = await huellaDeCatalogo(previa.cliente);
        await expect(aplicarMigraciones(previa.aparte.base.dueno, con0007)).rejects.toThrow(
          /hay 1 referencias de error repetidas/,
        );
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(antes);
        expect(
          (await previa.cliente.query("select to_regclass('public.marca') as t")).rows,
        ).toEqual([{ t: null }]);
        expect(
          (await previa.cliente.query("select nombre from migracion where nombre like '0007%'"))
            .rows,
        ).toEqual([]);
      });
    });

    it("es atómica: si algo falla al final, no queda ninguna de sus tablas, columnas, funciones ni la marca principal", async () => {
      await conMigracionesAplicadas(async (previa) => {
        await sembrarDatosViejos(previa.cliente);
        const antes = await huellaDeCatalogo(previa.cliente);
        const datosAntes = await huellaDeDatos(previa.cliente);
        const rota = await carpetaCon([...HASTA_0006]);
        try {
          const sql = await readFile(join(CARPETA_DE_MIGRACIONES, ARCHIVO_0007), "utf8");
          await writeFile(join(rota, ARCHIVO_0007), `${sql}\nSELECT 1 / 0;\n`);
          await expect(aplicarMigraciones(previa.aparte.base.dueno, rota)).rejects.toThrow(
            /division by zero/,
          );
        } finally {
          await rm(rota, { recursive: true, force: true });
        }
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(antes);
        expect(await huellaDeDatos(previa.cliente)).toEqual(datosAntes);
        expect(
          (await previa.cliente.query("select to_regclass('public.marca') as t")).rows,
        ).toEqual([{ t: null }]);
      });
    });

    it("espera a una alta de tenant en curso: con el bloqueo ocupado falla por lock_timeout sin dejar nada, y después rellena también al tenant que entró", async () => {
      await conMigracionesAplicadas(async (previa, con0007) => {
        await sembrarDatosViejos(previa.cliente);
        const antes = await huellaDeCatalogo(previa.cliente);
        // una alta de tenant sin confirmar: bloquea la tabla para el ALTER TABLE de 0007
        const alta = new pg.Client({ connectionString: previa.aparte.base.dueno });
        await alta.connect();
        try {
          await alta.query("begin");
          const { rows } = await alta.query<{ id: string }>(
            "insert into tenant (nombre) values ('en curso') returning id",
          );
          await expect(
            aplicarMigraciones(previa.aparte.base.dueno, con0007, { esperaDeBloqueoEnMs: 300 }),
          ).rejects.toThrow(/lock timeout|bloqueo|canceling statement/i);
          expect(await huellaDeCatalogo(previa.cliente)).toEqual(antes);
          await alta.query("commit");
          const r = await aplicarMigraciones(previa.aparte.base.dueno, con0007);
          expect(r.aplicadas).toEqual([ARCHIVO_0007]);
          const { rows: t } = await previa.cliente.query<{ codigo: string }>(
            "select m.codigo from tenant t join marca m on m.id = t.marca_id where t.id = $1",
            [rows[0]?.id],
          );
          expect(t).toEqual([{ codigo: "zuluhub" }]);
        } finally {
          await alta.query("rollback").catch(() => undefined);
          await alta.end();
        }
      });
    });

    // ===========================================================================================
    // El bloque que crea y endurece el rol público
    // ===========================================================================================
    describe("el bloque del rol zuluhub_publico", () => {
      const bloque = async () => {
        const sql = await readFile(join(CARPETA_DE_MIGRACIONES, ARCHIVO_0007), "utf8");
        const bloques = sql.match(/^DO \$\$[\s\S]*?^\$\$;/gm) ?? [];
        return bloques.find((x) => x.includes("zuluhub_publico")) ?? "";
      };
      /** Todo lo que haga `trabajo` se deshace: los roles son del clúster y las demás pruebas los usan. */
      const deshacible = async (trabajo: (c: pg.Client) => Promise<void>): Promise<void> => {
        const c = new pg.Client({ connectionString: b().dueno });
        await c.connect();
        try {
          await c.query("begin");
          await trabajo(c);
        } finally {
          await c.query("rollback").catch(() => undefined);
          await c.end();
        }
      };

      it("se localiza y, con el rol sano, corre sin errores (y sin tocar nada)", async () => {
        const sql = await bloque();
        expect(sql).toContain("CREATE ROLE");
        expect(sql).toContain("NOLOGIN");
        await deshacible(async (c) => {
          await expect(c.query(sql)).resolves.toBeDefined();
        });
      });

      it("falla con un mensaje claro si el rol es miembro de otro rol", async () => {
        const sql = await bloque();
        await deshacible(async (c) => {
          await c.query("grant pg_monitor to zuluhub_publico");
          await expect(c.query(sql)).rejects.toThrow(/zuluhub_publico es miembro de pg_monitor/);
        });
      });

      it("repone los atributos peligrosos y los topes de tiempo si alguien los cambió", async () => {
        const sql = await bloque();
        await deshacible(async (c) => {
          await c.query("alter role zuluhub_publico createdb inherit");
          await c.query("alter role zuluhub_publico reset statement_timeout");
          await c.query("alter role zuluhub_publico reset lock_timeout");
          await c.query(sql);
          const { rows } = await c.query<{ rolcreatedb: boolean; rolinherit: boolean }>(
            "select rolcreatedb, rolinherit from pg_roles where rolname = 'zuluhub_publico'",
          );
          expect(rows).toEqual([{ rolcreatedb: false, rolinherit: false }]);
          const { rows: topes } = await c.query<{ setconfig: string[] }>(
            `select s.setconfig from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
           where s.setdatabase = 0 and r.rolname = 'zuluhub_publico'`,
          );
          expect([...(topes[0]?.setconfig ?? [])].sort()).toEqual([
            "idle_in_transaction_session_timeout=60s",
            "lock_timeout=15s",
            "statement_timeout=30s",
          ]);
          // sin objetos temporales para él
          const { rows: temp } = await c.query<{ t: boolean }>(
            "select has_database_privilege('zuluhub_publico', current_database(), 'TEMP') as t",
          );
          expect(temp).toEqual([{ t: false }]);
        });
      });
    });

    // ===========================================================================================
    // La reversión
    // ===========================================================================================
    describe("reversión", () => {
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

      it("sin datos propios de 0007 no pide confirmación, deja el catálogo y los datos como antes de 0007, y 0007 se puede aplicar de nuevo", async () => {
        await conMigracionesAplicadas(async (previa, con0007) => {
          await sembrarDatosViejos(previa.cliente);
          const catalogoAntes = await huellaDeCatalogo(previa.cliente);
          const datosAntes = await huellaDeDatos(previa.cliente);
          await aplicarMigraciones(previa.aparte.base.dueno, con0007);
          expect(await huellaDeCatalogo(previa.cliente)).not.toEqual(catalogoAntes);

          await revertir(previa.cliente, false);
          expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogoAntes);
          expect(await huellaDeDatos(previa.cliente)).toEqual(datosAntes);
          expect(
            (await previa.cliente.query("select nombre from migracion where nombre like '0007%'"))
              .rows,
          ).toEqual([]);
          // y vuelve a aplicarse: el relleno otra vez deja a todos con la principal
          const otra = await aplicarMigraciones(previa.aparte.base.dueno, con0007);
          expect(otra.aplicadas).toEqual([ARCHIVO_0007]);
          const { rows } = await previa.cliente.query<{ n: number }>(
            "select count(*)::int as n from tenant t join marca m on m.id = t.marca_id where m.es_principal",
          );
          expect(rows).toEqual([{ n: 5 }]);
        });
      });

      // Cada dato propio de 0007 dispara por sí solo la confirmación expresa.
      const DATOS_PROPIOS: readonly [string, (c: pg.Client, m: Mundo) => Promise<unknown>][] = [
        [
          "una marca que no es la principal",
          (c) => c.query("insert into marca (codigo) values ('otra-marca')"),
        ],
        [
          "un tenant de otra marca",
          async (c) => {
            const marca = await crearMarca(c);
            await c.query("insert into tenant (nombre, marca_id) values ('de otra marca', $1)", [
              marca,
            ]);
          },
        ],
        ["un dominio", async (c) => crearDominio(c, await marcaPrincipal(c))],
        ["un plan", (c) => crearPlan(c)],
        [
          "una asignación de plan",
          async (c, m) => {
            const { version } = await crearPlanPublicado(c);
            await asignarPlan(c, m.tenant, version);
          },
        ],
        ["un ajuste de perilla", (c, m) => ajustarPerilla(c, m.tenant, "empresas_por_tenant", "2")],
        ["una versión de marca", async (c) => crearBorradorDeMarca(c, await marcaPrincipal(c))],
        [
          "un módulo activado",
          (c, m) =>
            c.query("insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'reservas')", [
              m.empresa,
            ]),
        ],
        [
          "un nivel de control",
          (c, m) =>
            c.query(
              "insert into nivel_de_control (empresa_id, control, nivel) values ($1, 'caja.descuadre', 'AVISAR')",
              [m.empresa],
            ),
        ],
        [
          "una hora de corte",
          (c, m) =>
            c.query("update sucursal set hora_de_corte = '04:00' where id = $1", [m.sucursal]),
        ],
        [
          "un intento fallido de la vista de grupo",
          (c, m) =>
            c.query(
              "insert into auditoria_acceso_grupo (tenant_id, persona_id, resultado) values ($1, $2, 'DENEGADO')",
              [m.tenant, m.persona],
            ),
        ],
      ];

      it.each(DATOS_PROPIOS)(
        "con %s pide confirmación expresa y, confirmada, revierte",
        async (_nombre, crear) => {
          await conMigracionesAplicadas(async (previa, con0007) => {
            const mundos = await sembrarDatosViejos(previa.cliente);
            const catalogoAntes = await huellaDeCatalogo(previa.cliente);
            await aplicarMigraciones(previa.aparte.base.dueno, con0007);
            await crear(previa.cliente, mundos[1] as Mundo);
            await expect(revertir(previa.cliente, false)).rejects.toThrow(
              /zuluhub\.confirmar_reversion/,
            );
            // el rechazo no deshizo ni tocó nada (la reversión es una sola transacción)
            expect(
              (await previa.cliente.query("select to_regclass('public.marca') as t")).rows,
            ).not.toEqual([{ t: null }]);
            await revertir(previa.cliente, true);
            expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogoAntes);
            expect(
              (await previa.cliente.query("select to_regclass('public.marca') as t")).rows,
            ).toEqual([{ t: null }]);
          });
        },
      );

      it("con todo lo propio de 0007 cargado, la confirmación expresa borra solo eso: el catálogo y los datos de 0001 a 0006 quedan como estaban", async () => {
        await conMigracionesAplicadas(async (previa, con0007) => {
          const mundos = await sembrarDatosViejos(previa.cliente);
          const catalogoAntes = await huellaDeCatalogo(previa.cliente);
          // La hora de corte se cambia a propósito: eso sube la versión de esa sucursal, que no cuenta.
          const tambienSacar = { sucursal: ["version", "actualizado_en"] };
          const datosAntes = await huellaDeDatos(previa.cliente, tambienSacar);
          await aplicarMigraciones(previa.aparte.base.dueno, con0007);
          const c = previa.cliente;
          const m = mundos[1] as Mundo;
          const principal = await marcaPrincipal(c);
          const hija = await crearMarca(c, { padre: principal });
          await crearDominio(c, principal, { canonico: true });
          await crearVersionDeMarcaConfirmada(c, principal, { nombreVisible: "Marca" });
          await crearVersionDeMarcaConfirmada(c, hija, { nombreVisible: "Hija" });
          const { version } = await crearPlanPublicado(c);
          await asignarPlan(c, m.tenant, version);
          await ajustarPerilla(c, m.tenant, "empresas_por_tenant", "ILIMITADO", {
            empresa: m.empresa,
          });
          await c.query(
            "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'reservas')",
            [m.empresa],
          );
          await c.query(
            "insert into nivel_de_control (empresa_id, control, nivel) values ($1, 'caja.descuadre', 'BLOQUEAR')",
            [m.empresa],
          );
          await c.query("update sucursal set hora_de_corte = '05:30' where id = $1", [m.sucursal]);
          await expect(revertir(c, false)).rejects.toThrow(/zuluhub\.confirmar_reversion/);
          await revertir(c, true);
          expect(await huellaDeCatalogo(c)).toEqual(catalogoAntes);
          expect(await huellaDeDatos(c, tambienSacar)).toEqual(datosAntes);
        });
      });

      it("necesita un rol que evada RLS: si no, rechaza (así no cuenta cero filas en silencio)", async () => {
        await conMigracionesAplicadas(async (previa, con0007) => {
          await aplicarMigraciones(previa.aparte.base.dueno, con0007);
          const sql = await readFile(REVERSION, "utf8");
          // el rol de la aplicación no evade RLS (ni tiene permisos): el bloque inicial lo rechaza
          const c = new pg.Client({ connectionString: previa.aparte.base.app });
          await c.connect();
          try {
            await expect(c.query(sql)).rejects.toThrow(/evada RLS/);
          } finally {
            await c.end();
          }
        });
      });

      it("no borra el rol zuluhub_publico (es del clúster): lo deja sin acceso al esquema", async () => {
        await conMigracionesAplicadas(async (previa, con0007) => {
          await aplicarMigraciones(previa.aparte.base.dueno, con0007);
          await revertir(previa.cliente, false);
          // El USAGE que le dio 0007 sobre el esquema se quita (el que tiene todo rol viene de PUBLIC, como en 0001).
          const { rows } = await previa.cliente.query<{ existe: boolean; explicito: boolean }>(
            `select exists (select 1 from pg_roles where rolname = 'zuluhub_publico') as existe,
                  exists (select 1 from pg_namespace n, aclexplode(n.nspacl) a
                           join pg_roles r on r.oid = a.grantee
                          where n.nspname = 'public' and r.rolname = 'zuluhub_publico') as explicito`,
          );
          expect(rows).toEqual([{ existe: true, explicito: false }]);
        });
      });
    });
  },
);
