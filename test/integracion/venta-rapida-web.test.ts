import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearConsultasDeCatalogo } from "../../src/modulos/catalogo/publico";
import {
  cargarVentaRapida,
  cotizarElCarrito,
  type DependenciasDeVentaRapidaWeb,
} from "../../src/composicion/venta-rapida-web";
import type { Respuesta } from "../../src/capacidades/experiencia/respuesta";
import {
  REGLAS_DE_PRUEBA,
  montarVentas,
  nuevoId,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * La composición de la venta rápida (mostrador) con la base real y las consultas reales de catálogo y ventas: la lista y el total que ve la pantalla.
 *  - Aislamiento: por empresa (lo de otra no se ve ni se cotiza) y por sucursal (la que fija el servidor; ajena, vacía o inexistente es el genérico, nunca «todas»).
 *  - Autorización en el servidor: sin sesión de persona, el motivo del guard; un operador solo opera su sucursal.
 *  - Producto oculto, inactivo o de otra empresa: no se ofrece ni se cotiza; el pedido NO puede traer el precio ni la sucursal.
 *  - Dinero como texto decimal con moneda; cotizar dos veces (y a la vez) da lo mismo; la lectura no escribe ni audita.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

const GENERICO = { codigo: "VENTAS_ACCION_NO_PERMITIDA" };
const motivo = (r: Respuesta<unknown>) => (r.ok ? "ok" : r.error.codigo);

describe.skipIf(base === null)("venta rápida web: lista y cotización contra la base real", () => {
  let m: MundoDeVentas;
  let e: EscenarioDeVentas;
  let otra: EscenarioDeVentas;
  let d: DependenciasDeVentaRapidaWeb;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base);
    e = await m.escenario();
    otra = await m.escenario();
    const catalogo = crearConsultasDeCatalogo({
      transacciones: m.entorno,
      reglas: REGLAS_DE_PRUEBA,
    });
    d = {
      consultasDeCatalogo: () => catalogo,
      consultasDeVentas: () => m.consultas,
      respuesta: { registrar: () => undefined, azar: () => new Uint8Array([1, 2, 3, 4]) },
    };
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  const cargar = (c: EscenarioDeVentas["gerente"], sucursal: string) =>
    cargarVentaRapida(d, c, sucursal);
  const cotizar = (c: EscenarioDeVentas["gerente"], sucursal: string, crudo: unknown) =>
    cotizarElCarrito(d, c, sucursal, crudo);
  const carrito = (productoId: string, cantidad = "1", extra: Record<string, unknown> = {}) => ({
    lineas: [{ productoId, opcionIds: [], cantidad, ...extra }],
  });
  const ocultar = (producto: string, sucursal: string | null) =>
    m.dueno.query(
      "insert into disponibilidad_de_producto (empresa_id, producto_id, sucursal_id, oculto, actualizado_por, actualizado_en) values ($1, $2, $3, true, null, now())",
      [e.empresa, producto, sucursal],
    );

  it("W1: ofrece lo de la sucursal con el dinero como texto y solo los campos de la lista blanca", async () => {
    const r = await cargar(e.operador, e.sucursal);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.dato.incompleta).toBe(false);
    const p = r.dato.productos.find((x) => x.id === e.producto);
    expect(p?.precio).toEqual({ tipo: "BASE", importe: "1000.000000" });
    expect(Object.keys(p ?? {}).sort()).toEqual(
      [
        "grupos",
        "id",
        "nombre",
        "pasoMinimo",
        "porcionesOfrecidas",
        "precio",
        "seccionId",
        "unidadDeVentaId",
        "variante",
      ].sort(),
    );
    expect(Object.keys(r.dato).sort()).toEqual(["incompleta", "productos", "secciones"]);
  });

  it("W2: aislamiento por empresa: lo de otra empresa no se ve ni se cotiza, ni pidiendo su sucursal", async () => {
    const r = await cargar(e.gerente, e.sucursal);
    if (!r.ok) throw new Error("se esperaba ok");
    expect(r.dato.productos.map((p) => p.id)).not.toContain(otra.producto);
    expect(await cargar(e.gerente, otra.sucursal)).toMatchObject({ ok: false, error: GENERICO });
    expect(await cotizar(e.gerente, e.sucursal, carrito(otra.producto))).toMatchObject({
      ok: false,
      error: GENERICO,
    });
  });

  it("W3: aislamiento por sucursal: sin sucursal, ajena al alcance o inexistente es el genérico (nunca «todas»)", async () => {
    for (const mala of ["", nuevoId(), "todas"]) {
      expect(await cargar(e.gerente, mala)).toMatchObject({ ok: false, error: GENERICO });
      expect(await cotizar(e.gerente, mala, carrito(e.producto))).toMatchObject({
        ok: false,
        error: GENERICO,
      });
    }
    // El operador solo opera la suya.
    expect(await cargar(e.operador, e.otraSucursal)).toMatchObject({ ok: false, error: GENERICO });
    expect(await cotizar(e.operador, e.otraSucursal, carrito(e.producto))).toMatchObject({
      ok: false,
      error: GENERICO,
    });
    expect(motivo(await cargar(e.operador, e.sucursal))).toBe("ok");
  });

  it("W4: autorización en el servidor: sin sesión de persona sale el motivo del guard y ningún dato", async () => {
    const sinPersona = { ...e.gerente, personaId: null };
    const l = await cargar(sinPersona, e.sucursal);
    const c = await cotizar(sinPersona, e.sucursal, carrito(e.producto));
    for (const r of [l, c]) {
      expect(r.ok).toBe(false);
      expect(motivo(r)).toMatch(/^MODULO_|^SIN_/);
      expect(JSON.stringify(r)).not.toContain(e.producto);
    }
  });

  it("W5: el total sale del servidor, con su moneda; repetirlo y pedirlo a la vez da lo mismo; el pedido no puede traer el precio ni la sucursal", async () => {
    const pedido = {
      lineas: [
        { productoId: e.producto, opcionIds: [], cantidad: "3" },
        { productoId: e.producto, opcionIds: [], cantidad: "2" },
      ],
    };
    const directa = await m.consultas.cotizarVentaRapida(e.operador, {
      sucursalId: e.sucursal,
      lineas: pedido.lineas,
    });
    const r = await cotizar(e.operador, e.sucursal, pedido);
    if (!r.ok || !directa.ok) throw new Error("se esperaba ok");
    expect(r.dato.total).toEqual({ moneda: "ARS", monto: "5000.00" });
    expect(r.dato.total).toEqual(directa.valor.total);
    expect(r.dato.lineas.map((l) => l.importe.monto)).toEqual(["3000.00", "2000.00"]);
    // Dos veces y a la vez: lo mismo.
    const todas = await Promise.all(
      Array.from({ length: 8 }, () => cotizar(e.operador, e.sucursal, pedido)),
    );
    for (const x of todas) expect(x).toEqual(r);
    // El navegador no manda precios ni sucursales: lo que traiga de más se descarta.
    const tramposo = {
      sucursalId: otra.sucursal,
      empresaId: otra.empresa,
      total: "1.00",
      lineas: pedido.lineas.map((l) => ({ ...l, precioUnitario: "1", importe: "1" })),
    };
    expect(await cotizar(e.operador, e.sucursal, tramposo)).toEqual(r);
  });

  it("W6: un precio abierto escrito para un producto que ya tiene precio se rechaza; entradas mal formadas y cantidades inválidas, el genérico", async () => {
    for (const crudo of [
      carrito(e.producto, "1", { precioAbierto: "1.00" }),
      carrito(e.producto, "0"),
      carrito(e.producto, "-1"),
      carrito(e.producto, "abc"),
      { lineas: [{ productoId: "no-uuid", opcionIds: [], cantidad: "1" }] },
      { lineas: "x" },
      null,
    ])
      expect(await cotizar(e.operador, e.sucursal, crudo)).toMatchObject({
        ok: false,
        error: GENERICO,
      });
  });

  it("W7: oculto (por la empresa o por el local) e inactivo no se ofrecen ni se cotizan; en otro local sí", async () => {
    const enLocal = await m.productoVendible(e.empresa, "50");
    const enEmpresa = await m.productoVendible(e.empresa, "60");
    const inactivo = await m.productoVendible(e.empresa, "70", { activo: false });
    await ocultar(enLocal, e.sucursal);
    await ocultar(enEmpresa, null);
    const lista = await cargar(e.gerente, e.sucursal);
    if (!lista.ok) throw new Error("se esperaba ok");
    const ids = lista.dato.productos.map((p) => p.id);
    for (const no of [enLocal, enEmpresa, inactivo]) {
      expect(ids).not.toContain(no);
      expect(await cotizar(e.gerente, e.sucursal, carrito(no))).toMatchObject({
        ok: false,
        error: GENERICO,
      });
    }
    // Oculto en UN local no toca al otro.
    const enOtra = await cargar(e.gerente, e.otraSucursal);
    if (!enOtra.ok) throw new Error("se esperaba ok");
    expect(enOtra.dato.productos.map((p) => p.id)).toContain(enLocal);
    expect(enOtra.dato.productos.map((p) => p.id)).not.toContain(enEmpresa);
  });

  it("W8: ninguna de las dos lecturas escribe ni audita", async () => {
    const huella = async () =>
      JSON.stringify([
        await m.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
          e.empresa,
        ]),
        await m.contar("select count(*) as n from cuenta_consumo where empresa_id = $1", [
          e.empresa,
        ]),
        await m.contar("select count(*) as n from producto where empresa_id = $1", [e.empresa]),
      ]);
    const antes = await huella();
    await cargar(e.gerente, e.sucursal);
    await cotizar(e.gerente, e.sucursal, carrito(e.producto, "2"));
    expect(await huella()).toBe(antes);
  });
});
