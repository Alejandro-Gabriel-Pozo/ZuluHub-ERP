import pg from "pg";
import { afterAll, beforeAll, describe, inject, it, vi } from "vitest";
import { leerCostoDeclarado } from "../../src/modulos/stock/casos-de-uso/costos";
import { CLASES_DE_MOVIMIENTO, signoValido } from "../../src/modulos/stock/dominio/movimiento";
import { cantidadConSignoDesdeTexto } from "../../src/primitivas/cantidad/con-signo";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";
import { paridadDeAceptacion } from "./paridad-comportamiento";

/**
 * P4c de la comprobación primitivas ↔ base: SIGNO, CERO y RANGO de stock. El costo de un artículo o de un renglón (estrictamente mayor que cero: «sin costo» es no mandarlo, no un cero) se compara con
 * `leerCostoDeclarado`, que también fija el tope (`numeric(18,6)`); la cantidad de un renglón del libro (nunca cero, con el signo que admita alguna clase de movimiento) con `signoValido` y el rango de
 * `cantidadConSignoDesdeTexto`. Sondas: un paso por debajo y por encima de cero, y los dos bordes del tope. El costo de una orden de producción (`orden_costo_ck`, `>= 0`) NO se compara acá: lo calcula `costearOrden`
 * y el cero cubre el borde del redondeo; «sin costo» es NULL, no cero (orquestador, 17/11).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const costoValido = (texto: string): boolean => leerCostoDeclarado(texto).ok;

/** ¿Algún tipo de movimiento admite un renglón con esta cantidad? (rango y signo, como los decide el dominio). */
const renglonValido = (texto: string): boolean => {
  const cantidad = cantidadConSignoDesdeTexto(texto);
  return cantidad.ok && CLASES_DE_MOVIMIENTO.some((clase) => signoValido(clase, cantidad.valor));
};

describe.skipIf(base === null)("paridad dominio ↔ base: signo, cero y rango de stock", () => {
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

  it("el costo unitario de un artículo y de un renglón: mayor que cero y dentro de numeric(18,6), como en el dominio", async () => {
    const sondas = ["-0.000001", "0", "0.000001", "999999999999.999999", "1000000000000"];
    await paridadDeAceptacion(
      c,
      "costo_de_articulo",
      "costo_de_articulo_costo_ck",
      "costo_unitario",
      sondas,
      costoValido,
    );
    await paridadDeAceptacion(
      c,
      "costo_de_renglon",
      "costo_de_renglon_costo_ck",
      "costo_unitario",
      sondas,
      costoValido,
    );
  });

  it("la cantidad de un renglón del libro: nunca cero, con signo, dentro del rango de la cantidad con signo", async () => {
    const sondas = [
      "-100000000000000",
      "-99999999999999.9999",
      "-0.0001",
      "0",
      "0.0001",
      "99999999999999.9999",
      "100000000000000",
    ];
    await paridadDeAceptacion(
      c,
      "renglon_de_movimiento",
      "renglon_cantidad_ck",
      "cantidad",
      sondas,
      renglonValido,
    );
  });
});
