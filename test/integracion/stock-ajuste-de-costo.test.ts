import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  crearAjusteDeCostoPorOrigen,
  type EntradaDeAjusteDeCosto,
} from "../../src/modulos/stock/publico";
import { nuevoId } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";

/**
 * E9-T11 (puerto de stock): el ajuste de costo por origen en sí, con sus defensas (forma de lo que llega, depósito y artículo que existen, módulo activo) y
 * que escribe el estado de costo y deja su auditoría. El uso real (corregir una compra) lo prueba `compras-correcciones.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("stock: ajuste de costo por origen", () => {
  let c: MontajeDeCompras;
  let e: EscenarioDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const ajustar = (contexto: typeof e.gerente, entrada: unknown) => {
    const puerto = crearAjusteDeCostoPorOrigen({ reglas: c.reglas });
    return c.entorno.ejecutar({ contexto }, (tx) =>
      puerto.ajustar(tx, contexto, entrada as EntradaDeAjusteDeCosto),
    );
  };
  const montaje = async () => {
    const deposito = await c.deposito(e);
    const { producto, articulo } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador);
    return { deposito, producto, articulo, proveedor };
  };
  const base1 = (m: { deposito: string; producto: string }): EntradaDeAjusteDeCosto => ({
    origen: { tipo: "CORRECCION_DE_COMPRA", id: nuevoId() },
    depositoId: m.deposito,
    productoId: m.producto,
    costoAnterior: "1.000000",
    costoNuevo: "1.200000",
    cantidadQueEntro: "2000",
  });
  const codigo = (r: { ok: boolean; error?: unknown }) => (r.ok ? "OK" : JSON.stringify(r.error));

  it("con lo que entró todavía en el depósito, corrige el promedio y deja el antes y el después en la auditoría", async () => {
    const m = await montaje();
    const entrada = await c.casos.registrarCompra(e.operador, {
      clave: nuevoId(),
      sucursalId: e.sucursal,
      proveedorId: m.proveedor,
      depositoId: m.deposito,
      renglones: [
        {
          productoId: m.producto,
          unidadDeCompraId: "KILOGRAMO",
          cantidad: "2",
          precioPor: "UNIDAD",
          unidadDePrecioId: "KILOGRAMO",
          precio: "1000",
        },
      ],
    });
    expect(entrada.ok).toBe(true);
    const r = await ajustar(e.gerente, base1(m));
    expect(r).toEqual({
      ok: true,
      valor: { costoAntes: "1.000000", costoDespues: "1.200000", cantidadQueQueda: "2000.0000" },
    });
    const [par] = await c.filas<{ costo: string }>(
      "select costo_unitario::text as costo from costo_de_articulo where deposito_id = $1 and articulo_id = $2",
      [m.deposito, m.articulo],
    );
    expect(par?.costo).toBe("1.200000");
    expect(
      await c.filas(
        "select antes, despues from auditoria_empresa where accion = 'COSTO_AJUSTADO' and entidad_id = $1",
        [m.articulo],
      ),
    ).toEqual([
      {
        antes: { costoUnitario: "1.000000" },
        despues: expect.objectContaining({
          costoDespues: "1.200000",
          depositoId: m.deposito,
        }) as unknown,
      },
    ]);
  });

  it("sin nada que corregir (el depósito no tiene existencia) no escribe el estado pero deja la constancia", async () => {
    const m = await montaje();
    const r = await ajustar(e.gerente, base1(m));
    expect(r).toEqual({
      ok: true,
      valor: { costoAntes: null, costoDespues: null, cantidadQueQueda: "0.0000" },
    });
    expect(
      await c.contar("select count(*) as n from costo_de_articulo where deposito_id = $1", [
        m.deposito,
      ]),
    ).toBe(0);
  });

  it("lo que llega con otra forma se rechaza sin escribir: ids, costos y cantidad", async () => {
    const m = await montaje();
    const bueno = base1(m);
    const casos: [Record<string, unknown>, string][] = [
      [{ origen: { tipo: "OTRO", id: nuevoId() } }, '"IDENTIFICADOR_INVALIDO"'],
      [{ origen: { tipo: "CORRECCION_DE_COMPRA", id: "no" } }, '"IDENTIFICADOR_INVALIDO"'],
      [{ depositoId: "no" }, '"IDENTIFICADOR_INVALIDO"'],
      [{ productoId: 7 }, '"IDENTIFICADOR_INVALIDO"'],
      [{ costoNuevo: "0" }, '"COSTO_INVALIDO"'],
      [{ costoNuevo: 1.2 }, '"COSTO_INVALIDO"'],
      [{ costoAnterior: "-1" }, '"COSTO_INVALIDO"'],
      [{ cantidadQueEntro: "0" }, '"CANTIDAD_INVALIDA"'],
      [{ cantidadQueEntro: "abc" }, '"CANTIDAD_INVALIDA"'],
      [{ cantidadQueEntro: 5 }, '"CANTIDAD_INVALIDA"'],
      [{ productoId: nuevoId() }, '"ARTICULO_NO_CONTROLADO"'],
      [{ depositoId: nuevoId() }, '"DEPOSITO_NO_ENCONTRADO"'],
    ];
    for (const [cambio, esperado] of casos) {
      expect(
        codigo(await ajustar(e.gerente, { ...bueno, ...cambio })),
        JSON.stringify(cambio),
      ).toBe(esperado);
    }
  });

  it("con el módulo de stock apagado devuelve su motivo, y el sistema (sin persona) no puede", async () => {
    const m = await montaje();
    // Sin persona no hay quién deje constancia: falla cerrado (al sistema ni siquiera se le habilita el módulo).
    expect((await ajustar({ ...e.gerente, personaId: null }, base1(m))).ok).toBe(false);
    c.apagarModulo("stock");
    try {
      expect(codigo(await ajustar(e.gerente, base1(m)))).toBe('"MODULO_NO_ACTIVO"');
    } finally {
      c.encenderModulo("stock");
    }
  });
});
