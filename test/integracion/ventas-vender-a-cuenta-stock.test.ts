import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCasosDeUsoDeStock, type TxDeStock } from "../../src/modulos/stock/publico";
import type { CasosDeUsoDeStock } from "../../src/modulos/stock/publico";
import type { Transacciones } from "../../src/puertos/transacciones";
import { articuloDeBase, depositoDeBase, existenciaDe } from "./stock-apoyo";
import { ayudantesDeCuentaCorriente } from "./ventas-a-cuenta-apoyo";
import {
  REGLAS_DE_PRUEBA_CON_STOCK_Y_CUENTA_CORRIENTE as REGLAS,
  montarVentas,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * CC-5: `venderACuenta` con stock cableado (casos de uso reales de ventas, de stock y de cuenta corriente sobre la MISMA conexión). La venta a cuenta descuenta el stock del producto UNA vez
 * (también si se repite) y, si el cargo al libro se rechaza, el descuento se revierte con todo lo demás. Previene: stock descontado por una venta que no se cargó a nadie, o descontado dos veces por un reintento.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const monto = (v: string) => ({ moneda: "ARS", monto: v });

describe.skipIf(base === null)("ventas a cuenta con stock (CC-5)", () => {
  let m: MundoDeVentas;
  let stock: CasosDeUsoDeStock;
  let a: ReturnType<typeof ayudantesDeCuentaCorriente>;
  let e: EscenarioDeVentas;
  let deposito: string;
  let articulo: { producto: string; articulo: string };

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { stock: true, cuentaCorriente: true, conexiones: 8 });
    a = ayudantesDeCuentaCorriente(m);
    stock = crearCasosDeUsoDeStock({
      transacciones: m.entorno as unknown as Transacciones<TxDeStock>,
      reglas: REGLAS,
    });
    e = await m.escenario();
    deposito = await depositoDeBase(m.dueno, e, { deVenta: true });
    const reventa = await articuloDeBase(m.dueno, e, { clase: "REVENTA" });
    await m.precio({
      empresa: e.empresa,
      producto: reventa.producto,
      precio: "1000",
      desde: "2026-01-01T00:00:00Z",
    });
    valorDe(
      await stock.registrarEntrada(e.gerente, {
        clave: nuevoId(),
        depositoId: deposito,
        motivo: "COMPRA",
        renglones: [{ productoId: reventa.producto, cantidad: "10", unidadId: "UNIDAD" }],
      }),
    );
    articulo = reventa;
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  const existencia = () => existenciaDe(m.dueno, deposito, articulo.articulo);
  const pedido = (clienteId: string) => ({
    cuentaId: nuevoId(),
    ejemplarId: nuevoId(),
    sucursalId: e.sucursal,
    lineas: [{ lineaId: nuevoId(), productoId: articulo.producto, opcionIds: [], cantidad: "1" }],
    totalEsperado: monto("1000.00"),
    clienteId,
  });

  it("la venta a cuenta descuenta el stock una sola vez (la repetición no vuelve a descontar) y carga al libro", async () => {
    const c = await a.cliente(e);
    const antes = Number(await existencia());
    const p = pedido(c);
    const r = valorDe(await m.casos.venderACuenta(e.gerente, p));
    expect(Number(await existencia())).toBe(antes - 1);
    expect(valorDe(await m.casos.venderACuenta(e.gerente, p)).ticketId).toBe(r.ticketId);
    expect(Number(await existencia())).toBe(antes - 1);
    expect(await a.saldo(e, c)).toBe("1000.00");
  });

  it("si el cargo se rechaza (EXCEDE_EL_LIMITE) el descuento de stock se revierte: la existencia queda igual y no hay cuenta ni ticket", async () => {
    const c = await a.cliente(e, { limite: "999.99" });
    const antes = await existencia();
    const p = pedido(c);
    expect(await m.casos.venderACuenta(e.gerente, p)).toEqual({
      ok: false,
      error: "EXCEDE_EL_LIMITE",
    });
    expect(await existencia()).toBe(antes);
    expect(
      await m.contar("select count(*) as n from cuenta_consumo where id = $1", [p.cuentaId]),
    ).toBe(0);
    expect(
      await m.contar("select count(*) as n from ticket where cuenta_id = $1", [p.cuentaId]),
    ).toBe(0);
    expect(await a.asientos(e, c)).toEqual([]);
  });
});
