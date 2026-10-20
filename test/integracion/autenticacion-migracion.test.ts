import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import {
  archivoDeAutenticacion,
  archivoDeReversionDeAutenticacion,
  carpetaConAutenticacion,
  crearUsuarioDeBase,
  empresaConMiembro,
  migracionesPrevias,
  personaConUsuario,
} from "./autenticacion-apoyo";
import type { BaseDePruebas } from "./global";
import {
  CARPETA_DE_MIGRACIONES,
  baseConMigraciones,
  carpetaCon,
  crearMundoDeMarca,
  huellaDeCatalogo,
  marcaPrincipal,
} from "./marcas-apoyo";

/**
 * Autenticación (W3a): la migración 0010 sobre una base CON DATOS (aditiva: no cambia ni un dato existente),
 * sus guardas (exige 0004 y 0007), su atomicidad, lo que el texto del archivo promete (aditiva, sin SECURITY
 * DEFINER, sin contraseñas, nadie borra en `public`...) y su reversión (un script aparte, destructivo, que deja el
 * catálogo como estaba antes).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

/** Contenido de las tablas de negocio (sin la columna que 0010 agrega): ni una fila puede cambiar. */
async function huellaDeDatos(c: pg.Client): Promise<Record<string, string>> {
  const { rows: tablas } = await c.query<{ t: string }>(
    `select c.relname as t from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname <> 'migracion' order by 1`,
  );
  const r: Record<string, string> = {};
  for (const { t } of tablas) {
    const sacar = t === "persona" ? " - 'usuario_auth_id'" : "";
    const { rows } = await c.query<{ h: string }>(
      `select coalesce(md5(string_agg((to_jsonb(x)${sacar})::text, '|' order by (to_jsonb(x)${sacar})::text)), '-') as h
       from ${t} x`,
    );
    r[t] = rows[0]?.h as string;
  }
  return r;
}

/** Datos de las migraciones anteriores, de todo tipo, para comprobar que la nueva no los toca. */
async function sembrarDatosPrevios(c: pg.Client): Promise<void> {
  const marca = await marcaPrincipal(c);
  for (const estado of ["ACTIVE", "PROVISIONING", "SUSPENDED"] as const) {
    const m = await crearMundoDeMarca(c, { marca, estado });
    await c.query(
      "insert into membresia (empresa_id, persona_id, rol) values ($1, $2, 'GERENTE')",
      [m.empresa, m.persona],
    );
    await c.query(
      "insert into auditoria_empresa (empresa_id, accion, entidad, entidad_id) values ($1, 'PRUEBA', 'x', 'y')",
      [m.empresa],
    );
  }
  await c.query(
    "insert into auditoria_plataforma (actor, accion, entidad, entidad_id) values ('sistema', 'PRUEBA', 'x', 'y')",
  );
}

