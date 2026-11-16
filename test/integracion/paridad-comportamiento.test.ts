import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CANTIDAD_MAXIMA_DE_BILLETES } from "../../src/modulos/caja/dominio/arqueo";
import { TOPE_DE_IMPORTE_EN_CENTAVOS } from "../../src/modulos/caja/dominio/importes";
import { TOPE_DE_TOTAL_EN_CENTAVOS } from "../../src/modulos/fiscal/dominio/calculo-de-renglones";
import { MAXIMO_DE_CUOTAS, MINIMO_DE_CUOTAS } from "../../src/primitivas/cantidad/cuotas";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";
import { aceptaLaBase, desplazado, paridadDeRango } from "./paridad-comportamiento";

/**
 * PR2b de la comprobación primitivas ↔ base: los mismos topes del dinero que `paridad-dinero.test.ts`, pero preguntándole a la base si acepta o rechaza el borde (sin leer el texto de
 * `pg_get_constraintdef`). Si Postgres cambia cómo escribe un CHECK, esta prueba no se entera; si el CHECK cambia de verdad, falla. Con una violación inyectada: un tope desalineado en una tabla
 * temporal tiene que hacer fallar a `paridadDeRango`.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const aDecimal = (centavos: bigint): string => {
  const t = centavos.toString().padStart(3, "0");
  return `${t.slice(0, -2)}.${t.slice(-2)}`;
};

describe("desplazado: un paso de la escala, sin flotantes", () => {
  it("suma y resta el menor paso", () => {
    expect(desplazado("999999999.99", 2, 1n)).toBe("1000000000.00");
    expect(desplazado("0.00", 2, -1n)).toBe("-0.01");
    expect(desplazado("36", 0, 1n)).toBe("37");
    expect(desplazado("1", 0, -1n)).toBe("0");
    expect(desplazado("-5.00", 2, 1n)).toBe("-4.99");
  });
});

describe.skipIf(base === null)("paridad por comportamiento: dominio ↔ base", () => {
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

  it("el tope de un importe de caja: la base acepta el del dominio y rechaza un centavo más", async () => {
    const tope = aDecimal(TOPE_DE_IMPORTE_EN_CENTAVOS);
    await paridadDeRango(c, "movimiento_caja", "movimiento_caja_tope_ck", "importe", {
      maximo: tope,
    });
    await paridadDeRango(c, "declaracion_de_total", "declaracion_de_total_importe_ck", "importe", {
      maximo: tope,
    });
  });

  it("las cuotas de un cobro: de MINIMO a MAXIMO_DE_CUOTAS", async () => {
    await paridadDeRango(c, "cobro", "cobro_cuotas_ck", "cuotas", {
      minimo: String(MINIMO_DE_CUOTAS),
      maximo: String(MAXIMO_DE_CUOTAS),
    });
  });

  it("la cantidad de billetes del arqueo: de 0 a la máxima del dominio", async () => {
    await paridadDeRango(c, "arqueo_billete", "arqueo_billete_cantidad_ck", "cantidad", {
      minimo: "0",
      maximo: String(CANTIDAD_MAXIMA_DE_BILLETES),
    });
  });

  it("el tope de un total fiscal en una línea de comprobante", async () => {
    await paridadDeRango(c, "comprobante_linea", "comprobante_linea_importe_ck", "importe", {
      maximo: aDecimal(TOPE_DE_TOTAL_EN_CENTAVOS),
    });
  });

  it("violación inyectada: un tope desalineado (100 en la base, 101 en el dominio) hace fallar la paridad", async () => {
    await c.query(
      "create temp table inyectada (n integer, constraint inyectada_ck check (n <= 100))",
    );
    await expect(
      paridadDeRango(c, "inyectada", "inyectada_ck", "n", { maximo: "101" }),
    ).rejects.toThrow();
    await expect(
      paridadDeRango(c, "inyectada", "inyectada_ck", "n", { maximo: "99" }),
    ).rejects.toThrow();
    await paridadDeRango(c, "inyectada", "inyectada_ck", "n", { maximo: "100" });
    expect(await aceptaLaBase(c, "inyectada", "inyectada_ck", "n", ["100", "101"])).toEqual([
      true,
      false,
    ]);
  });

  it("una restricción de varias columnas pide los valores fijos de las otras", async () => {
    await c.query("create temp table dos (a integer, b integer, constraint dos_ck check (a <= b))");
    await expect(aceptaLaBase(c, "dos", "dos_ck", "a", ["1"])).rejects.toThrow();
    expect(await aceptaLaBase(c, "dos", "dos_ck", "a", ["5", "6"], { b: "5" })).toEqual([
      true,
      false,
    ]);
  });
});
