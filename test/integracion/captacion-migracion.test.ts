import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import {
  CARPETA_DE_MIGRACIONES,
  HASTA_0007,
  archivoDeCaptacion,
  archivoDeReversionDeCaptacion,
  carpetaConCaptacion,
  crearSolicitud,
} from "./captacion-apoyo";
import type { BaseDePruebas } from "./global";
import {
  HASTA_0006,
  baseConMigraciones,
  carpetaCon,
  crearMundoDeMarca,
  huellaDeCatalogo,
  marcaPrincipal,
} from "./marcas-apoyo";

/**
 * Alta por solicitud (L1): la migración de captación sobre una base CON DATOS (aditiva: no cambia ni un dato
 * existente), sus guardas (exige 0004 y 0007), su atomicidad, el bloque que crea y endurece el rol de la landing, lo
 * que el texto del archivo promete (aditiva, sin SECURITY DEFINER, sin contraseñas, nadie borra...) y su reversión
 * (un script aparte, destructivo, que deja el catálogo como estaba antes).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

/** Las tablas que existían antes: ni una fila suya puede cambiar. */
const TABLAS_PREVIAS = [
  "tenant",
  "empresa",
  "sucursal",
  "persona",
  "membresia_tenant",
  "membresia",
  "invitacion",
  "invitacion_empresa",
  "trabajo",
  "auditoria_empresa",
  "auditoria_plataforma",
  "auditoria_acceso_grupo",
  "admin_plataforma",
  "referencia_de_error",
  "emisor",
  "marca",
  "dominio",
  "plan",
  "version_de_plan",
  "version_de_marca",
  "plan_de_tenant",
  "ajuste_de_perilla",
  "modulo_de_empresa",
  "nivel_de_control",
] as const;

async function huellaDeDatos(c: pg.Client): Promise<Record<string, string>> {
  const r: Record<string, string> = {};
  for (const tabla of TABLAS_PREVIAS) {
    const { rows } = await c.query<{ h: string }>(
      `select coalesce(md5(string_agg(to_jsonb(t)::text, '|' order by to_jsonb(t)::text)), '-') as h from ${tabla} t`,
    );
    r[tabla] = rows[0]?.h as string;
  }
  return r;
}

/** Datos de 0001 a 0007 de todo tipo, para comprobar que la migración nueva no los toca. */
async function sembrarDatosPrevios(c: pg.Client): Promise<void> {
  const marca = await marcaPrincipal(c);
  for (const estado of ["ACTIVE", "PROVISIONING", "SUSPENDED"] as const) {
    const m = await crearMundoDeMarca(c, { marca, estado });
    await c.query(
      "insert into auditoria_empresa (empresa_id, accion, entidad, entidad_id) values ($1, 'PRUEBA', 'x', 'y')",
      [m.empresa],
    );
    await c.query(
      "insert into trabajo (empresa_id, tipo, clave_idempotencia) values ($1, 'mantenimiento', $2)",
      [m.empresa, `clave-${m.empresa}`],
    );
  }
  await c.query(
    "insert into auditoria_plataforma (actor, accion, entidad, entidad_id) values ('sistema', 'PRUEBA', 'x', 'y')",
  );
  await c.query(
    "insert into trabajo (tipo, clave_idempotencia) values ('mantenimiento', 'sin-empresa')",
  );
  await c.query(
    "insert into referencia_de_error (referencia, accion, motivo) values ('ZH-AAAA-0001', 'a.b', 'X')",
  );
}

/** Las líneas de cada categoría del catálogo que hay en `despues` y no en `antes`, y al revés. */
function diferencias(
  antes: Record<string, string[]>,
  despues: Record<string, string[]>,
): { nuevas: Record<string, string[]>; perdidas: Record<string, string[]> } {
  const nuevas: Record<string, string[]> = {};
  const perdidas: Record<string, string[]> = {};
  for (const categoria of Object.keys(antes)) {
    const a = new Set(antes[categoria]);
    const d = new Set(despues[categoria]);
    nuevas[categoria] = [...d].filter((x) => !a.has(x));
    perdidas[categoria] = [...a].filter((x) => !d.has(x));
  }
  return { nuevas, perdidas };
}

