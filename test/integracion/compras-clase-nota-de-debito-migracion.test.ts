import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { montarCompras, type MontajeDeCompras } from "./compras-casos-apoyo";
import { acepta, intentoDelDueno, sinConfirmar } from "./fiscal-apoyo";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";

/**
 * Migración 0110 (clase de asiento de la nota de débito de compra): siembra UNA fila del catálogo con las banderas de REINTEGRO_DE_PROVEEDOR, se puede correr dos veces, la guarda de RLS frena (55000) sin un rol que la evada
 * y la reversión frena con asientos de esa clase, y sin ellos quita la fila (el catálogo es de solo inserción: el disparador se apaga solo para ese borrado y queda encendido), corre dos veces y borra su fila de `migracion`.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const MIGRACION = "0110_clase_de_asiento_nota_de_debito_de_compra.sql";
const REVERSION = "reversiones/0110_revertir_clase_de_asiento_nota_de_debito_de_compra.sql";
const leer = (archivo: string) => readFile(join(CARPETA_DE_MIGRACIONES, archivo), "utf8");

describe.skipIf(base === null)("0110: la clase de la nota de débito de compra", () => {
  let c: MontajeDeCompras;
  let empresa: string;
  let persona: string;
  let proveedor: string;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    const e = await c.escenario();
    empresa = e.empresa;
    persona = e.gerente.personaId as string;
    proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const clase = () =>
    c.dueno.query<{ signo: string; exige_detalle: boolean; admite_vencimiento: boolean }>(
      "select signo, exige_detalle, admite_vencimiento from clase_de_asiento where sentido = 'A_PAGAR' and clase = 'NOTA_DE_DEBITO_DE_COMPRA'",
    );

  it("la clase queda sembrada una sola vez, suma y sin detalle ni vencimiento; correr la migración otra vez no cambia nada", async () => {
    expect((await clase()).rows).toEqual([
      { signo: "+", exige_detalle: false, admite_vencimiento: false },
    ]);
    await sinConfirmar(c.dueno, async () => {
      acepta(await intentoDelDueno(c.dueno, await leer(MIGRACION)));
      expect((await clase()).rows).toHaveLength(1);
    });
  });

  it("la guarda de RLS frena (55000) con un rol que no la evade y deja pasar al que sí", async () => {
    const guarda = /IF row_security_active[\s\S]*?END IF;/.exec(await leer(MIGRACION))?.[0] ?? "";
    expect(guarda).not.toBe("");
    const bloque = `DO $$ BEGIN ${guarda} END $$`;
    await sinConfirmar(c.dueno, async () => {
      acepta(await intentoDelDueno(c.dueno, bloque));
      await c.dueno.query("set local role pedernal_app");
      const frena = await intentoDelDueno(c.dueno, bloque);
      expect(frena.ok ? "" : frena.codigo).toBe("55000");
    });
  });

  it("la reversión frena (55000) si hay asientos de esa clase y no toca nada", async () => {
    const reversion = await leer(REVERSION);
    await sinConfirmar(c.dueno, async () => {
      // Sin su distribución (que se verifica al confirmar): la transacción se deshace al terminar.
      acepta(
        await intentoDelDueno(
          c.dueno,
          `insert into asiento_de_saldo (empresa_id, parte_id, sentido, clase, importe, origen_tipo, origen_id, clave_idempotencia, huella, hecho_en, registrado_por)
             values ($1, $2, 'A_PAGAR', 'NOTA_DE_DEBITO_DE_COMPRA', 100, 'compras.nota', gen_random_uuid(), $3, repeat('c', 64), now(), $4)`,
          [empresa, proveedor, `clave-${String(Date.now())}-nota-debito`, persona],
        ),
      );
      const frena = await intentoDelDueno(c.dueno, reversion);
      expect(frena.ok ? "" : frena.codigo).toBe("55000");
    });
    expect((await clase()).rows).toHaveLength(1);
  });

  it("sin asientos la reversión quita la fila, deja el disparador del catálogo encendido, corre dos veces y borra su fila de `migracion`", async () => {
    const reversion = await leer(REVERSION);
    await sinConfirmar(c.dueno, async () => {
      acepta(await intentoDelDueno(c.dueno, reversion));
      acepta(await intentoDelDueno(c.dueno, reversion));
      expect((await clase()).rows).toEqual([]);
      const disparador = await c.dueno.query<{ tgenabled: string }>(
        "select tgenabled from pg_trigger where tgname = 'clase_de_asiento_solo_insercion'",
      );
      expect(disparador.rows).toEqual([{ tgenabled: "O" }]);
      const fila = await c.dueno.query("select 1 from migracion where nombre = $1", [MIGRACION]);
      expect(fila.rowCount).toBe(0);
      // El catálogo sigue siendo de solo inserción para quien no es esta reversión.
      expect(
        (
          await intentoDelDueno(
            c.dueno,
            "delete from clase_de_asiento where clase = 'REINTEGRO_DE_PROVEEDOR'",
          )
        ).ok,
      ).toBe(false);
    });
    expect((await clase()).rows).toHaveLength(1);
  });

  it("ya se puede usar la clase: el libro acepta un asiento de nota de débito con su distribución", async () => {
    await sinConfirmar(c.dueno, async () => {
      acepta(
        await intentoDelDueno(
          c.dueno,
          `with a as (
             insert into asiento_de_saldo (empresa_id, parte_id, sentido, clase, importe, origen_tipo, origen_id, clave_idempotencia, huella, hecho_en, registrado_por)
             values ($1, $2, 'A_PAGAR', 'NOTA_DE_DEBITO_DE_COMPRA', 100, 'compras.nota', gen_random_uuid(), $3, repeat('d', 64), now(), $4) returning id)
           insert into distribucion_de_asiento (empresa_id, asiento_id, sucursal_id, importe) select $1, id, null, 100 from a`,
          [empresa, proveedor, `clave-${String(Date.now())}-uso`, persona],
        ),
      );
      acepta(await intentoDelDueno(c.dueno, "set constraints all immediate"));
    });
  });
});
