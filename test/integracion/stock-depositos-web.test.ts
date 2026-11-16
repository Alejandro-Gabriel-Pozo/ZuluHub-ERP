import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  listarLosDepositos,
  type DependenciasDeDepositosWeb,
} from "../../src/composicion/depositos-web";
import {
  montarStock,
  nombreDeDeposito,
  nuevoId,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * La lista de «Depósitos» de stock de la web contra una base real y los roles reales: lo que la pantalla recibe (y nada más), que la sucursal pedida es la única que se lee, que quien opera
 * la ve, que otra empresa no ve nada y que con el módulo apagado no se lee. Los casos de uso en sí tienen sus pruebas en `stock-depositos.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("lista de depósitos de stock de la web", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  let d: DependenciasDeDepositosWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
    d = { consultas: () => c.consultas, respuesta: { registrar: () => undefined } };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const sucursalNueva = async (): Promise<string> =>
    (
      await c.dueno.query<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
        [e.empresa, nombreDeDeposito("Sucursal")],
      )
    ).rows[0]?.id as string;
  const crear = async (sucursal: string, extra: Record<string, unknown> = {}) => {
    const nombre = nombreDeDeposito();
    const { depositoId } = valorDe(
      await c.casos.crearDeposito(e.gerente, {
        id: nuevoId(),
        sucursalId: sucursal,
        nombre,
        uso: "NORMAL",
        deVenta: false,
        ...extra,
      }),
    );
    return { id: depositoId, nombre };
  };
  const lista = async (quien = e.gerente, sucursal: string = e.sucursal) => {
    const r = await listarLosDepositos(d, quien, sucursal);
    if (!r.ok) throw new Error(`se esperaba la lista y vino ${r.error.codigo}`);
    return r.dato.depositos;
  };

  it("trae los depósitos de esa sucursal con lo que la pantalla muestra y nada más, y no los de otra", async () => {
    const sucursal = await sucursalNueva();
    const venta = await crear(sucursal, { uso: "NORMAL", deVenta: true });
    const cuarentena = await crear(sucursal, { uso: "CUARENTENA" });
    const otra = await crear(await sucursalNueva());
    const depositos = await lista(e.gerente, sucursal);
    expect(depositos).toHaveLength(2);
    expect(depositos).toEqual(
      expect.arrayContaining([
        { id: venta.id, nombre: venta.nombre, uso: "NORMAL", deVenta: true, activo: true },
        {
          id: cuarentena.id,
          nombre: cuarentena.nombre,
          uso: "CUARENTENA",
          deVenta: false,
          activo: true,
        },
      ]),
    );
    expect(depositos.some((x) => x.id === otra.id)).toBe(false);
  });

  it("también trae los desactivados, marcados: la pantalla decide qué muestra", async () => {
    const sucursal = await sucursalNueva();
    const x = await crear(sucursal);
    valorDe(await c.casos.desactivarDeposito(e.gerente, { depositoId: x.id }));
    expect(await lista(e.gerente, sucursal)).toEqual([
      { id: x.id, nombre: x.nombre, uso: "NORMAL", deVenta: false, activo: false },
    ]);
  });

  it("quien opera la ve (con `stock.ver`)", async () => {
    const x = await crear(e.sucursal);
    expect((await lista(e.operador)).some((y) => y.id === x.id)).toBe(true);
  });

  it("una sucursal que no es del alcance de quien pide sale vacía, sin error ni pistas", async () => {
    await crear(e.otraSucursal);
    expect(await lista(e.administradorDeUnaSucursal, e.otraSucursal)).toEqual([]);
  });

  it("la empresa B no ve los depósitos de la A, aunque pida la sucursal de la A", async () => {
    const b = await c.escenario();
    const sucursal = await sucursalNueva();
    await crear(sucursal);
    expect(await lista(b.gerente, sucursal)).toEqual([]);
  });

  it("con el módulo apagado nada se lee: MODULO_NO_ACTIVO", async () => {
    c.apagarModulo("stock");
    try {
      const r = await listarLosDepositos(d, e.gerente, e.sucursal);
      expect(r.ok === false && r.error.codigo).toBe("MODULO_NO_ACTIVO");
    } finally {
      c.encenderModulos();
    }
  });
});
