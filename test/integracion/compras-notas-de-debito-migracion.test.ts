import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { claveDeCompra, comprobanteDeBase, huellaAlAzar, proveedorDeBase } from "./compras-apoyo";
import { conectarDueno } from "./compras-devoluciones-apoyo";
import { acepta, check, conAppDe, crearMundo } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import { esperarBloqueo } from "./sesiones";
import { numeroUnico } from "./unicos";

/**
 * La migración 0111 (compras, NOTAS-1) contra una base real: la nota de débito se vincula a una factura (o no) y la nota de crédito sigue exigiendo la suya (`cp_asociado_ck`); la nota de débito vinculada
 * es de una factura de la empresa, registrada y del mismo proveedor, y no tiene tope; el tope de las notas de crédito cuenta SOLO notas de crédito (H-N1: una nota de débito vinculada no le quita tope); una
 * factura con una nota de débito vinculada vigente no se anula; y dos actores a la vez (anular la factura y cargar una nota de débito vinculada, en los dos órdenes; dos notas de débito) no dejan un estado
 * inválido. La reversión y el reaplicar los prueba `compras-reversiones.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const b = (): BaseDePruebas => {
  if (base === null) throw new Error("sin base de pruebas");
  return base;
};

describe.skipIf(base === null)(
  "0111 compras: notas de débito vinculadas contra una base real",
  () => {
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

    /** El alta de una nota (de crédito o de débito) por SQL como la aplicación (con el rol real): total en una sola cifra (neto) para que cierre. */
    const nota = (
      e: Pick<E, "m" | "proveedor">,
      clase: "NOTA_DE_CREDITO" | "NOTA_DE_DEBITO",
      asociado: string | null,
      total: string,
    ) => {
      const t: Record<string, unknown> = {
        id: randomUUID(),
        empresa_id: e.m.empresa,
        proveedor_id: e.proveedor,
        clase,
        comprobante_asociado_id: asociado,
        tipo: clase === "NOTA_DE_CREDITO" ? "NOTA_CREDITO_A" : "NOTA_DEBITO_A",
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
        "update comprobante_de_proveedor set estado = 'ANULADO', anulado_por = $2, anulado_en = now(), motivo_de_anulacion = 'Se cargó mal' where id = $1",
      parametros: [id, persona],
    });
    const cargar = async (
      e: E,
      clase: "NOTA_DE_CREDITO" | "NOTA_DE_DEBITO",
      asociado: string | null,
      total: string,
    ) =>
      conAppDe(b(), e.m, async (s) => {
        const n = nota(e, clase, asociado, total);
        acepta(await s.intentar(n.texto, n.parametros));
        expect((await s.confirmar()).ok).toBe(true);
        return n.id;
      });

    it("la nota de débito se vincula a una factura o no; la de crédito sigue exigiendo la suya; una factura no lleva vínculo", async () => {
      const e = await escenario();
      await cargar(e, "NOTA_DE_DEBITO", null, "50");
      await cargar(e, "NOTA_DE_DEBITO", e.factura, "50");
      await conAppDe(b(), e.m, async (s) => {
        const sin = nota(e, "NOTA_DE_CREDITO", null, "10");
        check(await s.intentar(sin.texto, sin.parametros), "nota_de_credito_sin_factura");
      });
      await conAppDe(b(), e.m, async (s) => {
        // Una factura con vínculo: la restricción del vínculo la rechaza.
        const factura = nota(e, "NOTA_DE_DEBITO", e.factura, "10");
        factura.parametros[3] = "FACTURA";
        factura.parametros[5] = "FACTURA_A";
        check(await s.intentar(factura.texto, factura.parametros), "cp_asociado_ck");
      });
    });

    it("la nota de débito vinculada es de una factura de la empresa, registrada y del mismo proveedor", async () => {
      const e = await escenario();
      const otroProveedor = await proveedorDeBase(dueno, e.m, "Otro proveedor");
      const anulada = await comprobanteDeBase(dueno, e.m, e.proveedor);
      await dueno.query(
        "update comprobante_de_proveedor set estado = 'ANULADO', anulado_por = $2, anulado_en = now(), motivo_de_anulacion = 'Mal cargada' where id = $1",
        [anulada, e.m.persona],
      );
      const unaNota = await cargar(e, "NOTA_DE_DEBITO", null, "10");
      const ajena = await escenario();
      await conAppDe(b(), e.m, async (s) => {
        const intentos: [string, string][] = [
          [anulada, "nota_de_debito_de_factura_anulada"],
          [unaNota, "nota_de_debito_sin_factura"],
          [randomUUID(), "nota_de_debito_sin_factura"],
          [ajena.factura, "nota_de_debito_sin_factura"],
        ];
        for (const [factura, esperado] of intentos) {
          const n = nota(e, "NOTA_DE_DEBITO", factura, "10");
          check(await s.intentar(n.texto, n.parametros), esperado);
        }
        const deOtro = nota(
          { m: e.m, proveedor: otroProveedor },
          "NOTA_DE_DEBITO",
          e.factura,
          "10",
        );
        check(
          await s.intentar(deOtro.texto, deOtro.parametros),
          "nota_de_debito_de_otro_proveedor",
        );
        const buena = nota(e, "NOTA_DE_DEBITO", e.factura, "10");
        acepta(await s.intentar(buena.texto, buena.parametros));
      });
    });

    it("H-N1: una nota de débito vinculada no tiene tope y NO le quita tope a las notas de crédito", async () => {
      const e = await escenario();
      // Mucho más que el total de la factura (1210): una nota de débito no «corrige» el total.
      await cargar(e, "NOTA_DE_DEBITO", e.factura, "5000");
      await cargar(e, "NOTA_DE_DEBITO", e.factura, "500");
      // Las notas de crédito tienen todo el tope: 1210 entra entero y un centavo más no.
      await cargar(e, "NOTA_DE_CREDITO", e.factura, "1210");
      await conAppDe(b(), e.m, async (s) => {
        const demas = nota(e, "NOTA_DE_CREDITO", e.factura, "0.01");
        check(await s.intentar(demas.texto, demas.parametros), "nota_de_credito_excede_la_factura");
      });
    });

    it("una factura con una nota de débito vinculada vigente no se anula; con la nota anulada, sí", async () => {
      const e = await escenario();
      const debito = await cargar(e, "NOTA_DE_DEBITO", e.factura, "100");
      await conAppDe(b(), e.m, async (s) => {
        const a = anular(e.factura, e.m.persona);
        check(await s.intentar(a.texto, a.parametros), "comprobante_con_nota_de_credito");
      });
      await conAppDe(b(), e.m, async (s) => {
        const n = anular(debito, e.m.persona);
        acepta(await s.intentar(n.texto, n.parametros));
        const a = anular(e.factura, e.m.persona);
        acepta(await s.intentar(a.texto, a.parametros));
      });
    });

    it("una nota de débito vinculada y la anulación de su factura a la vez (en los dos órdenes): o se anula la factura y la nota falla, o entra la nota y la anulación falla", async () => {
      // Primero la nota (sin confirmar): la anulación espera y, al confirmarse la nota, la ve y se rechaza.
      const e = await escenario();
      let rechazada = false;
      await conAppDe(b(), e.m, async (s1) => {
        await conAppDe(b(), e.m, async (s2) => {
          const n = nota(e, "NOTA_DE_DEBITO", e.factura, "100");
          acepta(await s1.intentar(n.texto, n.parametros));
          const a = anular(e.factura, e.m.persona);
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
          const a = anular(f.factura, f.m.persona);
          acepta(await s1.intentar(a.texto, a.parametros));
          const n = nota(f, "NOTA_DE_DEBITO", f.factura, "100");
          const alta = s2.directo(n.texto, n.parametros);
          expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
          expect((await s1.confirmar()).ok).toBe(true);
          const r = await alta;
          notaRechazada = !r.ok && r.restriccion === "nota_de_debito_de_factura_anulada";
        });
      });
      expect(notaRechazada).toBe(true);
    });

    it("dos notas de débito vinculadas a la vez entran las dos (no se bloquean entre sí)", async () => {
      const e = await escenario();
      await conAppDe(b(), e.m, async (s1) => {
        await conAppDe(b(), e.m, async (s2) => {
          const n1 = nota(e, "NOTA_DE_DEBITO", e.factura, "100");
          const n2 = nota(e, "NOTA_DE_DEBITO", e.factura, "200");
          acepta(await s1.intentar(n1.texto, n1.parametros));
          // La segunda no espera a la primera: FOR SHARE no choca con FOR SHARE.
          acepta(await s2.intentar(n2.texto, n2.parametros));
          expect((await s1.confirmar()).ok).toBe(true);
          expect((await s2.confirmar()).ok).toBe(true);
        });
      });
      const n = await dueno.query<{ n: string }>(
        "select count(*)::text as n from comprobante_de_proveedor where comprobante_asociado_id = $1 and clase = 'NOTA_DE_DEBITO'",
        [e.factura],
      );
      expect(n.rows[0]?.n).toBe("2");
    });

    it("una nota de crédito y una nota de débito vinculada a la vez sobre la misma factura, en los dos órdenes: la segunda espera a la primera y entran las dos (sin abrazo mortal)", async () => {
      const e = await escenario();
      for (const primeroLaNota of [true, false]) {
        await conAppDe(b(), e.m, async (s1) => {
          await conAppDe(b(), e.m, async (s2) => {
            const credito = nota(e, "NOTA_DE_CREDITO", e.factura, "100");
            const debito = nota(e, "NOTA_DE_DEBITO", e.factura, "100");
            const [primera, segunda] = primeroLaNota ? [credito, debito] : [debito, credito];
            acepta(await s1.intentar(primera.texto, primera.parametros));
            const espera = s2.directo(segunda.texto, segunda.parametros);
            // La de crédito toma FOR UPDATE de la factura y la de débito FOR SHARE: se bloquean en cualquier orden hasta que la primera confirma.
            expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
            expect((await s1.confirmar()).ok).toBe(true);
            const r = await espera;
            expect(r.ok, JSON.stringify(r)).toBe(true);
            expect((await s2.confirmar()).ok).toBe(true);
          });
        });
      }
      const clases = await dueno.query<{ clase: string; n: string }>(
        "select clase, count(*)::text as n from comprobante_de_proveedor where comprobante_asociado_id = $1 group by clase order by clase",
        [e.factura],
      );
      expect(clases.rows).toEqual([
        { clase: "NOTA_DE_CREDITO", n: "2" },
        { clase: "NOTA_DE_DEBITO", n: "2" },
      ]);
    });

    it("aislamiento: la nota de débito de una empresa no puede vincular la factura de otra (clave foránea compuesta con la empresa)", async () => {
      const a = await escenario();
      const b2 = await escenario();
      await conAppDe(b(), a.m, async (s) => {
        const n = nota(a, "NOTA_DE_DEBITO", b2.factura, "10");
        check(await s.intentar(n.texto, n.parametros), "nota_de_debito_sin_factura");
      });
    });

    it("el código de la migración no usa SECURITY DEFINER, DELETE, TRUNCATE ni CASCADE y fija el search_path de sus dos funciones", async () => {
      const codigo = (
        await readFile(
          join(import.meta.dirname, "../../migraciones", "0111_compras_notas_de_debito.sql"),
          "utf8",
        )
      ).replace(/--.*$/gm, "");
      expect(codigo).not.toMatch(/SECURITY DEFINER/i);
      expect(codigo).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE\s+TABLE|CASCADE)\b/i);
      expect(codigo.match(/SET search_path = pg_catalog, public, pg_temp/g)).toHaveLength(2);
    });
  },
);