describe.skipIf(base === null)(
  "captación: la migración sobre datos reales, sus guardas y su reversión",
  () => {
    const b = () => base as BaseDePruebas;

    async function conPrevias<T>(
      trabajo: (
        x: Awaited<ReturnType<typeof baseConMigraciones>>,
        conCaptacion: string,
      ) => Promise<T>,
    ): Promise<T> {
      const previa = await baseConMigraciones(b(), [...HASTA_0007]);
      const conCaptacion = await carpetaConCaptacion(HASTA_0007, true);
      try {
        return await trabajo(previa, conCaptacion);
      } finally {
        await rm(conCaptacion, { recursive: true, force: true });
        await previa.cerrar();
      }
    }

    // ===========================================================================================================
    // Aditiva
    // ===========================================================================================================
    it("sobre una base con datos no cambia NI UN dato existente, ni siquiera la versión; solo agrega objetos", async () => {
      await conPrevias(async (previa, conCaptacion) => {
        await sembrarDatosPrevios(previa.cliente);
        const datosAntes = await huellaDeDatos(previa.cliente);
        const catalogoAntes = await huellaDeCatalogo(previa.cliente);

        const r = await aplicarMigraciones(previa.aparte.base.dueno, conCaptacion);
        expect(r.aplicadas).toEqual([await archivoDeCaptacion()]);

        expect(await huellaDeDatos(previa.cliente)).toEqual(datosAntes);
        const { nuevas, perdidas } = diferencias(
          catalogoAntes,
          await huellaDeCatalogo(previa.cliente),
        );

        // Lo único «perdido» son líneas que cambian por una concesión nueva: la lista de privilegios de dos
        // funciones y de las columnas de `trabajo` y `auditoria_plataforma` (el catálogo escribe el ACL entero).
        const esConcesionNueva = (linea: string) =>
          /^(contexto_firmado|cuit_valido)\(/.test(linea) ||
          /^(trabajo|auditoria_plataforma)\./.test(linea) ||
          /^(auditoria_plataforma|trabajo):/.test(linea);
        for (const [categoria, lineas] of Object.entries(perdidas)) {
          for (const linea of lineas) {
            expect(
              esConcesionNueva(linea) || categoria === "esquema",
              `${categoria}: ${linea}`,
            ).toBe(true);
          }
        }
        // Todo lo nuevo es de captación (tablas, funciones, políticas, disparadores, privilegios), o una de esas
        // líneas modificadas por una concesión.
        const esDeCaptacion = (linea: string) =>
          /solicitud|limite_|captacion|atribucion_valida|datos_de_auditoria|zuluhub_captacion|app_captacion/.test(
            linea,
          ) || esConcesionNueva(linea);
        for (const [categoria, lineas] of Object.entries(nuevas)) {
          for (const linea of lineas)
            expect(esDeCaptacion(linea), `${categoria}: ${linea}`).toBe(true);
        }
        expect(nuevas["tablas"]?.some((t) => t.startsWith("solicitud_de_alta:"))).toBe(true);
        expect(nuevas["tablas"]?.some((t) => t.startsWith("limite_de_captacion:"))).toBe(true);

        // No quedan datos nuevos: las tablas de captación nacen vacías.
        for (const tabla of ["solicitud_de_alta", "limite_de_captacion"]) {
          const { rows } = await previa.cliente.query(`select 1 from ${tabla}`);
          expect(rows, tabla).toEqual([]);
        }
      });
    });

    it("correr las migraciones de nuevo no cambia nada", async () => {
      await conPrevias(async (previa, conCaptacion) => {
        await aplicarMigraciones(previa.aparte.base.dueno, conCaptacion);
        const catalogo = await huellaDeCatalogo(previa.cliente);
        const otra = await aplicarMigraciones(previa.aparte.base.dueno, conCaptacion);
        expect(otra).toEqual({
          aplicadas: [],
          yaAplicadas: [...HASTA_0007, await archivoDeCaptacion()],
        });
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogo);
      });
    });

    // ===========================================================================================================
    // Guardas y atomicidad
    // ===========================================================================================================
    it("exige 0004: sin las funciones del actor de plataforma se frena con un mensaje claro y no deja nada", async () => {
      const hasta0003 = ["0001_base.sql", "0002_identidad.sql", "0003_trabajos.sql"];
      const previa = await baseConMigraciones(b(), hasta0003);
      const carpeta = await carpetaCon(hasta0003);
      try {
        const archivo = await archivoDeCaptacion();
        await writeFile(
          join(carpeta, archivo),
          await readFile(join(CARPETA_DE_MIGRACIONES, archivo), "utf8"),
        );
        await expect(aplicarMigraciones(previa.aparte.base.dueno, carpeta)).rejects.toThrow(
          /captación requiere 0004_plataforma aplicada antes/,
        );
        const { rows } = await previa.cliente.query<{ nombre: string }>(
          "select nombre from migracion order by nombre",
        );
        expect(rows.map((r) => r.nombre)).toEqual(hasta0003);
        expect(
          (await previa.cliente.query("select to_regclass('public.solicitud_de_alta') as t")).rows,
        ).toEqual([{ t: null }]);
      } finally {
        await rm(carpeta, { recursive: true, force: true });
        await previa.cerrar();
      }
    });

    it("exige 0007: sin las marcas se frena con un mensaje claro y no deja nada", async () => {
      const previa = await baseConMigraciones(b(), [...HASTA_0006]);
      const carpeta = await carpetaCon([...HASTA_0006]);
      try {
        const archivo = await archivoDeCaptacion();
        await writeFile(
          join(carpeta, archivo),
          await readFile(join(CARPETA_DE_MIGRACIONES, archivo), "utf8"),
        );
        await expect(aplicarMigraciones(previa.aparte.base.dueno, carpeta)).rejects.toThrow(
          /captación requiere 0007_marcas_y_planes aplicada antes/,
        );
        expect(
          (await previa.cliente.query("select to_regclass('public.solicitud_de_alta') as t")).rows,
        ).toEqual([{ t: null }]);
        const { rows } = await previa.cliente.query<{ nombre: string }>(
          "select nombre from migracion order by nombre",
        );
        expect(rows.map((r) => r.nombre)).toEqual([...HASTA_0006]);
      } finally {
        await rm(carpeta, { recursive: true, force: true });
        await previa.cerrar();
      }
    });

    it("es atómica: si algo falla al final, no queda ninguna de sus tablas, funciones ni concesiones", async () => {
      await conPrevias(async (previa) => {
        await sembrarDatosPrevios(previa.cliente);
        const antes = await huellaDeCatalogo(previa.cliente);
        const datosAntes = await huellaDeDatos(previa.cliente);
        const rota = await carpetaCon([...HASTA_0007]);
        try {
          const archivo = await archivoDeCaptacion();
          const sql = await readFile(join(CARPETA_DE_MIGRACIONES, archivo), "utf8");
          await writeFile(join(rota, archivo), `${sql}\nSELECT 1 / 0;\n`);
          await expect(aplicarMigraciones(previa.aparte.base.dueno, rota)).rejects.toThrow(
            /division by zero/,
          );
        } finally {
          await rm(rota, { recursive: true, force: true });
        }
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(antes);
        expect(await huellaDeDatos(previa.cliente)).toEqual(datosAntes);
      });
    });

    // ===========================================================================================================
    // El bloque que crea y endurece el rol de la landing
    // ===========================================================================================================
    describe("el bloque del rol zuluhub_captacion", () => {
      const bloque = async () => {
        const sql = await readFile(
          join(CARPETA_DE_MIGRACIONES, await archivoDeCaptacion()),
          "utf8",
        );
        const bloques = sql.match(/^DO \$\$[\s\S]*?^\$\$;/gm) ?? [];
        return bloques.find((x) => x.includes("zuluhub_captacion")) ?? "";
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

      it("se localiza, crea el rol NOLOGIN sin poderes y, con el rol sano, corre sin errores", async () => {
        const sql = await bloque();
        expect(sql).toContain("CREATE ROLE");
        expect(sql).toContain(
          "'CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT'",
        );
        await deshacible(async (c) => {
          await expect(c.query(sql)).resolves.toBeDefined();
        });
      });

      it("falla con un mensaje claro si el rol es miembro de otro rol", async () => {
        const sql = await bloque();
        await deshacible(async (c) => {
          await c.query("grant pg_monitor to zuluhub_captacion");
          await expect(c.query(sql)).rejects.toThrow(/zuluhub_captacion es miembro de pg_monitor/);
        });
      });

      it("repone los atributos peligrosos y los topes de tiempo si alguien los cambió, y le quita los objetos temporales", async () => {
        const sql = await bloque();
        await deshacible(async (c) => {
          await c.query("alter role zuluhub_captacion createdb inherit");
          await c.query("alter role zuluhub_captacion reset statement_timeout");
          await c.query("alter role zuluhub_captacion reset lock_timeout");
          const { rows: bd } = await c.query<{ d: string }>("select current_database() as d");
          await c.query(`grant temporary on database ${bd[0]?.d as string} to zuluhub_captacion`);
          await c.query(sql);
          const { rows } = await c.query<{ rolcreatedb: boolean; rolinherit: boolean }>(
            "select rolcreatedb, rolinherit from pg_roles where rolname = 'zuluhub_captacion'",
          );
          expect(rows).toEqual([{ rolcreatedb: false, rolinherit: false }]);
          const { rows: topes } = await c.query<{ setconfig: string[] }>(
            `select s.setconfig from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
           where s.setdatabase = 0 and r.rolname = 'zuluhub_captacion'`,
          );
          expect([...(topes[0]?.setconfig ?? [])].sort()).toEqual([
            "idle_in_transaction_session_timeout=60s",
            "lock_timeout=15s",
            "statement_timeout=30s",
          ]);
          const { rows: temp } = await c.query<{ t: boolean }>(
            "select has_database_privilege('zuluhub_captacion', current_database(), 'TEMP') as t",
          );
          expect(temp).toEqual([{ t: false }]);
        });
      });
    });

    // ===========================================================================================================
    // Lo que el texto del archivo promete
    // ===========================================================================================================
    describe("el texto de la migración", () => {
      const leer = async () => {
        const sql = await readFile(
          join(CARPETA_DE_MIGRACIONES, await archivoDeCaptacion()),
          "utf8",
        );
        return { sql, codigo: sql.replace(/--.*$/gm, "") };
      };

      it("es aditiva: no borra ni reescribe datos, no agrega SECURITY DEFINER, crea un solo rol (NOLOGIN) y nada de contraseñas", async () => {
        const { sql, codigo } = await leer();
        // sin DROP / TRUNCATE / DELETE FROM: el «BEFORE TRUNCATE» de los disparadores y el privilegio DELETE de un GRANT y de una política no lo son
        const sinPermitidos = codigo
          .replace(/BEFORE\s+TRUNCATE/gi, "")
          .replace(/BEFORE\s+DELETE/gi, "")
          .replace(/FOR\s+DELETE/gi, "");
        expect(sinPermitidos).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i);
        expect(codigo).not.toMatch(/SECURITY\s+DEFINER/i);
        expect(codigo.match(/CREATE\s+ROLE/gi)).toHaveLength(1);
        expect(codigo).not.toMatch(/(?<!NO)LOGIN|PASSWORD/i);
        // ningún INSERT ni UPDATE ni DELETE de filas
        expect(codigo).not.toMatch(/\bINSERT\s+INTO\b/i);
        expect(codigo).not.toMatch(/\bUPDATE\s+(?!OF\b|ON\b)\w+\s+SET\b/i);
        // el número es provisorio y el archivo lo dice; depende de 0004 y de 0007 y lo comprueba
        expect(sql).toMatch(/PROVISORIO/);
        expect(sql).toMatch(/captación requiere 0004_plataforma/);
        expect(sql).toMatch(/captación requiere 0007_marcas_y_planes/);
      });

      it("solo crea las dos tablas esperadas, con RLS activa y forzada, y no altera ninguna tabla anterior", async () => {
        const { codigo } = await leer();
        const tablasNuevas = (codigo.match(/CREATE\s+TABLE\s+\w+/gi) ?? []).map(
          (t) => t.split(/\s+/)[2] as string,
        );
        expect(tablasNuevas.sort()).toEqual(["limite_de_captacion", "solicitud_de_alta"]);
        for (const nombre of tablasNuevas) {
          expect(codigo).toMatch(new RegExp(`ALTER TABLE ${nombre} ENABLE ROW LEVEL SECURITY`));
          expect(codigo).toMatch(new RegExp(`ALTER TABLE ${nombre} FORCE ROW LEVEL SECURITY`));
        }
        const alteraciones = (
          codigo.match(/\bALTER\s+TABLE\s+(?:public\.)?\w+\s+\w+(\s+\w+)?/gi) ?? []
        ).map((a) => a.replace(/\s+/g, " "));
        expect(alteraciones.sort()).toEqual([
          "ALTER TABLE limite_de_captacion ENABLE ROW",
          "ALTER TABLE limite_de_captacion FORCE ROW",
          "ALTER TABLE solicitud_de_alta ENABLE ROW",
          "ALTER TABLE solicitud_de_alta FORCE ROW",
        ]);
        expect(codigo).not.toMatch(/\bALTER\s+POLICY\b|\bDROP\s+POLICY\b/i);
      });

      it("toda función nueva fija el search_path (con pg_temp al final) y califica sus tablas con `public.`", async () => {
        const { codigo } = await leer();
        const funciones = codigo.match(/CREATE\s+FUNCTION[\s\S]*?\$\$;/gi) ?? [];
        expect(funciones).toHaveLength(5);
        for (const funcion of funciones) {
          expect(funcion).toMatch(/SET\s+search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/);
          expect(funcion).not.toMatch(
            /(?<!DISTINCT\s)\b(FROM|JOIN)\s+(?!public\.)(?!pg_)\w+\b(?!\s*\()/i,
          );
        }
      });

      it("las concesiones: nadie recibe TRUNCATE ni ALL; DELETE solo el rol de la landing y solo sobre los contadores; EXECUTE solo a quien lo necesita", async () => {
        const { codigo } = await leer();
        const concesiones = codigo.match(/\bGRANT\b[^;]*;/gi) ?? [];
        expect(concesiones.length).toBeGreaterThan(8);
        for (const concesion of concesiones) {
          expect(concesion, concesion).not.toMatch(/\b(TRUNCATE|REFERENCES|TRIGGER|ALL)\b/i);
          if (/\bDELETE\b/i.test(concesion)) {
            expect(concesion).toMatch(/limite_de_captacion\s+TO\s+zuluhub_captacion;$/);
          }
          if (/\bEXECUTE\b/i.test(concesion)) {
            expect(concesion).toMatch(/TO\s+zuluhub_captacion(,\s*zuluhub_plataforma)?;$/);
          }
          // nunca a PUBLIC ni a los demás roles de la aplicación
          expect(concesion).not.toMatch(
            /\bTO\s+(PUBLIC|zuluhub_(app|grupo|trabajos|autenticacion|publico))\b/i,
          );
        }
        // el DELETE existe, una vez
        expect(concesiones.filter((c) => /\bDELETE\b/i.test(c))).toHaveLength(1);
      });

      it("las políticas restrictivas son solo de la plataforma, y no hay ninguna `FOR ALL`", async () => {
        const { codigo } = await leer();
        for (const restrictiva of codigo.match(/AS\s+RESTRICTIVE[^;]*;/gi) ?? []) {
          expect(restrictiva).toMatch(/TO\s+zuluhub_plataforma\b/);
          expect(restrictiva).not.toMatch(
            /zuluhub_(app|grupo|trabajos|autenticacion|publico|captacion)/,
          );
        }
        expect(codigo).not.toMatch(/CREATE\s+POLICY[^;]*\bFOR\s+ALL\b/i);
      });
    });

    // ===========================================================================================================
    // La reversión
    // ===========================================================================================================
    describe("reversión", () => {
      const revertir = async (c: pg.Client, confirmar: boolean) => {
        const sql = await readFile(await archivoDeReversionDeCaptacion(), "utf8");
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

      it("vive fuera de la carpeta que aplica el ejecutor (nunca se corre sola), es destructiva y lo dice, sin CASCADE ni contraseñas", async () => {
        const aplicables = (await readdir(CARPETA_DE_MIGRACIONES)).filter((n) =>
          /^\d{4}_[a-z0-9_]+\.sql$/.test(n),
        );
        const archivo = await archivoDeCaptacion();
        expect(aplicables).toContain(archivo);
        expect(aplicables.filter((n) => n.includes("revertir"))).toEqual([]);
        const reversion = await readFile(await archivoDeReversionDeCaptacion(), "utf8");
        expect(reversion).toMatch(/DESTRUCTIVA/);
        expect(reversion).toMatch(/PROVISORIO/);
        expect(reversion).not.toMatch(/PASSWORD\s+'/i);
        expect(reversion.replace(/--.*$/gm, "")).not.toMatch(/\bCASCADE\b/i);
      });

      it("sin datos no pide confirmación; deja el catálogo y los datos como antes, y la migración se puede aplicar de nuevo", async () => {
        await conPrevias(async (previa, conCaptacion) => {
          await sembrarDatosPrevios(previa.cliente);
          const catalogoAntes = await huellaDeCatalogo(previa.cliente);
          const datosAntes = await huellaDeDatos(previa.cliente);
          await aplicarMigraciones(previa.aparte.base.dueno, conCaptacion);
          expect(await huellaDeCatalogo(previa.cliente)).not.toEqual(catalogoAntes);

          await revertir(previa.cliente, false);
          expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogoAntes);
          expect(await huellaDeDatos(previa.cliente)).toEqual(datosAntes);
          expect(
            (
              await previa.cliente.query(
                "select nombre from migracion where nombre like '%\\_captacion.sql'",
              )
            ).rows,
          ).toEqual([]);

          // y vuelve a aplicarse, dejando lo mismo que la primera vez
          const otra = await aplicarMigraciones(previa.aparte.base.dueno, conCaptacion);
          expect(otra.aplicadas).toEqual([await archivoDeCaptacion()]);
          const despues = await huellaDeCatalogo(previa.cliente);
          await revertir(previa.cliente, false);
          await aplicarMigraciones(previa.aparte.base.dueno, conCaptacion);
          expect(await huellaDeCatalogo(previa.cliente)).toEqual(despues);
        });
      });

      it("con solicitudes pide confirmación expresa y, confirmada, revierte; la auditoría y los trabajos ya escritos quedan", async () => {
        await conPrevias(async (previa, conCaptacion) => {
          const catalogoAntes = await huellaDeCatalogo(previa.cliente);
          await aplicarMigraciones(previa.aparte.base.dueno, conCaptacion);
          const s = await crearSolicitud(previa.cliente, {});
          await previa.cliente.query(
            "insert into auditoria_plataforma (actor, accion, entidad, entidad_id) values ('captacion', 'SOLICITUD_RECIBIDA', 'solicitud_de_alta', $1)",
            [s.id],
          );
          await previa.cliente.query(
            "insert into trabajo (tipo, datos, clave_idempotencia) values ('enviar_verificacion_de_solicitud', $1::jsonb, $2)",
            [JSON.stringify({ solicitudId: s.id }), `solicitud:${s.id}:verificacion:1`],
          );
          await expect(revertir(previa.cliente, false)).rejects.toThrow(
            /zuluhub\.confirmar_reversion/,
          );
          // el rechazo no deshizo ni tocó nada (la reversión es una sola transacción)
          expect(
            (await previa.cliente.query("select count(*)::int as n from solicitud_de_alta")).rows,
          ).toEqual([{ n: 1 }]);
          await revertir(previa.cliente, true);
          expect(
            (await previa.cliente.query("select to_regclass('public.solicitud_de_alta') as t"))
              .rows,
          ).toEqual([{ t: null }]);
          // el catálogo vuelve a ser el de antes, salvo las filas append-only que no se borran
          expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogoAntes);
          expect(
            (
              await previa.cliente.query(
                "select count(*)::int as n from auditoria_plataforma where actor = 'captacion'",
              )
            ).rows,
          ).toEqual([{ n: 1 }]);
          expect(
            (
              await previa.cliente.query(
                "select count(*)::int as n from trabajo where tipo = 'enviar_verificacion_de_solicitud'",
              )
            ).rows,
          ).toEqual([{ n: 1 }]);
        });
      });

      it("con solo contadores también pide confirmación", async () => {
        await conPrevias(async (previa, conCaptacion) => {
          await aplicarMigraciones(previa.aparte.base.dueno, conCaptacion);
          await previa.cliente.query(
            "insert into limite_de_captacion (clave, ventana, ventana_inicio, cuenta) values ('global:solicitudes', 'HORA', now(), 1)",
          );
          await expect(revertir(previa.cliente, false)).rejects.toThrow(
            /zuluhub\.confirmar_reversion/,
          );
          await revertir(previa.cliente, true);
        });
      });

      it("necesita un rol que evada RLS: si no, rechaza (así no cuenta cero filas en silencio)", async () => {
        await conPrevias(async (previa, conCaptacion) => {
          await aplicarMigraciones(previa.aparte.base.dueno, conCaptacion);
          const sql = await readFile(await archivoDeReversionDeCaptacion(), "utf8");
          const c = new pg.Client({ connectionString: previa.aparte.base.plataforma });
          await c.connect();
          try {
            await expect(c.query(sql)).rejects.toThrow(/evada RLS/);
          } finally {
            await c.end();
          }
        });
      });

      it("no borra el rol zuluhub_captacion (es del clúster): lo deja sin acceso al esquema ni a nada", async () => {
        await conPrevias(async (previa, conCaptacion) => {
          await aplicarMigraciones(previa.aparte.base.dueno, conCaptacion);
          await revertir(previa.cliente, false);
          const { rows } = await previa.cliente.query<{
            existe: boolean;
            explicito: boolean;
            columnas: number;
          }>(
            `select exists (select 1 from pg_roles where rolname = 'zuluhub_captacion') as existe,
                  exists (select 1 from pg_namespace n, aclexplode(n.nspacl) a
                            join pg_roles r on r.oid = a.grantee
                           where n.nspname = 'public' and r.rolname = 'zuluhub_captacion') as explicito,
                  (select count(*)::int from information_schema.column_privileges
                    where grantee = 'zuluhub_captacion' and table_schema = 'public') as columnas`,
          );
          expect(rows).toEqual([{ existe: true, explicito: false, columnas: 0 }]);
          const { rows: funciones } = await previa.cliente.query<{ puede: boolean }>(
            `select has_function_privilege('zuluhub_captacion', 'public.contexto_firmado()'::regprocedure, 'EXECUTE')
                  as puede`,
          );
          expect(funciones).toEqual([{ puede: false }]);
        });
      });
    });
  },
);
