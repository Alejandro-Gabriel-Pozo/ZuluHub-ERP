import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  emitirDesdeTicket,
  listarPendientesDeFacturar,
  ticketParaEmitir,
  type DependenciasDeFacturarTicketsWeb,
} from "../../src/composicion/facturar-tickets-web";
import { montarVentas, valorDe, type MundoDeVentas } from "./ventas-apoyo";
import {
  crearFiscalDePrueba,
  escenarioFacturable,
  nuevaClaveDeFactura,
  receptorConsumidorFinal,
  ticketCobrado,
} from "./ventas-facturar-apoyo";

/**
 * E1-T4: las acciones de la web para facturar un ticket (`facturar-tickets-web.ts`) con los casos de uso reales, el facturador real y una base
 * real. Cubre: lo único que sale es la lista blanca de cada pantalla, el pedido del navegador no manda empresa ni persona (se descarta), repetir
 * o facturar a la vez da el mismo comprobante, los errores sin texto aprobado salen como inesperados con su referencia y sin detalle, y la
 * forma inválida no escribe nada.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("web: facturar un ticket", () => {
  let m: MundoDeVentas;
  let fiscal: ReturnType<typeof crearFiscalDePrueba>;
  const registrados: string[] = [];
  let d: DependenciasDeFacturarTicketsWeb;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { facturacion: true });
    fiscal = crearFiscalDePrueba(m);
    d = {
      casosDeUso: () => m.casos,
      consultas: () => m.consultas,
      respuesta: { registrar: (detalle) => void registrados.push(detalle) },
    };
  });
  afterAll(async () => {
    await fiscal.cerrar();
    await m.cerrar();
  });

  async function preparar() {
    const e = await escenarioFacturable(m);
    const caja = await m.cajaAbierta(e);
    const t = await ticketCobrado(m, e, caja);
    fiscal.adelantar();
    return { e, t, ahora: () => fiscal.reloj.ahora() };
  }
  const pedido = (
    p: Awaited<ReturnType<typeof preparar>>,
    cambios: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    ticketId: p.t.ticketId,
    puntoDeVentaId: p.e.pv,
    clave: nuevaClaveDeFactura(),
    receptor: receptorConsumidorFinal(),
    ...cambios,
  });
  const comprobantes = (empresa: string) =>
    m.contar("select count(*) as n from comprobante where empresa_id = $1", [empresa]);

  it("emitir devuelve solo la lista blanca (ticket, comprobante, estado, yaExistia)", async () => {
    const p = await preparar();
    const r = await emitirDesdeTicket(d, { ...p.e.gerente, ahora: p.ahora() }, pedido(p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.dato).sort()).toEqual([
      "comprobanteId",
      "estado",
      "ticketId",
      "yaExistia",
    ]);
    expect(r.dato).toMatchObject({ ticketId: p.t.ticketId, estado: "PENDIENTE", yaExistia: false });
  });

  it("la misma clave repetida, o otra persona que factura el mismo ticket, devuelve el mismo comprobante sin escribir de más", async () => {
    const p = await preparar();
    const contexto = { ...p.e.gerente, ahora: p.ahora() };
    const clave = nuevaClaveDeFactura();
    const a = await emitirDesdeTicket(d, contexto, pedido(p, { clave }));
    const b = await emitirDesdeTicket(d, contexto, pedido(p, { clave }));
    const c = await emitirDesdeTicket(d, { ...p.e.administrador, ahora: p.ahora() }, pedido(p));
    if (!a.ok || !b.ok || !c.ok) throw new Error("tenían que ser éxitos");
    expect(b.dato).toEqual({ ...a.dato, estado: null, yaExistia: true });
    expect(c.dato.comprobanteId).toBe(a.dato.comprobanteId);
    expect(c.dato.yaExistia).toBe(true);
    expect(await comprobantes(p.e.empresa)).toBe(1);
  });

  it("el navegador no manda empresa ni persona: lo que el pedido traiga de más se descarta", async () => {
    const p = await preparar();
    const otra = await preparar();
    const r = await emitirDesdeTicket(
      d,
      { ...p.e.gerente, ahora: p.ahora() },
      pedido(p, { empresaId: otra.e.empresa, personaId: otra.e.personaDelOperador }),
    );
    expect(r.ok).toBe(true);
    expect(await comprobantes(p.e.empresa)).toBe(1);
    expect(await comprobantes(otra.e.empresa)).toBe(0);
  });

  it("un pedido con forma inválida es FISCAL_DATOS_INVALIDOS con el campo y no escribe nada", async () => {
    const p = await preparar();
    const contexto = { ...p.e.gerente, ahora: p.ahora() };
    for (const [cambios, campo] of [
      [{ ticketId: "no-es-un-uuid" }, "ticketId"],
      [{ clave: 7 }, "clave"],
      [{ puntoDeVentaId: undefined }, "puntoDeVentaId"],
      [{ receptor: "consumidor final" }, "receptor"],
    ] as const) {
      const r = await emitirDesdeTicket(d, contexto, pedido(p, cambios));
      expect(r.ok ? null : r.error.codigo, JSON.stringify(cambios)).toBe("FISCAL_DATOS_INVALIDOS");
      expect(r.ok ? null : r.error.campo, JSON.stringify(cambios)).toBe(campo);
    }
    expect(await comprobantes(p.e.empresa)).toBe(0);
  });

  it("un punto de venta de otra sucursal sale como error inesperado, sin el nombre del error ni detalle", async () => {
    const p = await preparar();
    const r = await emitirDesdeTicket(
      d,
      { ...p.e.gerente, ahora: p.ahora() },
      pedido(p, { puntoDeVentaId: p.e.pvDeOtraSucursal }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.codigo).toBe("ERROR_INTERNO");
    expect(r.error.referencia).toMatch(/^PD-/);
    expect(JSON.stringify(r)).not.toMatch(/OTRA_SUCURSAL|FACTURACION_FALLIDA/);
    expect(await comprobantes(p.e.empresa)).toBe(0);
  });

  it("un ticket de otra empresa sale como inesperado y no filtra si existe", async () => {
    const p = await preparar();
    const otra = await preparar();
    const r = await emitirDesdeTicket(
      d,
      { ...otra.e.gerente, ahora: otra.ahora() },
      pedido(otra, { ticketId: p.t.ticketId }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.codigo).toBe("ERROR_INTERNO");
    expect(JSON.stringify(r)).not.toContain(p.t.ticketId);
  });

  it("la lista de pendientes y el ticket para emitir salen con su lista blanca", async () => {
    const p = await preparar();
    const lista = await listarPendientesDeFacturar(d, p.e.gerente, {});
    if (!lista.ok) throw new Error("tenía que ser un éxito");
    expect(lista.dato.siguiente).toBeNull();
    expect(lista.dato.tickets).toHaveLength(1);
    expect(Object.keys(lista.dato.tickets[0] ?? {}).sort()).toEqual([
      "cobradoEn",
      "fechaNegocio",
      "motivo",
      "numero",
      "numeroDeCorreccion",
      "sucursalId",
      "ticketId",
      "total",
    ]);
    expect(lista.dato.tickets[0]?.cobradoEn).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const ficha = await ticketParaEmitir(d, p.e.gerente, { ticketId: p.t.ticketId });
    if (!ficha.ok) throw new Error("tenía que ser un éxito");
    expect(ficha.dato.total).toEqual({ moneda: "ARS", monto: "1000.00" });
    expect(Object.keys(ficha.dato.lineas[0] ?? {}).sort()).toEqual([
      "cantidad",
      "descripcion",
      "importe",
      "opciones",
      "precioUnitario",
      "unidadSimbolo",
      "varianteNombre",
    ]);
  });

  it("los pedidos con forma inválida de la lista y del ticket no consultan nada", async () => {
    const p = await preparar();
    const a = await listarPendientesDeFacturar(d, p.e.gerente, { sucursalId: "x" });
    expect(a.ok ? null : a.error.codigo).toBe("FISCAL_DATOS_INVALIDOS");
    const b = await listarPendientesDeFacturar(d, p.e.gerente, { limite: -1 });
    expect(b.ok ? null : b.error.codigo).toBe("FISCAL_DATOS_INVALIDOS");
    const c = await ticketParaEmitir(d, p.e.gerente, { ticketId: 5 });
    expect(c.ok ? null : c.error.codigo).toBe("FISCAL_DATOS_INVALIDOS");
    valorDe(await m.consultas.ticketParaFacturar(p.e.gerente, { ticketId: p.t.ticketId }));
  });
});
