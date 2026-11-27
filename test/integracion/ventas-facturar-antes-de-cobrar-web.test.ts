import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  emitirDesdeTicket,
  listarPendientesDeFacturar,
  ticketParaEmitir,
  type DependenciasDeFacturarTicketsWeb,
} from "../../src/composicion/facturar-tickets-web";
import { ajustarPerilla } from "./marcas-apoyo";
import { cuentaConLinea, montarVentas, nuevoId, valorDe, type MundoDeVentas } from "./ventas-apoyo";
import {
  crearFiscalDePrueba,
  escenarioFacturable,
  nuevaClaveDeFactura,
  receptorConsumidorFinal,
  type EscenarioDeFacturacionDeTickets,
} from "./ventas-facturar-apoyo";

/**
 * R-05c: la web de facturar un ticket (`facturar-tickets-web.ts`) con la perilla `facturar_antes_de_cobrar`, base real y rol de la aplicación. Con la perilla apagada
 * un ticket emitido sin cobrar no se lista ni se ofrece para emitir; encendida, se lista (con `cobradoEn` nulo), «Emitir desde ese ticket» lo ofrece (lo decide
 * `ticketParaFacturar`, que lee la perilla) y se factura sin cambiarle el estado. Previene: una pantalla que ofrezca lo que la emisión rechaza, o que no ofrezca lo permitido.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("web: facturar antes de cobrar", () => {
  let m: MundoDeVentas;
  let fiscal: ReturnType<typeof crearFiscalDePrueba>;
  let d: DependenciasDeFacturarTicketsWeb;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { facturacion: true });
    fiscal = crearFiscalDePrueba(m);
    d = {
      casosDeUso: () => m.casos,
      consultas: () => m.consultas,
      respuesta: { registrar: () => undefined },
    };
  });
  afterAll(async () => {
    await fiscal.cerrar();
    await m.cerrar();
  });

  async function preparar(perillaEncendida: boolean) {
    const e = await escenarioFacturable(m);
    if (perillaEncendida) {
      const fila = (
        await m.filas<{ tenant_id: string }>("select tenant_id from empresa where id = $1", [
          e.empresa,
        ])
      )[0];
      await ajustarPerilla(m.dueno, String(fila?.tenant_id), "facturar_antes_de_cobrar", "1", {
        empresa: e.empresa,
      });
    }
    const { cuenta } = await cuentaConLinea(m, e);
    const t = valorDe(
      await m.casos.cerrarCuenta(e.gerente, { cuentaId: cuenta, ejemplarId: nuevoId() }),
    );
    fiscal.adelantar();
    return { e, t, contexto: { ...e.gerente, ahora: fiscal.reloj.ahora() } };
  }
  type Preparado = Awaited<ReturnType<typeof preparar>>;
  const pedido = (e: EscenarioDeFacturacionDeTickets, ticketId: string) => ({
    ticketId,
    puntoDeVentaId: e.pv,
    clave: nuevaClaveDeFactura(),
    receptor: receptorConsumidorFinal(),
  });
  const pendientes = async (p: Preparado) => {
    const r = await listarPendientesDeFacturar(d, p.contexto, {});
    if (!r.ok) throw new Error("tenía que ser un éxito");
    return r.dato.tickets;
  };

  it("apagada: un ticket emitido sin cobrar no se lista ni se ofrece para emitir, y emitir se rechaza sin escribir", async () => {
    const p = await preparar(false);
    expect((await pendientes(p)).map((t) => t.ticketId)).not.toContain(p.t.ticketId);
    expect((await ticketParaEmitir(d, p.contexto, { ticketId: p.t.ticketId })).ok).toBe(false);
    expect((await emitirDesdeTicket(d, p.contexto, pedido(p.e, p.t.ticketId))).ok).toBe(false);
    expect(
      await m.contar("select count(*) as n from comprobante where empresa_id = $1", [p.e.empresa]),
    ).toBe(0);
  });

  it("encendida: el emitido sin cobrar se lista con `cobradoEn` nulo, «Emitir desde ese ticket» lo ofrece y se factura sin cobrarlo", async () => {
    const p = await preparar(true);
    const fila = (await pendientes(p)).find((t) => t.ticketId === p.t.ticketId);
    expect(fila).toMatchObject({ numero: p.t.numero, motivo: "SIN_COMPROBANTE", cobradoEn: null });
    const ficha = await ticketParaEmitir(d, p.contexto, { ticketId: p.t.ticketId });
    if (!ficha.ok) throw new Error("tenía que ser un éxito");
    expect(ficha.dato.total).toEqual({ moneda: "ARS", monto: "1000.00" });
    const r = await emitirDesdeTicket(d, p.contexto, pedido(p.e, p.t.ticketId));
    expect(r.ok).toBe(true);
    expect(
      (
        await m.filas<{ estado: string }>("select estado from ticket where id = $1", [p.t.ticketId])
      )[0]?.estado,
    ).toBe("EMITIDO");
    // Ya facturado, sale de la lista.
    expect((await pendientes(p)).map((t) => t.ticketId)).not.toContain(p.t.ticketId);
  });

  it("la perilla de una empresa no mueve a otra: con la de A encendida, la lista de B no trae emitidos sin cobrar", async () => {
    const a = await preparar(true);
    const b = await preparar(false);
    expect((await pendientes(a)).map((t) => t.ticketId)).toContain(a.t.ticketId);
    expect((await pendientes(b)).map((t) => t.ticketId)).not.toContain(b.t.ticketId);
    expect((await pendientes(b)).map((t) => t.ticketId)).not.toContain(a.t.ticketId);
  });
});
