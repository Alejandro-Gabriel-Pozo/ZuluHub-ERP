import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { mermaDesdeTexto } from "../../src/primitivas/cantidad/merma";
import { crearBaseAparte } from "./entorno";

/**
 * La merma de una receta tiene UNA regla en el código (`primitivas/cantidad/merma.ts`) y la base la repite en `componente_perdida_ck` (`0 <= perdida < 100`, `numeric(7,4)`). Esta prueba
 * falla si dejan de coincidir: todo lo que la primitiva acepta lo guarda la base, y todo lo que la base rechazaría por rango (100 o más, negativo) la primitiva ya lo rechaza. Lo que la
 * base redondea (`numeric(7,4)` con más de 4 decimales) o acepta con otra forma (`05`, `+5`, `5.`) la primitiva lo rechaza igual: la forma es más estricta, nunca más laxa.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("merma: la primitiva y componente_perdida_ck coinciden", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  }, 60_000);
  afterAll(async () => {
    if (base === null) return;
    await dueno.end();
    await propia.destruir();
  }, 60_000);

  /** ¿La base acepta ese valor en la columna de la merma? Se prueba con la restricción de verdad, en una tabla con la misma columna y la misma regla. */
  const laBaseLoAcepta = async (valor: string): Promise<boolean> => {
    const { rows } = await dueno.query<{ restriccion: string; tipo: string }>(
      `select pg_get_constraintdef(c.oid) as restriccion, format_type(a.atttypid, a.atttypmod) as tipo
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attname = 'perdida'
        where c.conname = 'componente_perdida_ck'`,
    );
    expect(rows[0]?.tipo).toBe("numeric(7,4)");
    expect(rows[0]?.restriccion).toBe(
      "CHECK (((perdida >= (0)::numeric) AND (perdida < (100)::numeric)))",
    );
    try {
      await dueno.query("begin");
      await dueno.query(
        "create temp table prueba_merma (perdida numeric(7,4) constraint componente_perdida_ck check (perdida >= 0 and perdida < 100)) on commit drop",
      );
      await dueno.query("insert into prueba_merma (perdida) values ($1::numeric)", [valor]);
      return true;
    } catch {
      return false;
    } finally {
      await dueno.query("rollback");
    }
  };

  it("la restricción de la base es la que la primitiva asume (0 <= merma < 100, numeric(7,4))", async () => {
    expect(await laBaseLoAcepta("0")).toBe(true);
    expect(await laBaseLoAcepta("99.9999")).toBe(true);
    expect(await laBaseLoAcepta("100")).toBe(false);
    expect(await laBaseLoAcepta("-0.0001")).toBe(false);
  });

  it.each(["0", "0.0001", "1", "10", "10.5", "50", "99", "99.9999", "10.5000"])(
    "«%s»: la primitiva la acepta y la base la guarda",
    async (valor) => {
      expect(mermaDesdeTexto(valor).ok).toBe(true);
      expect(await laBaseLoAcepta(valor)).toBe(true);
    },
  );

  it.each(["100", "100.0000", "101", "250", "-1", "-0.0001"])(
    "«%s»: la base la rechaza por rango y la primitiva también",
    async (valor) => {
      expect(await laBaseLoAcepta(valor)).toBe(false);
      expect(mermaDesdeTexto(valor).ok).toBe(false);
    },
  );

  it.each(["05", "+5", "5.", ".5", "1.23456", "1e1", " 5", "5 "])(
    "«%s»: la forma de la primitiva es más estricta que la base (la rechaza aunque la base la acepte o la redondee)",
    (valor) => {
      expect(mermaDesdeTexto(valor).ok).toBe(false);
    },
  );
});
