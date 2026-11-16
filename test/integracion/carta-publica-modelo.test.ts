import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import type { BaseDePruebas } from "./global";
import { cartaDeBase, empresaDeCarta, type EmpresaDeCarta } from "./carta-publica-apoyo";

/**
 * 0082 (el modelo con el que se dibuja cada carta: `LISTA` o `LIBRO`) contra una base real: nace en Lista, la lista de permitidos la impone la base, los permisos son por columna
 * (la aplicación actualiza y no inserta; el público solo lee), el disparador de versión sigue andando y la reversión frena si hay cartas en Libro.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const REVERSION = join(
  import.meta.dirname,
  "../../migraciones/reversiones/0082_revertir_carta_publica_modelo.sql",
);

/** Un error de SQL: el código de la falla y la restricción (o el texto, si no hay restricción). */
const falla = async (c: pg.Client, sql: string, p: unknown[] = []) => {
  await c.query("savepoint intento");
  try {
    await c.query(sql, p);
    await c.query("release savepoint intento");
    return null;
  } catch (e) {
    await c.query("rollback to savepoint intento");
    const err = e as { code?: string; constraint?: string };
    return `${err.code ?? "?"}:${err.constraint ?? ""}`;
  }
};

describe.skipIf(base === null)("migración 0082: modelo de la carta pública", () => {
  const entorno = crearEntornoDePrueba(base as BaseDePruebas, 6);
  let dueno: pg.Client;
  let a: EmpresaDeCarta;
  let b: EmpresaDeCarta;
  beforeAll(async () => {
    dueno = new pg.Client({ connectionString: (base as BaseDePruebas).dueno });
    await dueno.connect();
    a = await empresaDeCarta(entorno, dueno);
    b = await empresaDeCarta(entorno, dueno);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
  });

  it("una carta nueva nace en Lista y el modelo no admite nulo", async () => {
    const { id } = await cartaDeBase(dueno, a.empresa, a.s1);
    const { rows } = await dueno.query<{ modelo: string }>(
      "select modelo from carta_publica where id = $1",
      [id],
    );
    expect(rows[0]?.modelo).toBe("LISTA");
    await dueno.query("begin");
    expect(await falla(dueno, "update carta_publica set modelo = null where id = $1", [id])).toBe(
      "23502:",
    );
    await dueno.query("rollback");
  });

  it("solo LISTA y LIBRO: lo demás (otro modelo, vacío, minúsculas) lo rechaza la base", async () => {
    const { id } = await cartaDeBase(dueno, a.empresa, a.s2);
    await dueno.query("begin");
    for (const malo of ["CUADRICULA", "TABLERO", "", "libro", "LIBRO "]) {
      expect(
        await falla(dueno, "update carta_publica set modelo = $2 where id = $1", [id, malo]),
        malo,
      ).toBe("23514:carta_publica_modelo_ck");
    }
    expect(
      await falla(dueno, "update carta_publica set modelo = 'LIBRO' where id = $1", [id]),
    ).toBeNull();
    await dueno.query("rollback");
  });

  it("permisos por columna: la aplicación actualiza `modelo` pero no lo inserta; el público lo lee y nada más", async () => {
    const privilegio = async (rol: string, tipo: string) =>
      (
        await dueno.query<{ ok: boolean }>(
          "select has_column_privilege($1, 'carta_publica', 'modelo', $2) as ok",
          [rol, tipo],
        )
      ).rows[0]?.ok;
    expect(await privilegio("pedernal_app", "UPDATE")).toBe(true);
    expect(await privilegio("pedernal_app", "INSERT")).toBe(false);
    expect(await privilegio("pedernal_publico", "SELECT")).toBe(true);
    expect(await privilegio("pedernal_publico", "UPDATE")).toBe(false);
    expect(await privilegio("pedernal_publico", "INSERT")).toBe(false);
    for (const rol of ["pedernal_grupo", "pedernal_trabajos", "pedernal_captacion"]) {
      expect(await privilegio(rol, "UPDATE"), rol).toBe(false);
    }
  });

  it("cambiar el modelo sube la versión en uno (bloqueo optimista) y no cambia la identidad de la carta", async () => {
    const { id } = await cartaDeBase(dueno, b.empresa, b.s1);
    const antes = (
      await dueno.query<{ version: number }>("select version from carta_publica where id = $1", [
        id,
      ])
    ).rows[0]?.version as number;
    await dueno.query("update carta_publica set modelo = 'LIBRO' where id = $1", [id]);
    const despues = (
      await dueno.query<{ version: number; modelo: string }>(
        "select version, modelo from carta_publica where id = $1",
        [id],
      )
    ).rows[0];
    expect(despues).toEqual({ version: antes + 1, modelo: "LIBRO" });
  });

  describe("la reversión", () => {
    it("frena con cartas en Libro salvo confirmación, quita la columna, se puede repetir y borra su fila del registro", async () => {
      const otra = await crearBaseAparte(base as BaseDePruebas);
      const c = new pg.Client({ connectionString: otra.base.dueno });
      await c.connect();
      try {
        const sql = await readFile(REVERSION, "utf8");
        const correr = async (confirmar = false) => {
          await c.query("begin");
          try {
            if (confirmar) await c.query("set local pedernal.confirmar_reversion = 'SI'");
            await c.query(sql);
            await c.query("commit");
          } catch (e) {
            await c.query("rollback");
            throw e;
          }
        };
        const entorno2 = crearEntornoDePrueba(otra.base, 3);
        const e2 = await empresaDeCarta(entorno2, c);
        await entorno2.cerrar();
        const { id } = await cartaDeBase(c, e2.empresa, e2.s1);
        // Con la carta en Lista (lo que ya es sin la columna): se aplica sin confirmar.
        await c.query("update carta_publica set modelo = 'LIBRO' where id = $1", [id]);
        await expect(correr()).rejects.toMatchObject({ code: "55000" });
        expect(
          (
            await c.query<{ modelo: string }>("select modelo from carta_publica where id = $1", [
              id,
            ])
          ).rows[0]?.modelo,
        ).toBe("LIBRO");
        await c.query("update carta_publica set modelo = 'LISTA' where id = $1", [id]);
        await correr();
        await correr();
        expect(
          (
            await c.query(
              "select 1 from information_schema.columns where table_name = 'carta_publica' and column_name = 'modelo'",
            )
          ).rowCount,
        ).toBe(0);
        expect(
          (await c.query("select 1 from migracion where nombre = '0082_carta_publica_modelo.sql'"))
            .rowCount,
        ).toBe(0);
        expect((await c.query("select 1 from carta_publica")).rowCount).toBe(1);
      } finally {
        await c.end();
        await otra.destruir();
      }
    });
  });
});