/** Las líneas de cada categoría del catálogo que hay en `despues` y no en `antes`, y al revés. */
function diferencias(antes: Record<string, string[]>, despues: Record<string, string[]>) {
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

/** Lo que hay en el esquema `autenticacion` (nada, si no existe), como una lista de texto. */
async function huellaDelEsquema(c: pg.Client): Promise<string[]> {
  const { rows } = await c.query<{ x: string }>(
    `select format('%s:%s', n.nspname, coalesce(n.nspacl::text, '')) as x from pg_namespace n where n.nspname = 'autenticacion'
     union all
     select format('%s.%s:%s', n.nspname, c.relname, c.relkind) from pg_class c
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'autenticacion'
     union all
     select format('%s:%s', tablename, policyname) from pg_policies where schemaname = 'autenticacion'
     order by 1`,
  );
  return rows.map((r) => r.x);
}

describe.skipIf(base === null)(
  "autenticación: la migración 0010 sobre datos reales, sus guardas y su reversión",
  () => {
    const b = () => base as BaseDePruebas;

    async function conPrevias<T>(
      trabajo: (x: Awaited<ReturnType<typeof baseConMigraciones>>, con: string) => Promise<T>,
    ): Promise<T> {
      const previa = await baseConMigraciones(b(), await migracionesPrevias());
      const conAutenticacion = await carpetaConAutenticacion(true);
      try {
        return await trabajo(previa, conAutenticacion);
      } finally {
        await rm(conAutenticacion, { recursive: true, force: true });
        await previa.cerrar();
      }
    }

    // ===========================================================================================================
    // Aditiva
    // ===========================================================================================================
    it("sobre una base con datos no cambia NI UN dato existente; solo agrega objetos (ni una política vieja se modifica)", async () => {
      await conPrevias(async (previa, conAutenticacion) => {
        await sembrarDatosPrevios(previa.cliente);
        const datosAntes = await huellaDeDatos(previa.cliente);
        const catalogoAntes = await huellaDeCatalogo(previa.cliente);

        const r = await aplicarMigraciones(previa.aparte.base.dueno, conAutenticacion);
        expect(r.aplicadas).toEqual([await archivoDeAutenticacion()]);

        expect(await huellaDeDatos(previa.cliente)).toEqual(datosAntes);
        const { nuevas, perdidas } = diferencias(
          catalogoAntes,
          await huellaDeCatalogo(previa.cliente),
        );

        // Es ADITIVA de verdad: del catálogo anterior no se pierde ni una línea (ninguna política, función,
        // restricción ni privilegio cambia), salvo la ACL del esquema `public` si la hubiera. Solo se suma.
        for (const [categoria, lineas] of Object.entries(perdidas)) {
          expect(lineas, `${categoria}: líneas que se perdieron`).toEqual([]);
        }
        // Todo lo nuevo es de esta migración.
        const esDeAutenticacion = (linea: string) =>
          /usuario_auth|app_usuario_auth|app_persona_de_sesion|persona_validar_vinculo|persona_vinculo_inmutable|_sesion_leer|persona_invitado_vincular/.test(
            linea,
          );
        for (const [categoria, lineas] of Object.entries(nuevas)) {
          for (const linea of lineas) {
            expect(esDeAutenticacion(linea), `${categoria}: ${linea}`).toBe(true);
          }
        }
        // Las políticas de la sesión son las cuatro de lectura y la de vincular, y ninguna otra.
        expect((nuevas["politicas"] ?? []).map((l) => l.split(":")[0]).sort()).toEqual([
          "empresa.empresa_sesion_leer",
          "membresia.membresia_sesion_leer",
          "persona.persona_invitado_vincular",
          "persona.persona_sesion_leer",
          "tenant.tenant_sesion_leer",
        ]);

        // La columna nueva nace nula en todas las personas que ya estaban.
        const { rows } = await previa.cliente.query(
          "select count(*)::int as n from persona where usuario_auth_id is not null",
        );
        expect(rows).toEqual([{ n: 0 }]);
        // Y las tablas de la librería nacen vacías.
        for (const tabla of ['"user"', "session", "account", "verification", '"rateLimit"']) {
          const { rows: vacias } = await previa.cliente.query(
            `select 1 from autenticacion.${tabla}`,
          );
          expect(vacias, tabla).toEqual([]);
        }
      });
    });

    it("correr las migraciones de nuevo no cambia nada", async () => {
      await conPrevias(async (previa, conAutenticacion) => {
        await aplicarMigraciones(previa.aparte.base.dueno, conAutenticacion);
        const catalogo = await huellaDeCatalogo(previa.cliente);
        const esquema = await huellaDelEsquema(previa.cliente);
        const otra = await aplicarMigraciones(previa.aparte.base.dueno, conAutenticacion);
        expect(otra).toEqual({
          aplicadas: [],
          yaAplicadas: [...(await migracionesPrevias()), await archivoDeAutenticacion()],
        });
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogo);
        expect(await huellaDelEsquema(previa.cliente)).toEqual(esquema);
      });
    });

    // ===========================================================================================================
    // Guardas y atomicidad
    // ===========================================================================================================
    it("exige 0004: sin el rol de la autenticación se frena con un mensaje claro y no deja nada", async () => {
      // Un clúster donde el rol no existe no se puede armar sin tocar el clúster entero; se prueba la guarda sobre
      // el texto real con el rol ausente, dentro de una transacción que se deshace (los roles son del clúster).
      const sql = await readFile(
        join(CARPETA_DE_MIGRACIONES, await archivoDeAutenticacion()),
        "utf8",
      );
      const c = new pg.Client({ connectionString: b().dueno });
      await c.connect();
      try {
        await c.query("begin");
        const { rows } = await c.query<{ existe: boolean }>(
          "select exists (select 1 from pg_roles where rolname = 'pedernal_autenticacion') as existe",
        );
        expect(rows[0]?.existe).toBe(true);
        // La guarda es el primer bloque: se corre contra una copia del texto que busca otro nombre de rol.
        const guarda = sql.match(/^DO \$\$[\s\S]*?^\$\$;/m)?.[0] ?? "";
        expect(guarda).toContain("pedernal_autenticacion");
        await expect(
          c.query(
            guarda.replace(
              "rolname = 'pedernal_autenticacion'",
              "rolname = 'pedernal_inexistente'",
            ),
          ),
        ).rejects.toThrow(/autenticación requiere 0004_plataforma aplicada antes/);
      } finally {
        await c.query("rollback").catch(() => undefined);
        await c.end();
      }
    });

    it("exige 0007: sin `tenant.marca_id` se frena con un mensaje claro y no deja nada", async () => {
      const hasta0006 = (await migracionesPrevias()).filter((n) => n < "0007");
      const previa = await baseConMigraciones(b(), hasta0006);
      const carpeta = await carpetaCon(hasta0006);
      try {
        const archivo = await archivoDeAutenticacion();
        await writeFile(
          join(carpeta, archivo),
          await readFile(join(CARPETA_DE_MIGRACIONES, archivo), "utf8"),
        );
        await expect(aplicarMigraciones(previa.aparte.base.dueno, carpeta)).rejects.toThrow(
          /autenticación requiere 0007_marcas_y_planes aplicada antes/,
        );
        expect(await huellaDelEsquema(previa.cliente)).toEqual([]);
        const { rows } = await previa.cliente.query<{ nombre: string }>(
          "select nombre from migracion order by nombre",
        );
        expect(rows.map((r) => r.nombre)).toEqual(hasta0006);
      } finally {
        await rm(carpeta, { recursive: true, force: true });
        await previa.cerrar();
      }
    });

    it("no adopta un esquema `autenticacion` que ya existe: se frena y no cambia nada", async () => {
      await conPrevias(async (previa, conAutenticacion) => {
        await previa.cliente.query("create schema autenticacion");
        const antes = await huellaDeCatalogo(previa.cliente);
        await expect(
          aplicarMigraciones(previa.aparte.base.dueno, conAutenticacion),
        ).rejects.toThrow(/el esquema autenticacion ya existe/);
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(antes);
        await previa.cliente.query("drop schema autenticacion");
      });
    });

    it("es atómica: si algo falla al final, no queda ninguna de sus tablas, funciones, políticas ni concesiones", async () => {
      await conPrevias(async (previa) => {
        await sembrarDatosPrevios(previa.cliente);
        const antes = await huellaDeCatalogo(previa.cliente);
        const datosAntes = await huellaDeDatos(previa.cliente);
        const rota = await carpetaCon(await migracionesPrevias());
        try {
          const archivo = await archivoDeAutenticacion();
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
        expect(await huellaDelEsquema(previa.cliente)).toEqual([]);
      });
    });

    // ===========================================================================================================
    // Lo que el texto del archivo promete
    // ===========================================================================================================
    describe("lo que el texto de la migración promete", () => {
      const leer = async () => {
        const completo = await readFile(
          join(CARPETA_DE_MIGRACIONES, await archivoDeAutenticacion()),
          "utf8",
        );
        // El código sin comentarios de línea: lo que promete la cabecera se comprueba sobre lo que se ejecuta.
        const codigo = completo.replace(/--.*$/gm, "");
        return { completo, codigo };
      };

      it("la cabecera declara lo que es: aditiva, sin SECURITY DEFINER nuevo, número provisorio, reversión destructiva", async () => {
        const { completo } = await leer();
        expect(completo).toMatch(/ADITIVA/);
        expect(completo).toMatch(/PROVISORIO/);
        expect(completo).toMatch(/0010_revertir_autenticacion\.sql/);
        expect(completo).toMatch(/DESTRUCTIVO/);
        expect(completo).toMatch(/No agrega NINGUNA función SECURITY DEFINER/);
      });

      it("no crea roles, ni da LOGIN ni contraseñas: el dueño las carga fuera del repositorio", async () => {
        const { codigo } = await leer();
        expect(codigo).not.toMatch(/\bCREATE\s+ROLE\b/i);
        expect(codigo).not.toMatch(/\bALTER\s+ROLE\b/i);
        expect(codigo).not.toMatch(/\bLOGIN\b/i);
        expect(codigo).not.toMatch(/\bPASSWORD\s+'/i);
        expect(codigo).not.toMatch(/postgres(ql)?:\/\//i);
      });

      it("no borra ni vacía nada: ningún DROP, TRUNCATE ni DELETE", async () => {
        const { codigo } = await leer();
        expect(codigo).not.toMatch(/\bDROP\b/i);
        expect(codigo).not.toMatch(/\bTRUNCATE\b/i);
        expect(codigo).not.toMatch(/\bDELETE\s+FROM\b/i);
        // Ninguna política existente se modifica: la migración solo suma.
        expect(codigo).not.toMatch(/\bALTER\s+POLICY\b/i);
      });

      it("ninguna función SECURITY DEFINER y todas fijan el search_path (con pg_temp al final), calificando sus tablas con `public.`", async () => {
        const { codigo } = await leer();
        expect(codigo).not.toMatch(/\bSECURITY\s+DEFINER\b/i);
        const funciones = codigo.match(/CREATE\s+FUNCTION[\s\S]*?\$\$;/gi) ?? [];
        expect(funciones).toHaveLength(3);
        for (const funcion of funciones) {
          expect(funcion).toMatch(/SET\s+search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/);
          expect(funcion).not.toMatch(
            /(?<!DISTINCT\s)\b(FROM|JOIN)\s+(?!public\.)(?!pg_)\w+\b(?!\s*\()/i,
          );
        }
      });

      it("las concesiones: nunca TRUNCATE, REFERENCES, TRIGGER ni ALL; DELETE solo en el esquema de la librería; UPDATE de `public` solo la columna del vínculo; EXECUTE solo a la aplicación", async () => {
        const { codigo } = await leer();
        const concesiones = codigo.match(/\bGRANT\b[^;]*;/gi) ?? [];
        expect(concesiones).toHaveLength(4);
        for (const concesion of concesiones) {
          expect(concesion, concesion).not.toMatch(/\b(TRUNCATE|REFERENCES|TRIGGER|ALL)\b/i);
          expect(concesion).not.toMatch(/\bTO\s+PUBLIC\b/i);
          if (/\bDELETE\b/i.test(concesion)) {
            expect(concesion).toMatch(/autenticacion\./);
            expect(concesion).toMatch(/TO\s+pedernal_autenticacion;$/);
          }
          if (/\bEXECUTE\b/i.test(concesion)) {
            expect(concesion).toMatch(/TO\s+pedernal_app;$/);
          }
          if (/\bON\s+persona\b/i.test(concesion)) {
            expect(concesion).toMatch(
              /UPDATE\s*\(usuario_auth_id\)\s+ON\s+persona\s+TO\s+pedernal_app;$/,
            );
          }
        }
        // Nada se concede sobre `public` al rol de la librería.
        for (const concesion of concesiones) {
          if (/pedernal_autenticacion/i.test(concesion)) {
            expect(concesion).toMatch(/autenticacion/);
            expect(concesion).not.toMatch(/\bpublic\b/);
          }
        }
      });

      it("ninguna política `FOR ALL`, ninguna restrictiva, y las de la sesión son solo SELECT", async () => {
        const { codigo } = await leer();
        expect(codigo).not.toMatch(/CREATE\s+POLICY[^;]*\bFOR\s+ALL\b/i);
        expect(codigo).not.toMatch(/AS\s+RESTRICTIVE/i);
        for (const politica of codigo.match(/CREATE\s+POLICY\s+\w*_sesion_leer[^;]*;/gi) ?? []) {
          expect(politica).toMatch(/FOR\s+SELECT\s+TO\s+pedernal_app\b/);
        }
        expect(codigo.match(/CREATE\s+POLICY\s+\w*_sesion_leer/gi)).toHaveLength(4);
      });
    });

    // ===========================================================================================================
    // La reversión
    // ===========================================================================================================
    describe("reversión", () => {
      const revertir = async (c: pg.Client, confirmar: boolean) => {
        const sql = await readFile(await archivoDeReversionDeAutenticacion(), "utf8");
        await c.query("begin");
        try {
          if (confirmar) await c.query("set local pedernal.confirmar_reversion = 'SI'");
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
        expect(aplicables).toContain(await archivoDeAutenticacion());
        expect(aplicables.filter((n) => n.includes("revertir"))).toEqual([]);
        const reversion = await readFile(await archivoDeReversionDeAutenticacion(), "utf8");
        expect(reversion).toMatch(/DESTRUCTIVA/);
        expect(reversion).toMatch(/PROVISORIO/);
        expect(reversion).not.toMatch(/PASSWORD\s+'/i);
        expect(reversion.replace(/--.*$/gm, "")).not.toMatch(/\bCASCADE\b/i);
      });

      it("sin datos no pide confirmación; deja el catálogo y los datos como antes, y la migración se puede aplicar de nuevo con el mismo resultado", async () => {
        await conPrevias(async (previa, conAutenticacion) => {
          await sembrarDatosPrevios(previa.cliente);
          const catalogoAntes = await huellaDeCatalogo(previa.cliente);
          const datosAntes = await huellaDeDatos(previa.cliente);
          await aplicarMigraciones(previa.aparte.base.dueno, conAutenticacion);
          expect(await huellaDeCatalogo(previa.cliente)).not.toEqual(catalogoAntes);
          const aplicada = await huellaDeCatalogo(previa.cliente);
          const esquemaAplicado = await huellaDelEsquema(previa.cliente);

          await revertir(previa.cliente, false);
          expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogoAntes);
          expect(await huellaDeDatos(previa.cliente)).toEqual(datosAntes);
          expect(await huellaDelEsquema(previa.cliente)).toEqual([]);
          expect(
            (
              await previa.cliente.query(
                "select nombre from migracion where nombre like '%\\_autenticacion.sql'",
              )
            ).rows,
          ).toEqual([]);

          // y vuelve a aplicarse, dejando lo mismo que la primera vez
          const otra = await aplicarMigraciones(previa.aparte.base.dueno, conAutenticacion);
          expect(otra.aplicadas).toEqual([await archivoDeAutenticacion()]);
          // Una columna borrada deja un hueco en la numeración de Postgres: la posición no cuenta.
          const sinPosicion = (h: Record<string, string[]>) => ({
            ...h,
            columnas: (h["columnas"] ?? []).map((l) => l.replace(/^([^:]+):\d+:/, "$1:")),
          });
          expect(sinPosicion(await huellaDeCatalogo(previa.cliente))).toEqual(
            sinPosicion(aplicada),
          );
          expect(await huellaDelEsquema(previa.cliente)).toEqual(esquemaAplicado);
        });
      });

      it("con usuarios, sesiones o vínculos pide confirmación expresa (y el rechazo no toca nada); confirmada, revierte", async () => {
        await conPrevias(async (previa, conAutenticacion) => {
          const catalogoAntes = await huellaDeCatalogo(previa.cliente);
          await aplicarMigraciones(previa.aparte.base.dueno, conAutenticacion);
          const p = await personaConUsuario(previa.cliente);
          await empresaConMiembro(previa.cliente, p, {
            marca: await marcaPrincipal(previa.cliente),
          });
          await previa.cliente.query(
            `insert into autenticacion.session ("expiresAt", token, "userId", host)
             values (now() + interval '1 hour', 't', $1, 'app.pedernal.test')`,
            [p.usuario],
          );
          await expect(revertir(previa.cliente, false)).rejects.toThrow(
            /pedernal\.confirmar_reversion/,
          );
          // el rechazo no deshizo ni tocó nada (la reversión es una sola transacción)
          expect(
            (await previa.cliente.query("select count(*)::int as n from autenticacion.session"))
              .rows,
          ).toEqual([{ n: 1 }]);
          expect(
            (
              await previa.cliente.query("select usuario_auth_id from persona where id = $1", [
                p.persona,
              ])
            ).rows,
          ).toEqual([{ usuario_auth_id: p.usuario }]);
          await revertir(previa.cliente, true);
          expect(await huellaDelEsquema(previa.cliente)).toEqual([]);
          expect(await huellaDeCatalogo(previa.cliente)).toEqual(catalogoAntes);
          // La persona y sus membresías siguen: solo se fue el vínculo.
          expect(
            (
              await previa.cliente.query("select count(*)::int as n from persona where id = $1", [
                p.persona,
              ])
            ).rows,
          ).toEqual([{ n: 1 }]);
          expect(
            (
              await previa.cliente.query(
                "select count(*)::int as n from membresia where persona_id = $1",
                [p.persona],
              )
            ).rows,
          ).toEqual([{ n: 1 }]);
        });
      });

      it("con solo un usuario (sin sesiones ni vínculos) también pide confirmación", async () => {
        await conPrevias(async (previa, conAutenticacion) => {
          await aplicarMigraciones(previa.aparte.base.dueno, conAutenticacion);
          await crearUsuarioDeBase(previa.cliente);
          await expect(revertir(previa.cliente, false)).rejects.toThrow(
            /pedernal\.confirmar_reversion/,
          );
          await revertir(previa.cliente, true);
        });
      });

      it("necesita un rol que evada RLS: si no, rechaza (así no cuenta cero filas en silencio)", async () => {
        await conPrevias(async (previa, conAutenticacion) => {
          await aplicarMigraciones(previa.aparte.base.dueno, conAutenticacion);
          const sql = await readFile(await archivoDeReversionDeAutenticacion(), "utf8");
          const c = new pg.Client({ connectionString: previa.aparte.base.plataforma });
          await c.connect();
          try {
            await expect(c.query(sql)).rejects.toThrow(/evada RLS/);
          } finally {
            await c.end();
          }
        });
      });

      it("no borra el rol pedernal_autenticacion (es del clúster): lo deja como nació en 0004, sin acceso a nada", async () => {
        await conPrevias(async (previa, conAutenticacion) => {
          await aplicarMigraciones(previa.aparte.base.dueno, conAutenticacion);
          await revertir(previa.cliente, false);
          const { rows } = await previa.cliente.query<{
            existe: boolean;
            tablas: number;
            columnas: number;
          }>(
            `select exists (select 1 from pg_roles where rolname = 'pedernal_autenticacion') as existe,
                    (select count(*)::int from information_schema.table_privileges where grantee = 'pedernal_autenticacion') as tablas,
                    (select count(*)::int from information_schema.column_privileges where grantee = 'pedernal_autenticacion') as columnas`,
          );
          expect(rows).toEqual([{ existe: true, tablas: 0, columnas: 0 }]);
        });
      });
    });
  },
);
