import pg from "pg";
import { afterAll, beforeAll, describe, inject, it, vi } from "vitest";
import { ARS } from "../../src/primitivas/dinero/moneda";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";
import { paridadDeLista } from "./paridad-apoyo";

/**
 * P4a de la comprobación primitivas ↔ base: la MONEDA. El dominio solo soporta pesos (`ARS`, ADR-006) y cada tabla con dinero repite esa lista en su CHECK de moneda. `paridad-dinero.test.ts`
 * recorre toda tabla con columna `moneda` y exige un CHECK de una sola moneda; acá cada CHECK se compara además con la lista del dominio, con una llamada por restricción y el nombre como
 * literal para que el escáner (C2) la vea como comparada. Si el dominio suma una moneda, estas pruebas fallan hasta que la base también la admita.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("paridad dominio ↔ base: moneda", () => {
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

  it("el CHECK de moneda de cada tabla admite exactamente la moneda del dominio", async () => {
    await paridadDeLista(c, "arqueo_caja", "arqueo_caja_moneda_ck", [ARS]);
    await paridadDeLista(c, "comprobante_de_proveedor", "cp_moneda_ck", [ARS]);
    await paridadDeLista(c, "conciliacion_de_cobro_por_origen", "conciliacion_de_cobro_moneda_ck", [
      ARS,
    ]);
    await paridadDeLista(c, "conciliacion_de_jornada", "conciliacion_de_jornada_moneda_ck", [ARS]);
    await paridadDeLista(c, "costo_de_articulo", "costo_de_articulo_moneda_ck", [ARS]);
    await paridadDeLista(c, "cuenta_consumo", "cuenta_moneda_ck", [ARS]);
    await paridadDeLista(c, "declaracion_de_total", "declaracion_de_total_moneda_ck", [ARS]);
    await paridadDeLista(c, "empresa", "empresa_moneda_ck", [ARS]);
    await paridadDeLista(c, "linea_cuenta", "linea_moneda_ck", [ARS]);
    await paridadDeLista(c, "movimiento_caja", "movimiento_caja_moneda_ck", [ARS]);
    await paridadDeLista(c, "orden_de_produccion", "orden_moneda_ck", [ARS]);
    await paridadDeLista(c, "pago_de_comprobante", "pago_moneda_ck", [ARS]);
    await paridadDeLista(c, "precio_de_venta", "precio_de_venta_moneda_ck", [ARS]);
    await paridadDeLista(c, "ticket", "ticket_moneda_ck", [ARS]);
    await paridadDeLista(c, "version_de_opcion", "version_de_opcion_moneda_ck", [ARS]);
  });
});
