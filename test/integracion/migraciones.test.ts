import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, inject, it } from "vitest";
import { ErrorDeMigracion, aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { crearBaseAparte } from "./entorno";

const base = inject("baseDePruebas");
const CARPETA_REAL = join(import.meta.dirname, "../../migraciones");

async function carpetaTemporal(archivos: Record<string, string>): Promise<string> {
  const carpeta = await mkdtemp(join(tmpdir(), "zuluhub-mig-"));
  for (const [nombre, contenido] of Object.entries(archivos)) {
    await writeFile(join(carpeta, nombre), contenido);
  }
  return carpeta;
}

describe.skipIf(base === null)("migraciones", () => {
  it("sobre una base limpia crean todo, y correrlas de nuevo no cambia nada", async () => {
    if (base === null) return;
    const aparte = await crearBaseAparte(base, { migrar: false });
    try {
      const primera = await aplicarMigraciones(aparte.base.dueno, CARPETA_REAL);
      expect(primera.aplicadas).toEqual(["0001_base.sql"]);
      const segunda = await aplicarMigraciones(aparte.base.dueno, CARPETA_REAL);
      expect(segunda).toEqual({ aplicadas: [], yaAplicadas: ["0001_base.sql"] });
    } finally {
      await aparte.destruir();
    }
  });

  it("los roles existen con los privilegios esperados después de migrar una base limpia", async () => {
    if (base === null) return;
    const aparte = await crearBaseAparte(base);
    const cliente = new pg.Client({ connectionString: aparte.base.dueno });
    await cliente.connect();
    try {
      const { rows } = await cliente.query<{
        rolname: string;
        rolbypassrls: boolean;
        rolsuper: boolean;
      }>(
        `select rolname, rolbypassrls, rolsuper from pg_roles where rolname like 'zuluhub\\_%' escape '\\' order by rolname`,
      );
      expect(rows.map((r) => r.rolname)).toEqual([
        "zuluhub_app",
        "zuluhub_grupo",
        "zuluhub_plataforma",
        "zuluhub_trabajos",
      ]);
      expect(rows.every((r) => !r.rolbypassrls && !r.rolsuper)).toBe(true);
      const { rows: puede } = await cliente.query<{ ok: boolean }>(
        "select has_table_privilege('zuluhub_app', 'public.sucursal', 'INSERT') as ok",
      );
      expect(puede[0]?.ok).toBe(true);
    } finally {
      await cliente.end();
      await aparte.destruir();
    }
  });

  it("una migración ya aplicada que se editó rompe: el historial no se reescribe", async () => {
    if (base === null) return;
    const aparte = await crearBaseAparte(base, { migrar: false });
    const carpeta = await carpetaTemporal({ "0001_uno.sql": "create table uno (id int);" });
    try {
      await aplicarMigraciones(aparte.base.dueno, carpeta);
      await writeFile(join(carpeta, "0001_uno.sql"), "create table uno (id int, extra int);");
      await expect(aplicarMigraciones(aparte.base.dueno, carpeta)).rejects.toThrow(
        ErrorDeMigracion,
      );
      await expect(aplicarMigraciones(aparte.base.dueno, carpeta)).rejects.toThrow(
        /ya se aplicó y fue editada/,
      );
    } finally {
      await rm(carpeta, { recursive: true, force: true });
      await aparte.destruir();
    }
  });

  it("una migración que falla se revierte entera y no queda registrada; las anteriores sí", async () => {
    if (base === null) return;
    const aparte = await crearBaseAparte(base, { migrar: false });
    const carpeta = await carpetaTemporal({
      "0001_ok.sql": "create table ok_1 (id int);",
      "0002_rota.sql": "create table rota_1 (id int); select 1/0;",
    });
    const cliente = new pg.Client({ connectionString: aparte.base.dueno });
    await cliente.connect();
    try {
      await expect(aplicarMigraciones(aparte.base.dueno, carpeta)).rejects.toMatchObject({
        code: "22012",
      });
      const tablas = await cliente.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' order by 1",
      );
      expect(tablas.rows.map((t) => t.table_name)).toEqual(["migracion", "ok_1"]);
      const registro = await cliente.query<{ nombre: string }>("select nombre from migracion");
      expect(registro.rows.map((r) => r.nombre)).toEqual(["0001_ok.sql"]);
    } finally {
      await cliente.end();
      await rm(carpeta, { recursive: true, force: true });
      await aparte.destruir();
    }
  });

  it("dos migraciones con el mismo número se rechazan antes de tocar la base", async () => {
    if (base === null) return;
    const carpeta = await carpetaTemporal({ "0001_a.sql": "select 1;", "0001_b.sql": "select 2;" });
    try {
      await expect(aplicarMigraciones(base.dueno, carpeta)).rejects.toThrow(/mismo número/);
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  });

  it("dos ejecuciones simultáneas no se pisan: se aplica una sola vez", async () => {
    if (base === null) return;
    const aparte = await crearBaseAparte(base, { migrar: false });
    try {
      const [x, y] = await Promise.all([
        aplicarMigraciones(aparte.base.dueno, CARPETA_REAL),
        aplicarMigraciones(aparte.base.dueno, CARPETA_REAL),
      ]);
      expect([x.aplicadas.length, y.aplicadas.length].sort()).toEqual([0, 1]);
    } finally {
      await aparte.destruir();
    }
  });

  it("la migración no contiene contraseñas ni cadenas de conexión", async () => {
    const sql = await readFile(join(CARPETA_REAL, "0001_base.sql"), "utf8");
    expect(sql).not.toMatch(/PASSWORD\s+'/i);
    expect(sql).not.toMatch(/postgres(ql)?:\/\//i);
  });
});
