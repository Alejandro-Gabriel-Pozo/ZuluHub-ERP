import pg from "pg";
import { afterAll, beforeAll, describe, inject, it, vi } from "vitest";
import { comprobarCantidadDeLinea } from "../../src/modulos/ventas/dominio/cantidad-de-linea";
import { cantidadDesdeTexto } from "../../src/primitivas/cantidad/cantidad";
import { precioDeVentaDesdeTexto } from "../../src/primitivas/dinero/precio-de-venta";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";
import { paridadDeAceptacion, paridadDeRango, sondasDeSigno } from "./paridad-comportamiento";

/**
 * P4b de la comprobación primitivas ↔ base: SIGNO Y CERO de ventas. La cantidad de una línea (`> 0` y como mucho 9999) y el precio (no negativo, el cero vale: cortesías) se comparan con la función
 * del dominio que los decide, sondeando un paso por debajo de cero, cero y un paso por encima (y los bordes de la cantidad). Los topes de precio que el dominio no tiene como constante quedan en
 * `arquitectura/paridad/sin-constante-en-el-dominio.json` (prueba: `paridad-sin-constante.test.ts`). Quedan fuera, sin función de dominio que los decida: los importes de ticket, ejemplar y cuenta
 * (el `Importe` del dominio admite negativos; la cota `>= 0` es de cada módulo).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

/** ¿El dominio acepta esta cantidad de línea? (`cantidadDesdeTexto` rechaza negativos; la cota es la de ventas). */
const cantidadDeLineaValida = (texto: string): boolean => {
  try {
    return comprobarCantidadDeLinea(cantidadDesdeTexto(texto)).ok;
  } catch {
    return false;
  }
};
const precioValido = (texto: string): boolean => precioDeVentaDesdeTexto(texto).ok;

describe.skipIf(base === null)("paridad dominio ↔ base: signo y cero de ventas", () => {
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

  it("la cantidad de una línea: la base y el dominio aceptan lo mismo en cero, un paso y los bordes de 9999", async () => {
    const sondas = ["-0.0001", "0", "0.0001", "9999", "9999.0001"];
    await paridadDeAceptacion(
      c,
      "linea_cuenta",
      "linea_cantidad_ck",
      "cantidad",
      sondas,
      cantidadDeLineaValida,
    );
    await paridadDeAceptacion(
      c,
      "ejemplar_linea",
      "ejemplar_linea_cantidad_ck",
      "cantidad",
      sondas,
      cantidadDeLineaValida,
    );
    await paridadDeRango(c, "linea_cuenta", "linea_cantidad_ck", "cantidad", {
      minimo: "0.0001",
      maximo: "9999",
    });
  });

  it("el precio de una línea y del catálogo: no negativo y el cero vale, como en el dominio", async () => {
    await paridadDeAceptacion(
      c,
      "linea_cuenta",
      "linea_precio_base_ck",
      "precio_base",
      sondasDeSigno,
      precioValido,
    );
    await paridadDeAceptacion(
      c,
      "linea_cuenta",
      "linea_precio_unitario_ck",
      "precio_unitario",
      sondasDeSigno,
      precioValido,
    );
    await paridadDeAceptacion(
      c,
      "precio_de_venta",
      "precio_de_venta_precio_ck",
      "precio",
      sondasDeSigno,
      precioValido,
    );
  });
});
