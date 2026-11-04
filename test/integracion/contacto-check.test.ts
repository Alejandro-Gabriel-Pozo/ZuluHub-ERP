import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { LARGO_MAXIMO_DEL_EMAIL_DE_CONTACTO } from "../../src/primitivas/contacto/email";
import { LARGO_MAXIMO_DEL_TELEFONO } from "../../src/primitivas/contacto/telefono";
import { esUnaLineaSinControl } from "../../src/primitivas/contacto/una-linea";
import {
  LARGO_MAXIMO_DE_LA_WEB,
  PATRON_DE_HOST_CON_BARRA,
  PATRON_DE_LA_WEB,
} from "../../src/primitivas/contacto/web";

/**
 * Los CHECK de contacto de la base (0019) repiten las reglas de `src/primitivas/contacto/`. Esta prueba lee sus definiciones del
 * CATÁLOGO de la base real y las compara con lo que exportan las primitivas: si alguien cambia un tope, el patrón de la web o la
 * regla de «sin control» de un lado y no del otro, falla. Previene: que el dominio acepte un dato que la base rechaza (un error
 * genérico al guardar) o que la base deje pasar lo que el dominio rechaza (un dato que se imprime en la factura sin pasar por la
 * regla). Sobre `comprobante` no hay CHECK de contacto a propósito (lo copia la base desde la sucursal, ya validado): la prueba
 * exige que siga sin haberlos.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("los CHECK de contacto de la base repiten las primitivas", () => {
  let c: pg.Client;
  beforeAll(async () => {
    if (base === null) return;
    c = new pg.Client({ connectionString: base.dueno });
    await c.connect();
  });
  afterAll(async () => {
    await c.end();
  });

  const definicion = async (nombre: string): Promise<string> => {
    const { rows } = await c.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = $1 and conrelid = 'public.sucursal'::regclass`,
      [nombre],
    );
    expect(rows, `falta el CHECK ${nombre}`).toHaveLength(1);
    return rows[0]?.def as string;
  };
  /** El tope «char_length(col) <= N» de la definición. */
  const topeDe = (def: string, columna: string): number => {
    const m = new RegExp(`char_length\\(${columna}\\) <= (\\d+)`).exec(def);
    expect(m, `${columna}: no tiene tope de largo en «${def}»`).not.toBeNull();
    return Number(m?.[1]);
  };
  /** El literal de la clase de control `'[\x01-\x1F\x7F-\x9F]'` que usa la definición con `!~`. */
  const claseDeControl = (def: string): string => {
    const m = /!~ '(\[[^']*\])'/.exec(def);
    expect(m, `sin la regla de «sin control» en «${def}»`).not.toBeNull();
    return m?.[1] as string;
  };

  it("el teléfono: tope de largo, mínimo de un carácter y recorte de extremos", async () => {
    const def = await definicion("sucursal_telefono_ck");
    expect(topeDe(def, "telefono")).toBe(LARGO_MAXIMO_DEL_TELEFONO);
    expect(def).toMatch(/char_length\(telefono\) >= 1/);
    expect(def).toMatch(/telefono = btrim\(telefono\)/);
  });

  it("el correo: tope de largo, minúsculas y recortado, y la forma «algo@algo» sin blancos", async () => {
    const def = await definicion("sucursal_correo_ck");
    expect(topeDe(def, "correo")).toBe(LARGO_MAXIMO_DEL_EMAIL_DE_CONTACTO);
    expect(def).toMatch(/correo = lower\(btrim\(correo\)\)/);
    expect(def).toContain("'^\\S+@\\S+$'");
  });

  it("la web: tope de largo y la MISMA forma canónica (sin esquema) y regla de la barra final que la primitiva", async () => {
    const def = await definicion("sucursal_web_ck");
    expect(topeDe(def, "web")).toBe(LARGO_MAXIMO_DE_LA_WEB);
    // Sin bandera `i`: la base exige el host en minúsculas con `~` (no `~*`), igual que el patrón de la primitiva.
    expect(PATRON_DE_LA_WEB.flags).toBe("");
    expect(def).not.toContain("~*");
    expect(def).toContain(`~ '${PATRON_DE_LA_WEB.source}'`);
    expect(PATRON_DE_HOST_CON_BARRA.flags).toBe("");
    expect(def).toContain(`!~ '${PATRON_DE_HOST_CON_BARRA.source.replaceAll("\\/", "/")}'`);
  });

  it("«sin control»: la clase de la base y la regla de la primitiva coinciden en cada carácter hasta U+00FF y en los separadores de línea", async () => {
    const puntos = [...Array.from({ length: 0x100 }, (_, i) => i), 0x2028, 0x2029, 0xfeff];
    for (const columna of ["telefono", "correo", "web"]) {
      const clase = claseDeControl(await definicion(`sucursal_${columna}_ck`));
      for (const punto of puntos) {
        if (punto === 0) continue; // Postgres no admite NUL en un texto
        const { rows } = await c.query<{ ok: boolean }>("select (chr($1) !~ $2) as ok", [
          punto,
          clase,
        ]);
        expect(
          rows[0]?.ok,
          `${columna}: U+${punto.toString(16).padStart(4, "0")} (la base y la primitiva no coinciden)`,
        ).toBe(esUnaLineaSinControl(String.fromCodePoint(punto)));
      }
    }
  });

  it("no hay otros CHECK sobre el contacto: los tres de la sucursal y ninguno en el comprobante", async () => {
    const { rows } = await c.query<{ tabla: string; nombre: string }>(
      `select conrelid::regclass::text as tabla, conname as nombre from pg_constraint
        where contype = 'c' and connamespace = 'public'::regnamespace
          and conrelid in ('public.sucursal'::regclass, 'public.comprobante'::regclass)
          and pg_get_constraintdef(oid) ~ '\\m(telefono|correo|web|sucursal_telefono|sucursal_correo|sucursal_web)\\M'
        order by 1, 2`,
    );
    expect(rows).toEqual([
      { tabla: "sucursal", nombre: "sucursal_correo_ck" },
      { tabla: "sucursal", nombre: "sucursal_telefono_ck" },
      { tabla: "sucursal", nombre: "sucursal_web_ck" },
    ]);
  });
});
