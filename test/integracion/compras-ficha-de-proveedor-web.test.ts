import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  agregarUnComprobante,
  agregarUnPuntoDeVenta,
  dejarDeUsarUnPuntoDeVenta,
  pedirUnComprobante,
  pedirUnPuntoDeVenta,
  resolverUnPedido,
  verLaFichaDelProveedor,
  type DependenciasDeFichaDeProveedorWeb,
} from "../../src/composicion/ficha-de-proveedor-web";
import { crearConsultasDeClientes } from "../../src/modulos/clientes/publico";
import { nuevoId } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";

/**
 * Compras PR 4: la ficha del proveedor de compras para la pantalla (ver, editar y pedir), con una base real. Se prueba: que MIRAR no escribe (la ficha que no nació no se crea), el aislamiento por empresa
 * (un proveedor ajeno, o una parte que no es proveedor, es el genérico), la IDEMPOTENCIA (agregar dos veces el mismo punto de venta: uno solo y una sola auditoría; pedir dos veces: un pedido),
 * la CONCURRENCIA (dos resoluciones del mismo pedido a la vez: gana una y no se audita dos veces), la autorización (quien opera pide pero no edita) y que las facturas ya cargadas no cambian.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });
const noEsProveedor = (r: unknown) =>
  expect(r).toMatchObject({ ok: false, error: { codigo: "COMPRAS_PROVEEDOR_NO_ENCONTRADO" } });
const esGenerico = (r: unknown) =>
  expect(r).toMatchObject({ ok: false, error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" } });

describe.skipIf(base === null)("composición web: ficha del proveedor de compras", () => {
  let c: MontajeDeCompras;
  let d: DependenciasDeFichaDeProveedorWeb;
  const registrados: string[] = [];

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    const clientes = crearConsultasDeClientes({
      transacciones: c.entorno,
      reglas: REGLAS_DE_EMPRESA,
    });
    d = {
      consultas: () => c.consultas,
      consultasDeClientes: () => clientes,
      casosDeUso: () => c.casos,
      respuesta: { registrar: (x) => registrados.push(x) },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const fichas = (e: EscenarioDeCompras) =>
    c.contar("SELECT count(*) AS n FROM ficha_de_compra_del_proveedor WHERE empresa_id = $1", [
      e.empresa,
    ]);
  const auditorias = async (e: EscenarioDeCompras, accion: string) =>
    (await c.auditoria(e.empresa, accion)).length;
  const ver = async (quien: EscenarioDeCompras["gerente"], parteId: string) => {
    const r = await verLaFichaDelProveedor(d, quien, parteId);
    if (!r.ok) throw new Error(`la ficha tenía que salir: ${JSON.stringify(r.error)}`);
    return r.dato;
  };

  it("mirar NO escribe: la ficha que todavía no nació se ve vacía y no se crea", async () => {
    const e = await c.escenario();
    const proveedor = await c.proveedor(e.operador);
    const antes = await fichas(e);
    const f = await ver(e.operador, proveedor);
    expect(f).toMatchObject({
      parteId: proveedor,
      puntosDeVenta: [],
      comprobantes: [],
      pedidosPendientes: [],
      queLeCompramos: [],
      facturas: [],
      puntoDeVentaMaximo: 99998,
    });
    expect(f.tiposDeComprobante).toHaveLength(9);
    await ver(e.operador, proveedor);
    expect(await fichas(e)).toBe(antes);
  });

  it("aislamiento: un proveedor de otra empresa, uno inexistente y una parte que no es proveedor son el mismo genérico", async () => {
    const una = await c.escenario();
    const otra = await c.escenario();
    const ajeno = await c.proveedor(otra.operador);
    // El mismo error para el proveedor de otra empresa y el inexistente: no se distingue cuál de los dos es.
    noEsProveedor(await verLaFichaDelProveedor(d, una.operador, ajeno));
    noEsProveedor(await verLaFichaDelProveedor(d, una.operador, nuevoId()));
    esGenerico(await verLaFichaDelProveedor(d, una.operador, "no-es-un-id"));
    noEsProveedor(await agregarUnPuntoDeVenta(d, una.gerente, { parteId: ajeno, numero: 7 }));
    expect(await auditorias(una, "FICHA_PUNTO_DE_VENTA_AGREGADO")).toBe(0);
    expect(await auditorias(otra, "FICHA_PUNTO_DE_VENTA_AGREGADO")).toBe(0);
  });

  it("IDEMPOTENCIA: agregar el mismo punto de venta dos veces a la vez deja uno solo y una sola auditoría; la repetición tardía tampoco escribe", async () => {
    const e = await c.escenario();
    const proveedor = await c.proveedor(e.operador);
    const pedido = { parteId: proveedor, numero: 7 };
    const [a, b] = await Promise.all([
      agregarUnPuntoDeVenta(d, e.gerente, pedido),
      agregarUnPuntoDeVenta(d, e.gerente, pedido),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const yaEstaba = [a, b].map((r) => (r.ok ? r.dato.yaEstaba : null));
    expect(yaEstaba.filter((x) => x === false)).toHaveLength(1);
    expect(await agregarUnPuntoDeVenta(d, e.gerente, pedido)).toMatchObject({
      ok: true,
      dato: { yaEstaba: true },
    });
    expect((await ver(e.gerente, proveedor)).puntosDeVenta).toEqual([7]);
    expect(await auditorias(e, "FICHA_PUNTO_DE_VENTA_AGREGADO")).toBe(1);
  });

  it("dejar de usar un punto de venta lo saca de la ficha, una sola vez; las facturas ya cargadas no cambian", async () => {
    const e = await c.escenario();
    const proveedor = await c.proveedor(e.operador);
    await agregarUnPuntoDeVenta(d, e.gerente, { parteId: proveedor, numero: 5 });
    await agregarUnPuntoDeVenta(d, e.gerente, { parteId: proveedor, numero: 9 });
    const facturasAntes = await c.contar(
      "SELECT count(*) AS n FROM comprobante_de_proveedor WHERE empresa_id = $1",
      [e.empresa],
    );
    const [a, b] = await Promise.all([
      dejarDeUsarUnPuntoDeVenta(d, e.gerente, { parteId: proveedor, numero: 5 }),
      dejarDeUsarUnPuntoDeVenta(d, e.gerente, { parteId: proveedor, numero: 5 }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect((await ver(e.gerente, proveedor)).puntosDeVenta).toEqual([9]);
    expect(await auditorias(e, "FICHA_PUNTO_DE_VENTA_APAGADO")).toBe(1);
    expect(
      await c.contar("SELECT count(*) AS n FROM comprobante_de_proveedor WHERE empresa_id = $1", [
        e.empresa,
      ]),
    ).toBe(facturasAntes);
  });

  it("agregar un comprobante lo suma a la ficha; un tipo inventado o un número fuera de rango es el genérico y no escribe", async () => {
    const e = await c.escenario();
    const proveedor = await c.proveedor(e.operador);
    expect(
      await agregarUnComprobante(d, e.administrador, { parteId: proveedor, tipo: "FACTURA_A" }),
    ).toMatchObject({ ok: true, dato: { yaEstaba: false } });
    expect((await ver(e.administrador, proveedor)).comprobantes).toEqual(["FACTURA_A"]);
    esGenerico(await agregarUnComprobante(d, e.gerente, { parteId: proveedor, tipo: "OTRO" }));
    esGenerico(await agregarUnPuntoDeVenta(d, e.gerente, { parteId: proveedor, numero: 0 }));
    esGenerico(await agregarUnPuntoDeVenta(d, e.gerente, { parteId: proveedor, numero: 99999 }));
    esGenerico(
      await agregarUnPuntoDeVenta(d, e.gerente, {
        parteId: proveedor,
        numero: 3,
        empresaId: nuevoId(),
      }),
    );
    expect(await auditorias(e, "FICHA_COMPROBANTE_AGREGADO")).toBe(1);
    expect(await auditorias(e, "FICHA_PUNTO_DE_VENTA_AGREGADO")).toBe(0);
  });

  it("quien opera PIDE pero no edita: el pedido queda pendiente, pedir dos veces es un pedido, y editar o resolver es rechazado", async () => {
    const e = await c.escenario();
    const proveedor = await c.proveedor(e.operador);
    expect((await agregarUnPuntoDeVenta(d, e.operador, { parteId: proveedor, numero: 7 })).ok).toBe(
      false,
    );
    const [a, b] = await Promise.all([
      pedirUnPuntoDeVenta(d, e.operador, { parteId: proveedor, numero: 7 }),
      pedirUnPuntoDeVenta(d, e.operador, { parteId: proveedor, numero: 7 }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(
      await pedirUnComprobante(d, e.operador, { parteId: proveedor, tipo: "FACTURA_B" }),
    ).toMatchObject({ ok: true });
    const f = await ver(e.operador, proveedor);
    expect(f.puntosDeVenta).toEqual([]);
    expect(f.pedidosPendientes.map((p) => [p.objeto, p.valor]).sort()).toEqual([
      ["COMPROBANTE", "FACTURA_B"],
      ["PUNTO_DE_VENTA", "7"],
    ]);
    expect(await auditorias(e, "FICHA_PEDIDO_CREADO")).toBe(2);
    const pedido = f.pedidosPendientes[0]?.id ?? "";
    expect(
      (await resolverUnPedido(d, e.operador, { pedidoId: pedido, decision: "APROBAR" })).ok,
    ).toBe(false);
    expect((await ver(e.gerente, proveedor)).pedidosPendientes).toHaveLength(2);
  });

  it("CONCURRENCIA: aprobar y rechazar el mismo pedido a la vez: gana uno, el otro es el genérico, y se audita una sola resolución", async () => {
    const e = await c.escenario();
    const proveedor = await c.proveedor(e.operador);
    await pedirUnPuntoDeVenta(d, e.operador, { parteId: proveedor, numero: 11 });
    const pedido = (await ver(e.gerente, proveedor)).pedidosPendientes[0]?.id ?? "";
    const [aprobar, rechazar] = await Promise.all([
      resolverUnPedido(d, e.gerente, { pedidoId: pedido, decision: "APROBAR" }),
      resolverUnPedido(d, e.administrador, { pedidoId: pedido, decision: "RECHAZAR" }),
    ]);
    expect([aprobar.ok, rechazar.ok].filter(Boolean)).toHaveLength(1);
    esGenerico(aprobar.ok ? rechazar : aprobar);
    const f = await ver(e.gerente, proveedor);
    expect(f.pedidosPendientes).toEqual([]);
    expect(f.puntosDeVenta).toEqual(aprobar.ok ? [11] : []);
    expect(
      (await auditorias(e, "FICHA_PEDIDO_APROBADO")) +
        (await auditorias(e, "FICHA_PEDIDO_RECHAZADO")),
    ).toBe(1);
  });

  it("aprobar un pedido ya aprobado (doble toque) no escribe ni audita de nuevo", async () => {
    const e = await c.escenario();
    const proveedor = await c.proveedor(e.operador);
    await pedirUnComprobante(d, e.operador, { parteId: proveedor, tipo: "FACTURA_C" });
    const pedido = (await ver(e.gerente, proveedor)).pedidosPendientes[0]?.id ?? "";
    const dos = { pedidoId: pedido, decision: "APROBAR" } as const;
    expect(await resolverUnPedido(d, e.gerente, dos)).toMatchObject({
      ok: true,
      dato: { yaEstaba: false },
    });
    expect(await resolverUnPedido(d, e.gerente, dos)).toMatchObject({
      ok: true,
      dato: { yaEstaba: true },
    });
    expect((await ver(e.gerente, proveedor)).comprobantes).toEqual(["FACTURA_C"]);
    expect(await auditorias(e, "FICHA_PEDIDO_APROBADO")).toBe(1);
  });
});
