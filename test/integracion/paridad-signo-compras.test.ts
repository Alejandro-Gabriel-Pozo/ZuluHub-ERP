import pg from "pg";
import { afterAll, beforeAll, describe, inject, it, vi } from "vitest";
import {
  leerCantidadPositiva,
  leerPrecioPositivo,
} from "../../src/modulos/compras/dominio/decimal";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";
import { paridadDeAceptacion } from "./paridad-comportamiento";

/**
 * P4d de la comprobación primitivas ↔ base: SIGNO, CERO y RANGO de compras. La cantidad y el precio de una corrección, el precio y el costo de una línea de recepción y el último precio y costo de una
 * oferta (todos estrictamente mayores que cero) se comparan con `leerCantidadPositiva` y `leerPrecioPositivo`, que también fijan el tope por la escala de la primitiva. Sondas: un paso por debajo y por
 * encima de cero y los dos bordes del tope. Quedan fuera, sin función de dominio que los decida: el importe de una línea de recepción y el de un pago (`>= 0`; `leerImporte` admite negativos y la cota la pone
 * cada módulo).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const CANTIDADES = ["-0.0001", "0", "0.0001", "99999999999999.9999", "100000000000000"];
const PRECIOS = [
  "-0.000001",
  "0",
  "0.000001",
  "999999999999.999999",
  "1000000000000",
  "9999999999999",
];
const cantidadValida = (texto: string): boolean => leerCantidadPositiva(texto) !== null;
const precioValido = (texto: string): boolean => leerPrecioPositivo(texto) !== null;

describe.skipIf(base === null)("paridad dominio ↔ base: signo, cero y rango de compras", () => {
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

  it("la cantidad de una corrección de compra: mayor que cero y dentro de numeric(18,4), como en el dominio", async () => {
    await paridadDeAceptacion(
      c,
      "correccion_de_compra",
      "correccion_de_compra_cantidad_anterior_ck",
      "cantidad_anterior",
      CANTIDADES,
      cantidadValida,
    );
    await paridadDeAceptacion(
      c,
      "correccion_de_compra",
      "correccion_de_compra_cantidad_nueva_ck",
      "cantidad_nueva",
      CANTIDADES,
      cantidadValida,
    );
  });

  it("el precio de una corrección, de una línea de recepción y de una oferta: mayor que cero y dentro de numeric(18,6)", async () => {
    await paridadDeAceptacion(
      c,
      "correccion_de_compra",
      "correccion_de_compra_precio_anterior_ck",
      "precio_anterior",
      PRECIOS,
      precioValido,
    );
    await paridadDeAceptacion(
      c,
      "correccion_de_compra",
      "correccion_de_compra_precio_nuevo_ck",
      "precio_nuevo",
      PRECIOS,
      precioValido,
    );
    await paridadDeAceptacion(
      c,
      "linea_de_recepcion",
      "linea_de_recepcion_precio_ck",
      "precio",
      PRECIOS,
      precioValido,
    );
    await paridadDeAceptacion(
      c,
      "linea_de_recepcion",
      "linea_de_recepcion_costo_ck",
      "costo_por_unidad_de_stock",
      PRECIOS,
      precioValido,
    );
    await paridadDeAceptacion(
      c,
      "oferta_de_proveedor",
      "oferta_ultimo_precio_ck",
      "ultimo_precio",
      PRECIOS,
      precioValido,
    );
    await paridadDeAceptacion(
      c,
      "oferta_de_proveedor",
      "oferta_ultimo_costo_ck",
      "ultimo_costo_por_unidad_de_stock",
      PRECIOS,
      precioValido,
    );
  });
});
