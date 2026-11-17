import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { fechaCivilDesdeTexto } from "../../src/primitivas/tiempo/fecha-civil";
import { controlesDelAporte, type JornadaRef } from "../../src/modulos/cierre/publico";
import { aporteDeStock } from "../../src/modulos/stock/publico";
import {
  montarStock,
  nuevoId,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * E5-T8, el aporte de stock al cierre del día con la base real: los conteos abiertos y las existencias en negativo de la SUCURSAL de la jornada
 * (no las de otra sucursal ni las de otra empresa), con el total exacto y las referencias del detalle. Los dos controles son `INFORMA`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("stock: aporte al cierre del día", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  let otra: EscenarioDeStock;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
    otra = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const jornada = (escenario: EscenarioDeStock, sucursal = escenario.sucursal): JornadaRef => ({
    empresaId: escenario.empresaId,
    sucursalId: sucursal,
    fechaDeNegocio: valorDe(fechaCivilDesdeTexto("2026-10-11")),
  });
  const controles = async (escenario: EscenarioDeStock, sucursal = escenario.sucursal) => {
    const r = await c.entorno.ejecutar({ contexto: escenario.gerente }, async (tx) => {
      const leidos = await aporteDeStock.controles(tx, jornada(escenario, sucursal));
      return leidos.ok ? { ok: true as const, valor: leidos.valor } : leidos;
    });
    const valor = valorDe(r);
    // Lo que entrega cumple el contrato de `cierre` (módulo propio, forma de la clave y de la huella).
    expect(controlesDelAporte("stock", valor).ok).toBe(true);
    return new Map(valor.map((x) => [x.clave, x]));
  };

  it("sin conteos abiertos ni saldos en negativo no hay nada que informar (cantidad 0), y no hay movimiento que revisar", async () => {
    const vacio = await c.escenario();
    const mapa = await controles(vacio);
    expect(mapa.get("stock.conteos_abiertos")).toMatchObject({
      severidad: "INFORMA",
      cantidad: 0,
      referencias: [],
    });
    expect(mapa.get("stock.existencias_negativas")).toMatchObject({
      severidad: "INFORMA",
      cantidad: 0,
      referencias: [],
    });
    const hay = await c.entorno.ejecutar({ contexto: vacio.gerente }, async (tx) =>
      aporteDeStock.hayMovimiento(tx, jornada(vacio)),
    );
    expect(hay).toEqual({ ok: true, valor: false });
  });

  it("cuenta los conteos abiertos de la sucursal (no los resueltos, ni los de otra sucursal ni los de otra empresa) y los saldos en negativo de sus depósitos", async () => {
    const dep = await c.deposito(e);
    const otroDeposito = await c.deposito(e);
    const enNorte = await c.deposito(e, { sucursal: e.otraSucursal });
    const ajeno = await c.deposito(otra);
    const a = await c.articulo(e);
    const deNorte = await c.articulo(e);
    const deOtra = await c.articulo(otra);

    // Dos conteos abiertos en la sucursal, uno cancelado, uno abierto en Norte y uno de la otra empresa.
    const abierto1 = nuevoId();
    const abierto2 = nuevoId();
    valorDe(await c.casos.abrirConteo(e.gerente, { id: abierto1, depositoId: dep }));
    valorDe(await c.casos.abrirConteo(e.gerente, { id: abierto2, depositoId: otroDeposito }));
    const cancelado = nuevoId();
    const depCancelado = await c.deposito(e);
    valorDe(await c.casos.abrirConteo(e.gerente, { id: cancelado, depositoId: depCancelado }));
    valorDe(
      await c.casos.cancelarConteo(e.gerente, { conteoId: cancelado, motivo: "Se contó mal" }),
    );
    valorDe(await c.casos.abrirConteo(e.gerente, { id: nuevoId(), depositoId: enNorte }));
    valorDe(await c.casos.abrirConteo(otra.gerente, { id: nuevoId(), depositoId: ajeno }));

    // Una existencia en negativo en la sucursal (el nivel por defecto lo permite), otra en Norte y otra en la otra empresa.
    const salida = (escenario: EscenarioDeStock, depositoId: string, producto: string) =>
      c.casos.registrarSalida(escenario.gerente, {
        clave: nuevoId(),
        depositoId,
        motivo: "MERMA",
        renglones: [{ productoId: producto, cantidad: "2", unidadId: "UNIDAD" }],
      });
    valorDe(await salida(e, dep, a.producto));
    valorDe(await salida(e, enNorte, deNorte.producto));
    valorDe(await salida(otra, ajeno, deOtra.producto));

    const mapa = await controles(e);
    expect(mapa.get("stock.conteos_abiertos")).toMatchObject({
      cantidad: 2,
      referencias: expect.arrayContaining([
        `stock.conteo:${abierto1}`,
        `stock.conteo:${abierto2}`,
      ]) as string[],
    });
    expect(mapa.get("stock.conteos_abiertos")?.referencias).toHaveLength(2);
    expect(mapa.get("stock.existencias_negativas")).toMatchObject({
      cantidad: 1,
      referencias: [`stock.existencia:${dep}:${a.articulo}`],
    });
    // Norte ve solo lo suyo.
    const norte = await controles(e, e.otraSucursal);
    expect(norte.get("stock.conteos_abiertos")?.cantidad).toBe(1);
    expect(norte.get("stock.existencias_negativas")?.referencias).toEqual([
      `stock.existencia:${enNorte}:${deNorte.articulo}`,
    ]);
    // Hay algo para revisar; resolverlo (aplicar o cancelar) lo saca del control.
    const hay = await c.entorno.ejecutar({ contexto: e.gerente }, async (tx) =>
      aporteDeStock.hayMovimiento(tx, jornada(e)),
    );
    expect(hay).toEqual({ ok: true, valor: true });
    valorDe(
      await c.casos.cancelarConteo(e.gerente, { conteoId: abierto1, motivo: "Se contó mal" }),
    );
    expect((await controles(e)).get("stock.conteos_abiertos")?.cantidad).toBe(1);
  });

  it("la huella cambia cuando cambia el detalle y es la misma si nada cambió", async () => {
    const m = await c.escenario();
    const dep = await c.deposito(m);
    const huella = async () => (await controles(m)).get("stock.conteos_abiertos")?.huellaDelDetalle;
    const antes = await huella();
    expect(await huella()).toBe(antes);
    valorDe(await c.casos.abrirConteo(m.gerente, { id: nuevoId(), depositoId: dep }));
    expect(await huella()).not.toBe(antes);
  });
});
