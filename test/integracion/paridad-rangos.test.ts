import pg from "pg";
import { afterAll, beforeAll, describe, inject, it, vi } from "vitest";
import {
  ORDEN_MAXIMO_DE_COBRO,
  ORDEN_MINIMO_DE_COBRO,
} from "../../src/modulos/caja/dominio/identidad-del-cobro";
import {
  NUMERO_DE_COMPROBANTE_MAXIMO,
  NUMERO_DE_COMPROBANTE_MINIMO,
  PUNTO_DE_VENTA_MAXIMO,
  PUNTO_DE_VENTA_MINIMO,
} from "../../src/modulos/compras/dominio/comprobante";
import {
  COLUMNAS_DEL_SALON,
  FILAS_DEL_SALON,
  NUMERO_MAXIMO_DE_MESA,
  NUMERO_MINIMO_DE_MESA,
} from "../../src/modulos/salon/dominio/mesa";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";
import { paridadDeRango } from "./paridad-comportamiento";

/**
 * P5c de la comprobación primitivas ↔ base: RANGOS ENTEROS con constante en el dominio. El orden de un cobro (1 a 50), el punto de venta y el número de un comprobante o remito de compras, y la
 * grilla del salón (columnas, filas y número de mesa) se comparan con las constantes que el dominio exporta: la base acepta el mínimo y el máximo y rechaza uno por debajo y uno por encima. Los valores
 * salen del dominio, no de la prueba. Quedan en deuda los rangos sin constante exportada (`> 0` de números de versión, `< 10000` de posiciones y ejemplares, límites de nombres, etc.).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const texto = (n: number): string => String(n);

describe.skipIf(base === null)("paridad dominio ↔ base: rangos enteros", () => {
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

  it("el orden de un cobro: de ORDEN_MINIMO_DE_COBRO a ORDEN_MAXIMO_DE_COBRO", async () => {
    const rango = { minimo: texto(ORDEN_MINIMO_DE_COBRO), maximo: texto(ORDEN_MAXIMO_DE_COBRO) };
    await paridadDeRango(c, "cobro", "cobro_origen_orden_ck", "origen_orden", rango);
    await paridadDeRango(c, "aplicacion_de_cobro", "aplicacion_orden_ck", "orden", rango);
  });

  it("el punto de venta y el número de un comprobante de proveedor y de un remito", async () => {
    const pv = { minimo: texto(PUNTO_DE_VENTA_MINIMO), maximo: texto(PUNTO_DE_VENTA_MAXIMO) };
    const numero = {
      minimo: texto(NUMERO_DE_COMPROBANTE_MINIMO),
      maximo: texto(NUMERO_DE_COMPROBANTE_MAXIMO),
    };
    await paridadDeRango(c, "comprobante_de_proveedor", "cp_pv_ck", "punto_de_venta", pv);
    await paridadDeRango(c, "comprobante_de_proveedor", "cp_numero_ck", "numero", numero);
    await paridadDeRango(c, "recepcion", "recepcion_remito_pv_ck", "remito_punto_de_venta", pv);
    await paridadDeRango(c, "recepcion", "recepcion_remito_numero_ck", "remito_numero", numero);
  });

  it("la grilla del salón y el número de mesa", async () => {
    const columnas = { minimo: "1", maximo: texto(COLUMNAS_DEL_SALON) };
    const filas = { minimo: "1", maximo: texto(FILAS_DEL_SALON) };
    await paridadDeRango(c, "mesa", "mesa_columna_ck", "columna", columnas);
    await paridadDeRango(c, "mesa", "mesa_fila_ck", "fila", filas);
    await paridadDeRango(c, "mesa_celda", "mesa_celda_columna_ck", "columna", columnas);
    await paridadDeRango(c, "mesa_celda", "mesa_celda_fila_ck", "fila", filas);
    await paridadDeRango(c, "mesa", "mesa_numero_ck", "numero", {
      minimo: texto(NUMERO_MINIMO_DE_MESA),
      maximo: texto(NUMERO_MAXIMO_DE_MESA),
    });
  });
});
