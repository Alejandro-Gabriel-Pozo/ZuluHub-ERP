import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  dividirLaCuenta,
  type DependenciasDeDividirCuentaWeb,
} from "../../src/composicion/dividir-cuenta-web";
import { productoDeBase } from "./catalogo-apoyo";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * Dividir por ítems un producto de paso fraccionado (SAL-E4, DEC-SAL-010) contra una base real: «Por unidades» solo vale cuando precio × paso es un número exacto de centavos, así las cuentas suman SIEMPRE el total de la mesa. 2 kg de
 * helado a $ 1.000,01 el kilo (paso 0,5) repartidos en 0,5 y 1,5 darían $ 2.000,03 contra los $ 2.000,02 de la línea: el servidor lo rechaza con el genérico y no escribe nada; Entero y Compartido de la misma línea suman exacto; y a
 * $ 1.000,00 el kilo sí se reparte por unidades.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const DESDE = "2026-01-01T00:00:00.000Z";
const GENERICO = { ok: false, error: { codigo: "CATALOGO_ACCION_NO_PERMITIDA" } };

describe.skipIf(base === null)("composición web: dividir un ítem de paso fraccionado", () => {
  let m: MundoDeSalon;
  let d: DependenciasDeDividirCuentaWeb;
  const proxima = new Map<string, number>();
  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base);
    d = { casosDeUso: () => m.salon, respuesta: { registrar: () => undefined } };
  });
  afterAll(async () => {
    await m.cerrar();
  });

  /** Una mesa con `cantidad` kilos de un producto de paso 0,5 a ese precio, enviada a cocina. */
  const mesaConHelado = async (e: EscenarioDeVentas, precio: string, cantidad = "2") => {
    const n = (proxima.get(e.empresa) ?? 0) + 1;
    proxima.set(e.empresa, n);
    const mesaId = nuevoId();
    valorDe(
      await m.salon.crearMesa(e.gerente, {
        mesaId,
        sucursalId: e.sucursal,
        numero: n,
        forma: "CUADRADA",
        tamano: "CHICA",
        columna: 1 + ((n - 1) % 7) * 2,
        fila: 1 + Math.floor((n - 1) / 7) * 2,
      }),
    );
    const cuentaId = valorDe(
      await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId }),
    ).cuentaId;
    const helado = await productoDeBase(m.dueno, e.empresa, { nombre: "Helado", paso: "0.5" });
    await m.precio({ empresa: e.empresa, producto: helado, precio, desde: DESDE });
    const lineaId = nuevoId();
    valorDe(
      await m.salon.agregarAlPedido(e.gerente, {
        cuentaId,
        lineaId,
        productoId: helado,
        opcionIds: [],
        cantidad,
      }),
    );
    return { cuentaId, lineaId };
  };
  const dividir = (
    e: EscenarioDeVentas,
    x: { cuentaId: string; lineaId: string },
    asignacion: Record<string, unknown>,
    sucursal: string = e.sucursal,
  ) =>
    dividirLaCuenta(d, e.gerente, sucursal, {
      divisionId: nuevoId(),
      cuentaId: x.cuentaId,
      partes: 2,
      asignaciones: [{ lineaId: x.lineaId, ...asignacion }],
    });
  const divisiones = (cuentaId: string) =>
    m.contar("select count(*) as n from division_de_cuenta where cuenta_madre_id = $1", [cuentaId]);

  it("DINERO: 2 kg a $ 1.000,01 por unidades (0,5 y 1,5) se rechaza con el genérico y no escribe nada: ni división ni cuentas hijas", async () => {
    const e = await m.escenario();
    const x = await mesaConHelado(e, "1000.01");
    const r = await dividir(e, x, { forma: "POR_UNIDADES", cantidades: ["0.5", "1.5"] });
    expect(r).toMatchObject(GENERICO);
    expect(await divisiones(x.cuentaId)).toBe(0);
  });

  it("DINERO: la misma línea compartida entre dos cuentas suma exacto: $ 1.000,01 y $ 1.000,01 (la línea vale $ 2.000,02)", async () => {
    const e = await m.escenario();
    const x = await mesaConHelado(e, "1000.01");
    const r = await dividir(e, x, { forma: "COMPARTIDO", partes: [1, 2] });
    expect(r).toMatchObject({ ok: true });
    const totales = (r.ok ? r.dato.cuentas : []).map((c) => c.total.monto);
    expect(totales).toEqual(["1000.01", "1000.01"]);
  });

  it("DINERO: media pizza (cantidad 0,5) a $ 1.000,01 compartida: el centavo va a la Cuenta 1 (250,01 y 250,00)", async () => {
    const e = await m.escenario();
    const x = await mesaConHelado(e, "1000.01", "0.5");
    const r = await dividir(e, x, { forma: "COMPARTIDO", partes: [1, 2] });
    expect(r).toMatchObject({ ok: true });
    expect((r.ok ? r.dato.cuentas : []).map((c) => c.total.monto)).toEqual(["250.01", "250.00"]);
  });

  it("a $ 1.000,00 el kilo (500,00 por paso) sí se reparte por unidades y las cuentas suman $ 2.000,00", async () => {
    const e = await m.escenario();
    const x = await mesaConHelado(e, "1000.00");
    const r = await dividir(e, x, { forma: "POR_UNIDADES", cantidades: ["0.5", "1.5"] });
    expect(r).toMatchObject({ ok: true });
    expect((r.ok ? r.dato.cuentas : []).map((c) => c.total.monto)).toEqual(["500.00", "1500.00"]);
  });

  it("AISLAMIENTO: otra sucursal recibe el genérico aunque el reparto sea exacto, y no escribe nada", async () => {
    const e = await m.escenario();
    const x = await mesaConHelado(e, "1000.00");
    const r = await dividir(e, x, { forma: "POR_UNIDADES", cantidades: ["0.5", "1.5"] }, nuevoId());
    expect(r).toMatchObject(GENERICO);
    expect(await divisiones(x.cuentaId)).toBe(0);
  });
});
