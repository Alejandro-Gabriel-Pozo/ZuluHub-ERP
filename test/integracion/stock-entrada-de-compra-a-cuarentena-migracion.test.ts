import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, inject, it, vi } from "vitest";
import { crearBaseAparte } from "./entorno";
import {
  acepta,
  check,
  crearMundo,
  intentoDelDueno,
  sinConfirmar,
  type Mundo,
} from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";
import {
  articuloDeBase,
  depositoDeBase,
  entrada,
  escribirMovimiento,
  salida,
  type MovimientoDePrueba,
} from "./stock-apoyo";

/**
 * Migración 0064 (compras N3, decisión del dueño del 14/11/2026): una entrada de COMPRA con origen RECEPCION puede ir directo a un depósito de cuarentena o de rechazo.
 * Previene: que el libro de stock rechace lo que compras ya decidió (o que se afloje de más: otra entrada, la venta o una salida desde esos depósitos siguen rechazadas).
 * Prueba: la entrada de compra entra a cuarentena y rechazo, todo lo demás sigue rechazado, y la reversión vuelve a la regla de 0030 y se puede repetir.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const REVERSION = () =>
  readFile(
    join(
      CARPETA_DE_MIGRACIONES,
      "reversiones",
      "0064_revertir_stock_entrada_de_compra_a_cuarentena_y_rechazo.sql",
    ),
    "utf8",
  );

describe.skipIf(base === null)("0064: una compra recibida entra a cuarentena y rechazo", () => {
  const b = () => base as BaseDePruebas;
  let aparte: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let m: Mundo;

  beforeAll(async () => {
    aparte = await crearBaseAparte(b());
    dueno = new pg.Client({ connectionString: aparte.base.dueno });
    await dueno.connect();
    m = await crearMundo(dueno);
  });
  afterAll(async () => {
    await dueno.end();
    await aparte.destruir();
  });

  const escribir = (mov: MovimientoDePrueba) =>
    escribirMovimiento((t, p) => intentoDelDueno(dueno, t, p), m.empresa, mov);
  const deRecepcion = () => ({ origen: { tipo: "RECEPCION", id: randomUUID() } }) as const;

  it("la entrada de compra con origen recepción entra a cuarentena y a rechazo", async () => {
    await sinConfirmar(dueno, async () => {
      const { articulo } = await articuloDeBase(dueno, m);
      for (const uso of ["CUARENTENA", "RECHAZO"] as const) {
        const deposito = await depositoDeBase(dueno, m, { uso });
        const hecho = await escribir(
          entrada(m, deposito, articulo, "5", { origen: { tipo: "RECEPCION", id: randomUUID() } }),
        );
        acepta(hecho.resultado);
      }
    });
  });

  it("lo demás sigue rechazado: otra entrada, la misma compra sin origen de recepción, y la salida desde esos depósitos", async () => {
    await sinConfirmar(dueno, async () => {
      const { articulo } = await articuloDeBase(dueno, m);
      for (const uso of ["CUARENTENA", "RECHAZO"] as const) {
        const deposito = await depositoDeBase(dueno, m, { uso });
        const restringido = "renglon_deposito_de_uso_restringido";
        check(
          (
            await escribir(
              entrada(m, deposito, articulo, "5", { motivo: "OTRA_ENTRADA", ...deRecepcion() }),
            )
          ).resultado,
          restringido,
        );
        check((await escribir(entrada(m, deposito, articulo, "5"))).resultado, restringido);
        check(
          (
            await escribir(
              entrada(m, deposito, articulo, "5", { motivo: "CARGA_INICIAL", ...deRecepcion() }),
            )
          ).resultado,
          restringido,
        );
        check((await escribir(salida(m, deposito, articulo, "1"))).resultado, restringido);
      }
    });
  });

  it("la reversión vuelve a la regla de 0030 (esa entrada se rechaza otra vez) y se puede repetir", async () => {
    const reversion = await REVERSION();
    await sinConfirmar(dueno, async () => {
      acepta(await intentoDelDueno(dueno, reversion));
      acepta(await intentoDelDueno(dueno, reversion));
      const { articulo } = await articuloDeBase(dueno, m);
      const deposito = await depositoDeBase(dueno, m, { uso: "CUARENTENA" });
      check(
        (
          await escribir(
            entrada(m, deposito, articulo, "5", {
              origen: { tipo: "RECEPCION", id: randomUUID() },
            }),
          )
        ).resultado,
        "renglon_deposito_de_uso_restringido",
      );
      // una entrada normal sigue pasando
      const normal = await depositoDeBase(dueno, m);
      acepta((await escribir(entrada(m, normal, articulo, "5"))).resultado);
    });
  });
});
