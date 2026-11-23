import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  CANTIDAD_MAXIMA_DE_BILLETES,
  DENOMINACIONES_DE_BILLETES,
} from "../../src/modulos/caja/dominio/arqueo";
import { TOPE_DE_IMPORTE_EN_CENTAVOS } from "../../src/modulos/caja/dominio/importes";
import { TOPE_DE_TOTAL_EN_CENTAVOS } from "../../src/modulos/fiscal/dominio/calculo-de-renglones";
import { ARS } from "../../src/primitivas/dinero/moneda";
import { MAXIMO_DE_CUOTAS, MINIMO_DE_CUOTAS } from "../../src/primitivas/cantidad/cuotas";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";
import { literalesDeLaLista, paridadDeListaNumerica, paridadDeTope } from "./paridad-apoyo";

/**
 * P3a de la comprobación primitivas ↔ base: el DINERO. Un importe que el dominio acepta y la base rechaza (o al revés) se descubre tarde, con un cobro a medio hacer. Acá cada tope, cantidad
 * y moneda del dominio se compara con su copia en un CHECK de la base real (tras todas las migraciones), con los helpers de `paridad-apoyo.ts`; los valores salen del dominio, no de literales
 * de la prueba. Cubre: topes de importe de caja y fiscal, cuotas, billetes del arqueo y moneda en toda tabla que tenga la columna.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

/** Centavos enteros a texto decimal con dos decimales: `99999999999n` → `999999999.99`. */
const aDecimal = (centavos: bigint): string => {
  const t = centavos.toString().padStart(3, "0");
  return `${t.slice(0, -2)}.${t.slice(-2)}`;
};

describe.skipIf(base === null)("paridad dominio ↔ base: dinero", () => {
  let aparte: Awaited<ReturnType<typeof crearBaseAparte>>;
  let c: pg.Client;
  beforeAll(async () => {
    aparte = await crearBaseAparte(base as BaseDePruebas);
    c = new pg.Client({ connectionString: aparte.base.dueno });
    await c.connect();
  });
  afterAll(async () => {
    await c.end();
    await aparte.destruir();
  });

  it("el tope de un importe de caja es el del dominio (movimiento y declaración de total)", async () => {
    await paridadDeTope(
      c,
      "movimiento_caja",
      "movimiento_caja_tope_ck",
      "abs(importe)",
      "<=",
      aDecimal(TOPE_DE_IMPORTE_EN_CENTAVOS),
    );
    await paridadDeTope(
      c,
      "declaracion_de_total",
      "declaracion_de_total_importe_ck",
      "importe",
      "<=",
      aDecimal(TOPE_DE_IMPORTE_EN_CENTAVOS),
    );
  });

  it("el tope de un total fiscal es el del dominio (comprobante, línea, importe por alícuota) y el total de un comprobante es mayor que cero, como lo pide el dominio", async () => {
    const tope = aDecimal(TOPE_DE_TOTAL_EN_CENTAVOS);
    await paridadDeTope(c, "comprobante", "comprobante_importes_ck", "total", "<=", tope);
    await paridadDeTope(
      c,
      "comprobante_linea",
      "comprobante_linea_importe_ck",
      "importe",
      "<=",
      tope,
    );
    await paridadDeTope(c, "comprobante_alicuota", "comprobante_alicuota_ck", "total", "<=", tope);
    // El dominio rechaza un total `<= 0` (`calculo-de-renglones.ts`: «una factura de cero pesos no se informa a ARCA»): la base exige `total > 0`.
    await paridadDeTope(c, "comprobante", "comprobante_importes_ck", "total", ">", 0);
  });

  it("las cuotas de un cobro van de MINIMO a MAXIMO_DE_CUOTAS, como en el dominio", async () => {
    await paridadDeTope(c, "cobro", "cobro_cuotas_ck", "cuotas", ">=", MINIMO_DE_CUOTAS);
    await paridadDeTope(c, "cobro", "cobro_cuotas_ck", "cuotas", "<=", MAXIMO_DE_CUOTAS);
  });

  it("los billetes del arqueo: las denominaciones y la cantidad máxima son las del dominio (sin el de $50.000)", async () => {
    await paridadDeListaNumerica(
      c,
      "arqueo_billete",
      "arqueo_billete_denominacion_ck",
      DENOMINACIONES_DE_BILLETES,
    );
    expect(DENOMINACIONES_DE_BILLETES).not.toContain(50000);
    await paridadDeTope(c, "arqueo_billete", "arqueo_billete_cantidad_ck", "cantidad", ">=", 0);
    await paridadDeTope(
      c,
      "arqueo_billete",
      "arqueo_billete_cantidad_ck",
      "cantidad",
      "<=",
      CANTIDAD_MAXIMA_DE_BILLETES,
    );
  });

  it("toda tabla con columna `moneda` tiene un CHECK que admite solo la moneda del dominio (ARS): una tabla nueva sin CHECK rompe esta prueba", async () => {
    const columnas = await c.query<{ tabla: string }>(
      "select table_name as tabla from information_schema.columns where table_schema = 'public' and column_name = 'moneda' order by 1",
    );
    expect(columnas.rows.length).toBeGreaterThanOrEqual(16);
    const sinCheck: string[] = [];
    const distintas: string[] = [];
    for (const { tabla } of columnas.rows) {
      const cks = await c.query<{ def: string }>(
        "select pg_get_constraintdef(oid) as def from pg_constraint where contype = 'c' and conrelid = $1::regclass and pg_get_constraintdef(oid) ~ '\\mmoneda\\M'",
        [tabla],
      );
      const soloMoneda = cks.rows.filter((r) => /moneda/.test(r.def) && !/OR /.test(r.def));
      if (soloMoneda.length === 0) {
        sinCheck.push(tabla);
        continue;
      }
      for (const { def } of soloMoneda) {
        const lit = def.match(/'([A-Z]{3})'/g)?.map((x) => x.replaceAll("'", "")) ?? [];
        if (lit.length !== 1 || lit[0] !== ARS) distintas.push(`${tabla}: ${def}`);
      }
    }
    expect(sinCheck).toEqual([]);
    expect(distintas).toEqual([]);
    expect(literalesDeLaLista("CHECK ((moneda = ANY (ARRAY['ARS'::text])))")).toEqual([ARS]);
  });
});
