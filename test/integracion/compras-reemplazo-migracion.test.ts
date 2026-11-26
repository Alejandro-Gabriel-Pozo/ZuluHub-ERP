import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { claveDeCompra, comprobanteDeBase, huellaAlAzar, proveedorDeBase } from "./compras-apoyo";
import { conectarDueno } from "./compras-devoluciones-apoyo";
import { acepta, check, clave, conAppDe, crearMundo, denegado, referencia } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import { esperarBloqueo } from "./sesiones";
import { numeroUnico } from "./unicos";

/**
 * La migración 0112 (compras, NOTAS-2: reemplazo de factura) contra una base real y con el rol de la aplicación bajo RLS forzada: la factura nueva apunta a la que reemplaza (`reemplaza_a_id`, con la empresa en la clave
 * foránea); solo una factura reemplaza y no a sí misma; la reemplazada tiene que estar ANULADA y ser del mismo proveedor, y se comprueba AL CONFIRMAR (en la misma transacción se anula la original y se inserta la nueva); un solo
 * reemplazo vigente por original (dos a la vez: uno gana); el número puede repetirse porque la anulada ya no cuenta como duplicado; el vínculo no se cambia después. La reversión y el reaplicar los prueba `compras-reversiones.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const b = (): BaseDePruebas => {
  if (base === null) throw new Error("sin base de pruebas");
  return base;
};

describe.skipIf(base === null)("0112 compras: reemplazo de factura contra una base real", () => {
  let dueno: pg.Client;
  beforeAll(async () => {
    dueno = await conectarDueno(b());
  });
  afterAll(async () => {
    await dueno.end();
  });

  /** Una empresa con proveedor y una factura de 1210 registrada (la que se va a reemplazar). */
  const escenario = async () => {
    const m = await crearMundo(dueno);
    const proveedor = await proveedorDeBase(dueno, m);
    const factura = await comprobanteDeBase(dueno, m, proveedor);
    return { m, proveedor, factura };
  };
  type E = Awaited<ReturnType<typeof escenario>>;

  /** El alta de una factura por SQL como la aplicación (con el rol real); `reemplazaA` la vincula con la que reemplaza. */
  const factura = (
    e: Pick<E, "m" | "proveedor">,
    reemplazaA: string | null,
    extra: Record<string, unknown> = {},
  ) => {
    const t: Record<string, unknown> = {
      id: randomUUID(),
      empresa_id: e.m.empresa,
      proveedor_id: e.proveedor,
      clase: "FACTURA",
      reemplaza_a_id: reemplazaA,
      tipo: "FACTURA_A",
      punto_de_venta: 1,
      numero: numeroUnico(),
      fecha_del_comprobante: "2026-11-10",
      neto_gravado: "1000.00",
      no_gravado: 0,
      exento: 0,
      iva: "210.00",
      tributos_total: 0,
      credito_fiscal_computable: "210.00",
      total_calculado: "1210.00",
      total_segun_factura: "1210.00",
      proveedor_razon_social: "Proveedor Sur",
      nivel: "TRES_VIAS",
      clave_idempotencia: claveDeCompra(),
      huella: huellaAlAzar(),
      registrado_por: e.m.persona,
      ...extra,
    };
    const cols = Object.keys(t);
    return {
      id: t["id"] as string,
      texto: `insert into comprobante_de_proveedor (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
      parametros: Object.values(t),
    };
  };
  const anular = (id: string, persona: string) => ({
    texto:
      "update comprobante_de_proveedor set estado = 'ANULADO', anulado_por = $2, anulado_en = now(), motivo_de_anulacion = 'Reemplazada' where id = $1",
    parametros: [id, persona],
  });
  /** Anula la original y registra la nueva que la reemplaza, en UNA transacción, como lo hará el caso de uso. */
  const reemplazar = async (e: E, original: string, extra: Record<string, unknown> = {}) =>
    conAppDe(b(), e.m, async (s) => {
      const a = anular(original, e.m.persona);
      acepta(await s.intentar(a.texto, a.parametros));
      const n = factura(e, original, extra);
      acepta(await s.intentar(n.texto, n.parametros));
      expect((await s.confirmar()).ok).toBe(true);
      return n.id;
    });
  const vinculo = async (id: string) =>
    (
      await dueno.query<{ reemplaza_a_id: string | null }>(
        "select reemplaza_a_id from comprobante_de_proveedor where id = $1",
        [id],
      )
    ).rows[0]?.reemplaza_a_id;

  it("la columna es nullable, de la propia empresa (clave foránea compuesta) y la restricción de forma está", async () => {
    const col = await dueno.query<{ is_nullable: string }>(
      "select is_nullable from information_schema.columns where table_name = 'comprobante_de_proveedor' and column_name = 'reemplaza_a_id'",
    );
    expect(col.rows).toEqual([{ is_nullable: "YES" }]);
    const fk = await dueno.query<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'cp_reemplaza_fkey'",
    );
    expect(fk.rows[0]?.def).toContain("(reemplaza_a_id, empresa_id)");
    expect(fk.rows[0]?.def).toContain("REFERENCES comprobante_de_proveedor(id, empresa_id)");
    const ck = await dueno.query("select 1 from pg_constraint where conname = 'cp_reemplaza_ck'");
    expect(ck.rowCount).toBe(1);
  });

  it("anular la original y registrar la nueva en una transacción confirma, también con el MISMO número (la anulada ya no cuenta como duplicado)", async () => {
    const e = await escenario();
    const original = (
      await dueno.query<{ numero: number; tipo: string; punto_de_venta: number }>(
        "select numero, tipo, punto_de_venta from comprobante_de_proveedor where id = $1",
        [e.factura],
      )
    ).rows[0];
    const nueva = await reemplazar(e, e.factura, {
      tipo: original?.tipo,
      punto_de_venta: original?.punto_de_venta,
      numero: original?.numero,
    });
    expect(await vinculo(nueva)).toBe(e.factura);
    const otra = await escenario();
    const distinta = await reemplazar(otra, otra.factura);
    expect(await vinculo(distinta)).toBe(otra.factura);
  });

  it("sin anular la original, la nueva falla AL CONFIRMAR y no queda nada; con otro proveedor también", async () => {
    const e = await escenario();
    await conAppDe(b(), e.m, async (s) => {
      const n = factura(e, e.factura);
      acepta(await s.intentar(n.texto, n.parametros));
      check(await s.confirmar(), "reemplazo_de_factura_no_anulada");
    });
    const huerfanas = await dueno.query(
      "select 1 from comprobante_de_proveedor where reemplaza_a_id = $1",
      [e.factura],
    );
    expect(huerfanas.rowCount).toBe(0);
    const otroProveedor = await proveedorDeBase(dueno, e.m, "Otro proveedor");
    await conAppDe(b(), e.m, async (s) => {
      const a = anular(e.factura, e.m.persona);
      acepta(await s.intentar(a.texto, a.parametros));
      const n = factura({ m: e.m, proveedor: otroProveedor }, e.factura);
      acepta(await s.intentar(n.texto, n.parametros));
      check(await s.confirmar(), "reemplazo_de_otro_proveedor");
    });
    // La transacción fallida deshizo la anulación: la original sigue registrada.
    const estado = await dueno.query<{ estado: string }>(
      "select estado from comprobante_de_proveedor where id = $1",
      [e.factura],
    );
    expect(estado.rows[0]?.estado).toBe("REGISTRADO");
  });

  it("solo una factura reemplaza (no una nota) y no a sí misma", async () => {
    const e = await escenario();
    await conAppDe(b(), e.m, async (s) => {
      const nota = factura(e, e.factura, { clase: "NOTA_DE_DEBITO", tipo: "NOTA_DEBITO_A" });
      check(await s.intentar(nota.texto, nota.parametros), "cp_reemplaza_ck");
    });
    await conAppDe(b(), e.m, async (s) => {
      const id = randomUUID();
      const propia = factura(e, id, { id });
      check(await s.intentar(propia.texto, propia.parametros), "cp_reemplaza_ck");
    });
  });

  it("la reemplazada tiene que ser una factura de la empresa: el id de otra empresa o inexistente se rechaza (clave foránea compuesta)", async () => {
    const e = await escenario();
    const ajena = await escenario();
    for (const original of [randomUUID(), ajena.factura]) {
      await conAppDe(b(), e.m, async (s) => {
        const n = factura(e, original);
        referencia(await s.intentar(n.texto, n.parametros), "cp_reemplaza_fkey");
      });
    }
  });

  it("un solo reemplazo vigente por original (23505); anulado el reemplazo, se puede volver a reemplazar (cadena A→B→C)", async () => {
    const e = await escenario();
    const b1 = await reemplazar(e, e.factura);
    await conAppDe(b(), e.m, async (s) => {
      const segundo = factura(e, e.factura);
      clave(await s.intentar(segundo.texto, segundo.parametros), "cp_reemplazo_vigente_uk");
    });
    // B (la nueva) se anula y C la reemplaza: la cadena entra.
    const c1 = await reemplazar(e, b1);
    expect(await vinculo(c1)).toBe(b1);
  });

  it("dos reemplazos de la misma original a la vez: uno gana y el otro falla en el índice (en cualquier orden de llegada)", async () => {
    const e = await escenario();
    await dueno.query(
      "update comprobante_de_proveedor set estado = 'ANULADO', anulado_por = $2, anulado_en = now(), motivo_de_anulacion = 'Reemplazada' where id = $1",
      [e.factura, e.m.persona],
    );
    let segundoFallo = false;
    await conAppDe(b(), e.m, async (s1) => {
      await conAppDe(b(), e.m, async (s2) => {
        const n1 = factura(e, e.factura);
        const n2 = factura(e, e.factura);
        acepta(await s1.intentar(n1.texto, n1.parametros));
        const segunda = s2.directo(n2.texto, n2.parametros);
        expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
        expect((await s1.confirmar()).ok).toBe(true);
        const r = await segunda;
        segundoFallo = !r.ok && r.restriccion === "cp_reemplazo_vigente_uk";
      });
    });
    expect(segundoFallo).toBe(true);
    const vigentes = await dueno.query(
      "select 1 from comprobante_de_proveedor where reemplaza_a_id = $1 and estado = 'REGISTRADO'",
      [e.factura],
    );
    expect(vigentes.rowCount).toBe(1);
  });

  it("el vínculo no se cambia después de registrada la factura", async () => {
    const e = await escenario();
    const nueva = await reemplazar(e, e.factura);
    await conAppDe(b(), e.m, async (s) => {
      denegado(
        await s.intentar(
          "update comprobante_de_proveedor set reemplaza_a_id = null where id = $1",
          [nueva],
        ),
      );
    });
    expect(await vinculo(nueva)).toBe(e.factura);
  });

  it("el código de la migración no usa SECURITY DEFINER, DELETE, TRUNCATE ni CASCADE y fija el search_path de su función", async () => {
    const codigo = (
      await readFile(
        join(import.meta.dirname, "../../migraciones", "0112_compras_reemplazo_de_factura.sql"),
        "utf8",
      )
    ).replace(/--.*$/gm, "");
    expect(codigo).not.toMatch(/SECURITY DEFINER/i);
    expect(codigo).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE\s+TABLE|CASCADE)\b/i);
    expect(codigo.match(/SET search_path = pg_catalog, public, pg_temp/g)).toHaveLength(1);
  });
});
