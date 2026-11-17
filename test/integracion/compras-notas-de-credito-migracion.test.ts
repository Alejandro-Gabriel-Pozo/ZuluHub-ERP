import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { claveDeCompra, comprobanteDeBase, huellaAlAzar, proveedorDeBase } from "./compras-apoyo";
import { conectarDueno } from "./compras-devoluciones-apoyo";
import { acepta, check, conAppDe, crearMundo, denegado } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import { esperarBloqueo } from "./sesiones";
import { numeroUnico } from "./unicos";

/**
 * La migración 0085 (compras N4, nota de crédito del proveedor sin saldo) contra una base real: la columna de la factura que corrige (obligatoria solo para la nota, con clave foránea compuesta), el alta
 * de la nota (de una factura de la empresa, registrada, del mismo proveedor, sin pasarse del total), el tope con dos notas a la vez, anular una nota que libera el tope, que una factura con notas vigentes
 * no se anula (también con una nota y la anulación a la vez, en los dos sentidos) y el aislamiento entre empresas. La reversión y el reaplicar los prueba `compras-reversiones.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const b = (): BaseDePruebas => {
  if (base === null) throw new Error("sin base de pruebas");
  return base;
};

describe.skipIf(base === null)("0085 compras N4: notas de crédito contra una base real", () => {
  let dueno: pg.Client;
  beforeAll(async () => {
    dueno = await conectarDueno(b());
  });
  afterAll(async () => {
    await dueno.end();
  });

  /** Una empresa con proveedor y una factura de 1210 registrada. */
  const escenario = async () => {
    const m = await crearMundo(dueno);
    const proveedor = await proveedorDeBase(dueno, m);
    const factura = await comprobanteDeBase(dueno, m, proveedor);
    return { m, proveedor, factura };
  };
  type E = Awaited<ReturnType<typeof escenario>>;

  /** El alta de una nota por SQL como la aplicación (con el rol real): total en una sola cifra (neto) para que cierre. */
  const nota = (
    e: Pick<E, "m" | "proveedor">,
    asociado: string | null,
    total: string,
    extra: Record<string, unknown> = {},
  ) => {
    const t: Record<string, unknown> = {
      id: randomUUID(),
      empresa_id: e.m.empresa,
      proveedor_id: e.proveedor,
      clase: "NOTA_DE_CREDITO",
      comprobante_asociado_id: asociado,
      tipo: "NOTA_CREDITO_A",
      punto_de_venta: 1,
      numero: numeroUnico(),
      fecha_del_comprobante: "2026-11-10",
      neto_gravado: total,
      no_gravado: 0,
      exento: 0,
      iva: 0,
      tributos_total: 0,
      credito_fiscal_computable: 0,
      total_calculado: total,
      total_segun_factura: total,
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
  const anularComprobante = (id: string, persona: string) => ({
    texto:
      "update comprobante_de_proveedor set estado = 'ANULADO', anulado_por = $2, anulado_en = now(), motivo_de_anulacion = 'Se cargó mal' where id = $1",
    parametros: [id, persona],
  });
  const cargar = async (e: E, total: string) =>
    conAppDe(b(), e.m, async (s) => {
      const n = nota(e, e.factura, total);
      acepta(await s.intentar(n.texto, n.parametros));
      expect((await s.confirmar()).ok).toBe(true);
      return n.id;
    });

  it("la columna es nullable y de la propia empresa (clave foránea compuesta), indexada, sin que nadie pueda cambiarla después", async () => {
    const col = await dueno.query<{ is_nullable: string }>(
      "select is_nullable from information_schema.columns where table_name = 'comprobante_de_proveedor' and column_name = 'comprobante_asociado_id'",
    );
    expect(col.rows).toEqual([{ is_nullable: "YES" }]);
    const fk = await dueno.query<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'cp_asociado_fkey'",
    );
    expect(fk.rows[0]?.def).toContain("(comprobante_asociado_id, empresa_id)");
    expect(fk.rows[0]?.def).toContain("REFERENCES comprobante_de_proveedor(id, empresa_id)");
    const ix = await dueno.query("select 1 from pg_indexes where indexname = 'cp_asociado_ix'");
    expect(ix.rowCount).toBe(1);
    const e = await escenario();
    const id = await cargar(e, "100");
    await conAppDe(b(), e.m, async (s) => {
      denegado(
        await s.intentar(
          "update comprobante_de_proveedor set comprobante_asociado_id = null where id = $1",
          [id],
        ),
      );
    });
  });

  it("la factura que corrige es obligatoria para una nota (el CHECK lo respalda) y se rechaza en cualquier otra clase", async () => {
    const e = await escenario();
    await conAppDe(b(), e.m, async (s) => {
      const sin = nota(e, null, "100");
      // El disparador (antes que el CHECK) la rechaza con su nombre: una nota sin factura no existe.
      check(await s.intentar(sin.texto, sin.parametros), "nota_de_credito_sin_factura");
    });
    await conAppDe(b(), e.m, async (s) => {
      const factura = nota(e, e.factura, "100", {
        clase: "FACTURA",
        tipo: "FACTURA_A",
      });
      check(await s.intentar(factura.texto, factura.parametros), "cp_asociado_ck");
    });
  });

  it("la nota corrige una factura de la empresa, registrada y del mismo proveedor", async () => {
    const e = await escenario();
    const otroProveedor = await proveedorDeBase(dueno, e.m, "Otro proveedor");
    const anulada = await comprobanteDeBase(dueno, e.m, e.proveedor);
    await dueno.query(
      "update comprobante_de_proveedor set estado = 'ANULADO', anulado_por = $2, anulado_en = now(), motivo_de_anulacion = 'Mal cargada' where id = $1",
      [anulada, e.m.persona],
    );
    const unaNota = await cargar(e, "100");
    const ajena = await escenario();
    await conAppDe(b(), e.m, async (s) => {
      const intentos: [string, string][] = [
        [e.factura, "ok"],
        [anulada, "nota_de_credito_de_factura_anulada"],
        [unaNota, "nota_de_credito_sin_factura"],
        [randomUUID(), "nota_de_credito_sin_factura"],
        [ajena.factura, "nota_de_credito_sin_factura"],
      ];
      for (const [factura, esperado] of intentos) {
        if (esperado === "ok") continue;
        const n = nota(e, factura, "10");
        check(await s.intentar(n.texto, n.parametros), esperado);
      }
      const deOtroProveedor = nota({ m: e.m, proveedor: otroProveedor }, e.factura, "10");
      check(
        await s.intentar(deOtroProveedor.texto, deOtroProveedor.parametros),
        "nota_de_credito_de_otro_proveedor",
      );
      const buena = nota(e, e.factura, "10");
      acepta(await s.intentar(buena.texto, buena.parametros));
    });
  });

  it("el tope: lo acreditado vigente no pasa del total de la factura; anular una nota lo libera", async () => {
    const e = await escenario();
    const primera = await cargar(e, "1000");
    await cargar(e, "210");
    await conAppDe(b(), e.m, async (s) => {
      const demas = nota(e, e.factura, "0.01");
      check(await s.intentar(demas.texto, demas.parametros), "nota_de_credito_excede_la_factura");
    });
    await conAppDe(b(), e.m, async (s) => {
      const a = anularComprobante(primera, e.m.persona);
      acepta(await s.intentar(a.texto, a.parametros));
      const otra = nota(e, e.factura, "1000");
      acepta(await s.intentar(otra.texto, otra.parametros));
      const demas = nota(e, e.factura, "0.01");
      check(await s.intentar(demas.texto, demas.parametros), "nota_de_credito_excede_la_factura");
    });
  });

  it("dos notas a la vez sobre la misma factura que juntas se pasan: entra una sola", async () => {
    const e = await escenario();
    let n2Fallo = false;
    await conAppDe(b(), e.m, async (s1) => {
      await conAppDe(b(), e.m, async (s2) => {
        const n1 = nota(e, e.factura, "700");
        const n2 = nota(e, e.factura, "700");
        acepta(await s1.intentar(n1.texto, n1.parametros));
        const segunda = s2.directo(n2.texto, n2.parametros);
        expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
        expect((await s1.confirmar()).ok).toBe(true);
        const r = await segunda;
        n2Fallo = !r.ok && r.restriccion === "nota_de_credito_excede_la_factura";
      });
    });
    expect(n2Fallo).toBe(true);
    const acreditado = await dueno.query<{ s: string }>(
      "select sum(total_segun_factura)::text as s from comprobante_de_proveedor where comprobante_asociado_id = $1 and estado <> 'ANULADO'",
      [e.factura],
    );
    expect(acreditado.rows[0]?.s).toBe("700.00");
  });

  it("una factura con notas vigentes no se anula: primero se anulan las notas", async () => {
    const e = await escenario();
    const unaNota = await cargar(e, "100");
    await conAppDe(b(), e.m, async (s) => {
      const a = anularComprobante(e.factura, e.m.persona);
      check(await s.intentar(a.texto, a.parametros), "comprobante_con_nota_de_credito");
    });
    await conAppDe(b(), e.m, async (s) => {
      const n = anularComprobante(unaNota, e.m.persona);
      acepta(await s.intentar(n.texto, n.parametros));
      const a = anularComprobante(e.factura, e.m.persona);
      acepta(await s.intentar(a.texto, a.parametros));
    });
  });

  it("una nota y la anulación de su factura a la vez no dejan una nota vigente de una factura anulada (en los dos órdenes)", async () => {
    // Primero la nota (sin confirmar): la anulación espera y, al confirmarse la nota, la ve y se rechaza.
    const e = await escenario();
    let rechazada = false;
    await conAppDe(b(), e.m, async (s1) => {
      await conAppDe(b(), e.m, async (s2) => {
        const n = nota(e, e.factura, "100");
        acepta(await s1.intentar(n.texto, n.parametros));
        const a = anularComprobante(e.factura, e.m.persona);
        const anulacion = s2.directo(a.texto, a.parametros);
        expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
        expect((await s1.confirmar()).ok).toBe(true);
        const r = await anulacion;
        rechazada = !r.ok && r.restriccion === "comprobante_con_nota_de_credito";
      });
    });
    expect(rechazada).toBe(true);
    // Primero la anulación (sin confirmar): la nota espera y, al confirmarse la anulación, ve la factura anulada y se rechaza.
    const f = await escenario();
    let notaRechazada = false;
    await conAppDe(b(), f.m, async (s1) => {
      await conAppDe(b(), f.m, async (s2) => {
        const a = anularComprobante(f.factura, f.m.persona);
        acepta(await s1.intentar(a.texto, a.parametros));
        const n = nota(f, f.factura, "100");
        const alta = s2.directo(n.texto, n.parametros);
        expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
        expect((await s1.confirmar()).ok).toBe(true);
        const r = await alta;
        notaRechazada = !r.ok && r.restriccion === "nota_de_credito_de_factura_anulada";
      });
    });
    expect(notaRechazada).toBe(true);
  });

  it("el código de la migración no usa SECURITY DEFINER, DELETE, TRUNCATE ni CASCADE", async () => {
    const codigo = (
      await readFile(
        join(import.meta.dirname, "../../migraciones", "0085_compras_notas_de_credito.sql"),
        "utf8",
      )
    ).replace(/--.*$/gm, "");
    expect(codigo).not.toMatch(/SECURITY DEFINER/i);
    expect(codigo).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE\s+TABLE|CASCADE)\b/i);
    expect(codigo).not.toMatch(/GRANT\s+(DELETE|TRUNCATE|ALL)\b/i);
    expect(codigo.match(/SET search_path = pg_catalog, public, pg_temp/g)).toHaveLength(2);
  });
});
