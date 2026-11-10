import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearConsultasDeVentas } from "../../src/modulos/ventas/publico";
import { montarVentas, valorDe, REGLAS_DE_PRUEBA, type MundoDeVentas } from "./ventas-apoyo";
import {
  crearFiscalDePrueba,
  escenarioFacturable,
  nuevaClaveDeFactura,
  receptorConsumidorFinal,
  ticketCobrado,
  type EscenarioDeFacturacionDeTickets,
} from "./ventas-facturar-apoyo";

/**
 * E1-T3: las consultas de ventas que alimentan la facturación — «Pendientes de facturar» y el ticket para facturar — con el facturador real:
 * «facturado» lo decide fiscal (un comprobante vigente, también «Confirmando», saca al ticket de la lista; uno rechazado o acreditado por
 * completo con notas AUTORIZADAS lo devuelve; una nota parcial o todavía sin autorizar no), y todo filtrado por empresa y por sucursal.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("ventas: pendientes de facturar y ticket para facturar", () => {
  let m: MundoDeVentas;
  let fiscal: ReturnType<typeof crearFiscalDePrueba>;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { facturacion: true });
    fiscal = crearFiscalDePrueba(m);
  });
  afterAll(async () => {
    await fiscal.cerrar();
    await m.cerrar();
  });

  async function preparar() {
    const e = await escenarioFacturable(m);
    const caja = await m.cajaAbierta(e);
    fiscal.adelantar();
    return { e, caja };
  }
  const facturar = async (e: EscenarioDeFacturacionDeTickets, ticketId: string) =>
    valorDe(
      await m.casos.emitirComprobanteDeTicket(
        { ...e.gerente, ahora: fiscal.reloj.ahora() },
        {
          ticketId,
          receptor: receptorConsumidorFinal(),
          puntoDeVentaId: e.pv,
          clave: nuevaClaveDeFactura(),
        },
      ),
    );
  const pendientes = async (
    e: EscenarioDeFacturacionDeTickets,
    entrada: Parameters<MundoDeVentas["consultas"]["ticketsPendientesDeFacturar"]>[1] = {},
    contexto = e.gerente,
  ) => valorDe(await m.consultas.ticketsPendientesDeFacturar(contexto, entrada)).tickets;
  const ids = (ts: readonly { ticketId: string }[]) => ts.map((t) => t.ticketId);

  it("un ticket cobrado sin comprobante está pendiente (SIN_COMPROBANTE); uno sin cobrar no", async () => {
    const { e, caja } = await preparar();
    const t = await ticketCobrado(m, e, caja);
    const cuenta = crypto.randomUUID();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal }));
    const lista = await pendientes(e);
    expect(lista).toEqual([
      expect.objectContaining({ ticketId: t.ticketId, motivo: "SIN_COMPROBANTE" }),
    ]);
    expect(lista[0]?.total).toEqual({ moneda: "ARS", monto: "1000.00" });
  });

  it("con un comprobante vigente (recién emitido, «Validando») el ticket sale de la lista", async () => {
    const { e, caja } = await preparar();
    const t = await ticketCobrado(m, e, caja);
    const otro = await ticketCobrado(m, e, caja);
    await facturar(e, t.ticketId);
    expect(ids(await pendientes(e))).toEqual([otro.ticketId]);
  });

  it("rechazado por ARCA, o acreditado por completo con notas AUTORIZADAS: vuelve como COMPROBANTE_ANULADO (y el filtro por motivo lo separa)", async () => {
    const { e, caja } = await preparar();
    const rechazado = await ticketCobrado(m, e, caja);
    const acreditado = await ticketCobrado(m, e, caja);
    const sin = await ticketCobrado(m, e, caja);
    const f1 = await facturar(e, rechazado.ticketId);
    fiscal.falsa.programar("RECHAZA");
    await fiscal.autorizar(e, f1.comprobanteId);
    const f2 = await facturar(e, acreditado.ticketId);
    await fiscal.autorizar(e, f2.comprobanteId);
    await fiscal.autorizar(e, await fiscal.notaDeCredito(e, f2.comprobanteId, "1000.00"));

    const todos = await pendientes(e);
    expect(Object.fromEntries(todos.map((t) => [t.ticketId, t.motivo]))).toEqual({
      [rechazado.ticketId]: "COMPROBANTE_ANULADO",
      [acreditado.ticketId]: "COMPROBANTE_ANULADO",
      [sin.ticketId]: "SIN_COMPROBANTE",
    });
    expect(ids(await pendientes(e, { motivo: "SIN_COMPROBANTE" }))).toEqual([sin.ticketId]);
    expect(
      (await pendientes(e, { motivo: "COMPROBANTE_ANULADO" })).map((t) => t.ticketId).sort(),
    ).toEqual([rechazado.ticketId, acreditado.ticketId].sort());
  });

  it("una nota parcial, o total pero todavía sin autorizar, no devuelve el ticket a la lista (DD-2)", async () => {
    const { e, caja } = await preparar();
    const t = await ticketCobrado(m, e, caja);
    const f = await facturar(e, t.ticketId);
    await fiscal.autorizar(e, f.comprobanteId);
    await fiscal.autorizar(e, await fiscal.notaDeCredito(e, f.comprobanteId, "400.00"));
    expect(await pendientes(e)).toEqual([]);
    await fiscal.notaDeCredito(e, f.comprobanteId, "600.00"); // «Validando»: no cuenta hasta que ARCA la autorice
    expect(await pendientes(e)).toEqual([]);
  });

  it("una empresa no ve los tickets de otra, y un operador solo los de sus sucursales", async () => {
    const a = await preparar();
    const b = await preparar();
    const deA = await ticketCobrado(m, a.e, a.caja);
    const cajaOtra = await m.cajaAbierta(a.e, { sucursal: a.e.otraSucursal });
    const deOtraSucursal = await ticketCobrado(m, { ...a.e, sucursal: a.e.otraSucursal }, cajaOtra);
    expect((await pendientes(a.e)).map((t) => t.ticketId).sort()).toEqual(
      [deA.ticketId, deOtraSucursal.ticketId].sort(),
    );
    expect(await pendientes(b.e)).toEqual([]);
    expect(ids(await pendientes(a.e, {}, a.e.operador))).toEqual([deA.ticketId]);
  });

  it("el ticket para facturar trae los renglones y el total cobrado; sin cobrar o ajeno, error", async () => {
    const a = await preparar();
    const b = await preparar();
    const t = await ticketCobrado(m, a.e, a.caja, "2");
    const ficha = valorDe(
      await m.consultas.ticketParaFacturar(a.e.gerente, { ticketId: t.ticketId }),
    );
    expect(ficha.total).toEqual({ moneda: "ARS", monto: "2000.00" });
    expect(ficha.lineas).toHaveLength(1);
    expect(ficha.lineas[0]).toMatchObject({
      cantidad: "2.0000",
      precioUnitario: "1000.000000",
      importe: "2000.00",
    });
    const r = await m.consultas.ticketParaFacturar(b.e.gerente, { ticketId: t.ticketId });
    expect(r.ok ? null : r.error).toBe("TICKET_NO_ENCONTRADO");
    const cuenta = crypto.randomUUID();
    valorDe(await m.casos.abrirCuenta(a.e.gerente, { cuentaId: cuenta, sucursalId: a.e.sucursal }));
    const sin = await m.consultas.ticketParaFacturar(a.e.gerente, { ticketId: cuenta });
    expect(sin.ok ? null : sin.error).toBe("TICKET_NO_ENCONTRADO");
  });

  it("sin facturador armado, la lista falla cerrada si hay un ticket con comprobante, en vez de adivinar", async () => {
    const { e, caja } = await preparar();
    const t = await ticketCobrado(m, e, caja);
    await facturar(e, t.ticketId);
    const sin = crearConsultasDeVentas({ transacciones: m.entorno, reglas: REGLAS_DE_PRUEBA });
    const r = await sin.ticketsPendientesDeFacturar(e.gerente, {});
    expect(r.ok ? null : r.error).toBe("FACTURACION_NO_DISPONIBLE");
  });
});
