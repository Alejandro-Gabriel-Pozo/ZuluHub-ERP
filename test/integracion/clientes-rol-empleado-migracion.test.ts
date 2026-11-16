import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { ROLES_DE_PARTE } from "../../src/modulos/clientes/dominio/roles";
import { acepta, clave, conAppDe, crearMundo, denegado, type Mundo } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import { baseConMigraciones, CARPETA_DE_MIGRACIONES, huellaDeCatalogo } from "./marcas-apoyo";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";

/**
 * La migración 0070 (LB-6: el rol EMPLEADO como parte) contra una base real: siembra UNA fila en `rol_de_parte` y nada más; el vocabulario sigue de solo
 * inserción y la aplicación sigue sin poder escribirlo; un rol repetido se rechaza; una parte puede tener el rol y cada empresa ve solo lo suyo; la
 * migración se aplica una sola vez y se frena si el rol ya estaba; la reversión quita la fila, se frena si hay partes con el rol y deja el disparador encendido.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const ARCHIVO = "0070_rol_de_parte_empleado.sql";
const REVERSION = join(
  CARPETA_DE_MIGRACIONES,
  "reversiones",
  "0070_revertir_rol_de_parte_empleado.sql",
);
const b = (): BaseDePruebas => {
  if (base === null) throw new Error("sin base de pruebas");
  return base;
};

type Fila = { n: number };
type FilaDeRol = { codigo: string; descripcion: string };

const codigos = async (c: pg.Client): Promise<string[]> =>
  (await c.query<{ codigo: string }>("select codigo from rol_de_parte order by codigo")).rows.map(
    (r) => r.codigo,
  );

async function parteConRol(c: pg.Client, m: Mundo, rol: string): Promise<string> {
  const id = (
    await c.query<{ id: string }>(
      `insert into parte (empresa_id, idempotencia_alta, naturaleza, nombre, creado_por)
       values ($1, $2, 'HUMANA', 'Persona del personal', $3) returning id`,
      [m.empresa, randomUUID(), m.persona],
    )
  ).rows[0]?.id as string;
  await c.query("insert into parte_rol (empresa_id, parte_id, rol) values ($1, $2, $3)", [
    m.empresa,
    id,
    rol,
  ]);
  return id;
}

describe.skipIf(base === null)("0070 rol EMPLEADO: la migración contra una base real", () => {
  let dueno: pg.Client;
  beforeAll(async () => {
    dueno = new pg.Client({ connectionString: b().dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
  });

  describe("el vocabulario", () => {
    it("tiene los tres roles y son los mismos que declara el código", async () => {
      expect(await codigos(dueno)).toEqual([...ROLES_DE_PARTE].sort());
      expect(await codigos(dueno)).toEqual(["CUSTOMER", "EMPLEADO", "PROVEEDOR"]);
    });

    it("sigue de solo inserción: ni el dueño cambia ni borra el rol nuevo, y la aplicación no escribe el vocabulario", async () => {
      await expect(
        dueno.query("update rol_de_parte set descripcion = 'x' where codigo = 'EMPLEADO'"),
      ).rejects.toThrow(/solo inserción/);
      await expect(
        dueno.query("delete from rol_de_parte where codigo = 'EMPLEADO'"),
      ).rejects.toThrow(/solo inserción/);
      await expect(dueno.query("truncate rol_de_parte")).rejects.toThrow();
      const m = await crearMundo(dueno);
      await conAppDe(b(), m, async (s) => {
        denegado(
          await s.intentar("insert into rol_de_parte (codigo, descripcion) values ('OTRO', 'x')"),
        );
        denegado(await s.intentar("update rol_de_parte set descripcion = 'x'"));
        denegado(await s.intentar("delete from rol_de_parte"));
        const r = await s.intentar("select count(*)::int as n from rol_de_parte");
        acepta(r);
        expect(r.ok && (r.rows[0] as Fila).n).toBe(3);
      });
    });

    it("rechaza un rol repetido (clave primaria) y un código que no cumple la forma", async () => {
      const c = new pg.Client({ connectionString: b().dueno });
      await c.connect();
      try {
        await c.query("begin");
        await c.query("savepoint a");
        await expect(
          c.query("insert into rol_de_parte (codigo, descripcion) values ('EMPLEADO', 'otra')"),
        ).rejects.toMatchObject({ code: "23505", constraint: "rol_de_parte_pkey" });
        await c.query("rollback to savepoint a");
        await expect(
          c.query("insert into rol_de_parte (codigo, descripcion) values ('empleado', 'x')"),
        ).rejects.toMatchObject({ code: "23514", constraint: "rol_de_parte_codigo_ck" });
        await c.query("rollback");
      } finally {
        await c.end();
      }
    });
  });

  describe("una parte con el rol, y el aislamiento entre empresas", () => {
    it("la aplicación da el rol a una parte de su empresa y la otra empresa no lo ve", async () => {
      const a = await crearMundo(dueno);
      const otra = await crearMundo(dueno);
      let parteId = "";
      await conAppDe(b(), a, async (s) => {
        const alta = await s.intentar(
          `insert into parte (empresa_id, idempotencia_alta, naturaleza, nombre, creado_por)
           values ($1, $2, 'HUMANA', 'Persona del personal', $3) returning id`,
          [a.empresa, randomUUID(), a.persona],
        );
        acepta(alta);
        parteId = alta.ok ? String((alta.rows[0] as { id: string }).id) : "";
        acepta(
          await s.intentar(
            "insert into parte_rol (empresa_id, parte_id, rol) values ($1, $2, 'EMPLEADO')",
            [a.empresa, parteId],
          ),
        );
        // El mismo rol dos veces en la misma parte: lo rechaza la clave primaria de parte_rol.
        clave(
          await s.intentar(
            "insert into parte_rol (empresa_id, parte_id, rol) values ($1, $2, 'EMPLEADO')",
            [a.empresa, parteId],
          ),
          "parte_rol_pkey",
        );
        const propio = await s.intentar(
          "select count(*)::int as n from parte_rol where rol = 'EMPLEADO'",
        );
        expect(propio.ok && (propio.rows[0] as Fila).n).toBe(1);
        const sinOtroRol = await s.intentar(
          "select count(*)::int as n from parte_rol where rol <> 'EMPLEADO'",
        );
        expect(sinOtroRol.ok && (sinOtroRol.rows[0] as Fila).n).toBe(0);
        acepta(await s.confirmar());
      });
      await conAppDe(b(), otra, async (s) => {
        const r = await s.intentar(
          "select count(*)::int as n from parte_rol where rol = 'EMPLEADO'",
        );
        expect(r.ok && (r.rows[0] as Fila).n).toBe(0);
        const p = await s.intentar("select count(*)::int as n from parte where id = $1", [parteId]);
        expect(p.ok && (p.rows[0] as Fila).n).toBe(0);
      });
    });
  });

  describe("la migración", () => {
    const todas = async () =>
      (await readdir(CARPETA_DE_MIGRACIONES))
        .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && n <= ARCHIVO)
        .sort();

    it("se aplica una sola vez: repetir el ejecutor no hace nada y el SQL a mano se frena porque el rol ya está", async () => {
      const previas = (await todas()).filter((n) => n < ARCHIVO);
      const previa = await baseConMigraciones(b(), previas);
      try {
        expect(await codigos(previa.cliente)).toEqual(["CUSTOMER", "PROVEEDOR"]);
        const carpeta = join(CARPETA_DE_MIGRACIONES);
        const primera = await aplicarMigraciones(previa.aparte.base.dueno, carpeta);
        expect(primera.aplicadas).toEqual([ARCHIVO]);
        expect(await codigos(previa.cliente)).toEqual(["CUSTOMER", "EMPLEADO", "PROVEEDOR"]);
        const segunda = await aplicarMigraciones(previa.aparte.base.dueno, carpeta);
        expect(segunda.aplicadas).toEqual([]);
        expect(segunda.yaAplicadas).toContain(ARCHIVO);
        expect(await codigos(previa.cliente)).toEqual(["CUSTOMER", "EMPLEADO", "PROVEEDOR"]);
        await expect(
          previa.cliente.query(await readFile(join(carpeta, ARCHIVO), "utf8")),
        ).rejects.toThrow(/ya existe/);
      } finally {
        await previa.cerrar();
      }
    });

    it("no toca nada más que esa fila: el esquema queda igual y las dos filas anteriores no cambian", async () => {
      const previas = (await todas()).filter((n) => n < ARCHIVO);
      const previa = await baseConMigraciones(b(), previas);
      try {
        const antes = await huellaDeCatalogo(previa.cliente);
        const filasAntes = (
          await previa.cliente.query<FilaDeRol>("select * from rol_de_parte order by codigo")
        ).rows;
        await aplicarMigraciones(previa.aparte.base.dueno, CARPETA_DE_MIGRACIONES);
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(antes);
        const filasDespues = (
          await previa.cliente.query<FilaDeRol>("select * from rol_de_parte order by codigo")
        ).rows;
        expect(filasDespues.filter((f) => f.codigo !== "EMPLEADO")).toEqual(filasAntes);
      } finally {
        await previa.cerrar();
      }
    });

    it("se frena con un error claro si falta 0034", async () => {
      const previa = await baseConMigraciones(b(), ["0001_base.sql"]);
      try {
        await expect(
          previa.cliente.query(await readFile(join(CARPETA_DE_MIGRACIONES, ARCHIVO), "utf8")),
        ).rejects.toThrow(/0070 necesita 0034/);
      } finally {
        await previa.cerrar();
      }
    });
  });

  describe("reversión", () => {
    async function conTodas<T>(
      trabajo: (previa: Awaited<ReturnType<typeof baseConMigraciones>>) => Promise<T>,
    ): Promise<T> {
      const previa = await baseConMigraciones(b(), await todasHasta());
      try {
        return await trabajo(previa);
      } finally {
        await previa.cerrar();
      }
    }
    const todasHasta = async () =>
      (await readdir(CARPETA_DE_MIGRACIONES))
        .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && n <= ARCHIVO)
        .sort();
    async function revertir(c: pg.Client): Promise<void> {
      const sql = await readFile(REVERSION, "utf8");
      await c.query("begin");
      try {
        await c.query(sql);
        await c.query("commit");
      } catch (error) {
        await c.query("rollback");
        throw error;
      }
    }
    const disparador = async (c: pg.Client) =>
      (
        await c.query<{ tgenabled: string }>(
          "select tgenabled from pg_trigger where tgrelid = 'public.rol_de_parte'::regclass and tgname = 'rol_de_parte_solo_insercion'",
        )
      ).rows.map((r) => r.tgenabled);

    it("sin partes con el rol: quita la fila, deja el disparador encendido, se puede repetir y la migración se vuelve a aplicar", async () => {
      await conTodas(async (previa) => {
        expect(await codigos(previa.cliente)).toContain("EMPLEADO");
        await revertir(previa.cliente);
        expect(await codigos(previa.cliente)).toEqual(["CUSTOMER", "PROVEEDOR"]);
        expect(await disparador(previa.cliente)).toEqual(["O"]);
        expect(
          (await previa.cliente.query("select 1 from migracion where nombre = $1", [ARCHIVO]))
            .rowCount,
        ).toBe(0);
        // El disparador sigue frenando: ni el dueño borra un rol que quedó.
        await expect(
          previa.cliente.query("delete from rol_de_parte where codigo = 'CUSTOMER'"),
        ).rejects.toThrow(/solo inserción/);
        await revertir(previa.cliente);
        expect(await codigos(previa.cliente)).toEqual(["CUSTOMER", "PROVEEDOR"]);
        const otra = await aplicarMigraciones(previa.aparte.base.dueno, CARPETA_DE_MIGRACIONES);
        expect(otra.aplicadas).toEqual([ARCHIVO]);
        expect(await codigos(previa.cliente)).toEqual(["CUSTOMER", "EMPLEADO", "PROVEEDOR"]);
      });
    });

    it("con una parte que tiene el rol (activo o apagado) se NIEGA sin borrar nada, y no hay confirmación que lo saltee", async () => {
      await conTodas(async (previa) => {
        await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
        const m = await crearMundo(previa.cliente);
        const id = await parteConRol(previa.cliente, m, "EMPLEADO");
        await expect(revertir(previa.cliente)).rejects.toThrow(/1 partes con el rol EMPLEADO/);
        await previa.cliente.query(
          "update parte_rol set activo = false where parte_id = $1 and rol = 'EMPLEADO'",
          [id],
        );
        const sql = await readFile(REVERSION, "utf8");
        await previa.cliente.query("begin");
        try {
          await previa.cliente.query("set local pedernal.confirmar_reversion = 'SI'");
          await expect(previa.cliente.query(sql)).rejects.toThrow(/partes con el rol EMPLEADO/);
        } finally {
          await previa.cliente.query("rollback");
        }
        expect(await codigos(previa.cliente)).toContain("EMPLEADO");
        expect(await disparador(previa.cliente)).toEqual(["O"]);
      });
    });

    it("necesita un rol que evada RLS: si no, rechaza", async () => {
      await conTodas(async (previa) => {
        const c = new pg.Client({ connectionString: previa.aparte.base.plataforma });
        await c.connect();
        try {
          await expect(c.query(await readFile(REVERSION, "utf8"))).rejects.toThrow(/evada RLS/);
        } finally {
          await c.end();
        }
        expect(await codigos(previa.cliente)).toContain("EMPLEADO");
      });
    });
  });
});
