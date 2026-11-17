import pg from "pg";
import { afterAll, beforeAll, describe, inject, it, vi } from "vitest";
import { TRANSICIONES_DE_SERIE } from "../../src/modulos/fiscal/dominio/numeracion";
import { TRANSICIONES_DE_TRASPASO } from "../../src/modulos/identidad/dominio/traspaso";
import { TRANSICIONES_DE_TRABAJO } from "../../src/puertos/cola-de-trabajos";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";
import { paridadDeLista } from "./paridad-apoyo";

/**
 * P5d de la comprobación primitivas ↔ base: los ESTADOS de una máquina de estados salen de las CLAVES de su tabla de transiciones del dominio (`TRANSICIONES_DE_*`), que ya tiene su paridad de pares.
 * Acá el CHECK de estado de la serie de numeración, del trabajo de la cola y del traspaso de gerencia se compara con esas claves: un estado nuevo en la tabla del dominio sin el CHECK (o al revés) falla.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("paridad dominio ↔ base: estados por tabla de transiciones", () => {
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

  it("el estado de una serie, de un trabajo y de un traspaso son las claves de su tabla de transiciones", async () => {
    await paridadDeLista(
      c,
      "serie_comprobante",
      "serie_estado_ck",
      Object.keys(TRANSICIONES_DE_SERIE),
    );
    await paridadDeLista(c, "trabajo", "trabajo_estado_ck", Object.keys(TRANSICIONES_DE_TRABAJO));
    await paridadDeLista(
      c,
      "traspaso_gerencia",
      "traspaso_gerencia_estado_ck",
      Object.keys(TRANSICIONES_DE_TRASPASO),
    );
  });
});
