import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { esConcurrenciaAgotada } from "./concurrencia-apoyo";
import { montarVentas, nuevoId, valorDe, type MundoDeVentas } from "./ventas-apoyo";
import {
  crearFiscalDePrueba,
  escenarioFacturable,
  nuevaClaveDeFactura as nuevaClave,
  receptorConsumidorFinal,
  ticketCobrado,
  type EscenarioDeFacturacionDeTickets,
} from "./ventas-facturar-apoyo";

/**
 * T0 (plan 10): anular un ticket con comprobante vigente (`TICKET_CON_COMPROBANTE_VIGENTE`, E4 §3.8). Casos de uso reales de ventas, facturador real
 * de la composición y base real. Cubre: el rechazo con factura vigente (también «Confirmando») sin escribir nada; que una factura que dejó de valer
 * (nota de crédito total autorizada, o rechazada por ARCA) ya no impide anular; la idempotencia (la misma clave devuelve lo hecho aunque después
 * se haya facturado otra cosa, un ticket ya anulado es TICKET_ANULADO); y la carrera anular + facturar el MISMO ticket: uno gana, el otro recibe un
 * error claro y nunca queda un ticket anulado con factura vigente.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Fila = Record<string, unknown>;

function falla<E>(r: Readonly<{ ok: true; valor: unknown } | { ok: false; error: E }>): E {
  if (r.ok) throw new Error(`se esperaba un error y vino ok ${JSON.stringify(r.valor)}`);
  return r.error;
}

describe.skipIf(base === null)("ventas: anular un ticket con comprobante", () => {
  let m: MundoDeVentas;
  let fiscal: ReturnType<typeof crearFiscalDePrueba>;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { facturacion: true, conexiones: 16 });
    fiscal = crearFiscalDePrueba(m);
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
    const ejemplar = (
      await m.filas<Fila>(
        "select id from ticket_ejemplar where ticket_id = $1 order by numero_de_ejemplar desc limit 1",
        [t.ticketId],
      )
    )[0];
    return { e, caja, t, ejemplarId: String(ejemplar?.["id"]) };
  }
  type Preparado = Awaited<ReturnType<typeof preparar>>;

  const facturar = (e: EscenarioDeFacturacionDeTickets, ticketId: string, clave = nuevaClave()) =>
    m.casos.emitirComprobanteDeTicket(
      { ...e.gerente, ahora: fiscal.reloj.ahora() },
      { ticketId, receptor: receptorConsumidorFinal(), puntoDeVentaId: e.pv, clave },
    );

  const pedido = (p: Preparado, cambios: { clave?: string; ejemplarNuevoId?: string } = {}) => ({
    claveIdempotencia: cambios.clave ?? nuevaClave(),
    ticketId: p.t.ticketId,
    ejemplarBaseId: p.ejemplarId,
    ejemplarNuevoId: cambios.ejemplarNuevoId ?? nuevoId(),
    motivo: "Cargado por error",
  });
  const anular = (p: Preparado, cambios: { clave?: string; ejemplarNuevoId?: string } = {}) =>
    m.casos.anularTicket(p.e.gerente, pedido(p, cambios));

  const estado = async (ticketId: string) =>
    (await m.filas<Fila>("select estado from ticket where id = $1", [ticketId]))[0]?.["estado"];
  const escrituras = async (p: Preparado) => ({
    estado: await estado(p.t.ticketId),
    correcciones: await m.contar(
      "select count(*) as n from ticket_correccion where empresa_id = $1",
      [p.e.empresa],
    ),
    anulaciones: (await m.auditoria(p.e.empresa, "TICKET_ANULADO")).length,
  });

  it("con la factura vigente (todavía sin autorizar: «Confirmando») no se anula, y no escribe nada", async () => {
    const p = await preparar();
    const f = valorDe(await facturar(p.e, p.t.ticketId));
    const antes = await escrituras(p);
    expect(falla(await anular(p))).toEqual({
      error: "TICKET_CON_COMPROBANTE_VIGENTE",
      comprobanteId: f.comprobanteId,
    });
    expect(await escrituras(p)).toEqual(antes);
    expect(antes.estado).toBe("COBRADO");
  });

  it("con la factura autorizada tampoco; una nota parcial no la deja sin valer", async () => {
    const p = await preparar();
    const f = valorDe(await facturar(p.e, p.t.ticketId));
    await fiscal.autorizar(p.e, f.comprobanteId);
    await fiscal.autorizar(p.e, await fiscal.notaDeCredito(p.e, f.comprobanteId, "400.00"));
    expect(falla(await anular(p))).toMatchObject({ error: "TICKET_CON_COMPROBANTE_VIGENTE" });
    expect(await estado(p.t.ticketId)).toBe("COBRADO");
  });

  it("acreditada por completo con una nota autorizada, el ticket se anula (el puntero queda como estaba)", async () => {
    const p = await preparar();
    const f = valorDe(await facturar(p.e, p.t.ticketId));
    await fiscal.autorizar(p.e, f.comprobanteId);
    await fiscal.autorizar(p.e, await fiscal.notaDeCredito(p.e, f.comprobanteId, "1000.00"));
    expect(valorDe(await anular(p)).estado).toBe("ANULADO");
    expect(await estado(p.t.ticketId)).toBe("ANULADO");
  });

  it("si ARCA rechazó la factura, el ticket se anula", async () => {
    const p = await preparar();
    const f = valorDe(await facturar(p.e, p.t.ticketId));
    fiscal.falsa.programar("RECHAZA");
    await fiscal.autorizar(p.e, f.comprobanteId);
    expect(valorDe(await anular(p)).estado).toBe("ANULADO");
  });

  it("un ticket sin factura se anula como siempre", async () => {
    const p = await preparar();
    expect(valorDe(await anular(p)).yaExistia).toBe(false);
    expect(await estado(p.t.ticketId)).toBe("ANULADO");
  });

  it("hay documento vigente y no hay facturador cableado: falla cerrado y no anula", async () => {
    const p = await preparar();
    valorDe(await facturar(p.e, p.t.ticketId));
    const { crearCasosDeUsoDeVentas } = await import("../../src/modulos/ventas/publico");
    const sin = crearCasosDeUsoDeVentas({
      transacciones: m.entorno,
      reglas: (await import("./ventas-apoyo")).REGLAS_DE_PRUEBA,
    });
    expect(falla(await sin.anularTicket(p.e.gerente, pedido(p)))).toBe("FACTURACION_NO_DISPONIBLE");
    expect(await estado(p.t.ticketId)).toBe("COBRADO");
  });

  // ---- idempotencia ------------------------------------------------------------------------------------------------------------

  it("anular dos veces con la misma clave: la segunda devuelve lo hecho y no escribe; con otra clave, TICKET_ANULADO", async () => {
    const p = await preparar();
    const cambios = { clave: nuevaClave(), ejemplarNuevoId: nuevoId() };
    const a = valorDe(await anular(p, cambios));
    const antes = await escrituras(p);
    const b = valorDe(await anular(p, cambios));
    expect(b).toEqual({ ...a, yaExistia: true });
    expect(await escrituras(p)).toEqual(antes);
    expect(falla(await anular(p))).toBe("TICKET_ANULADO");
    expect(antes).toEqual({ estado: "ANULADO", correcciones: 1, anulaciones: 1 });
  });

  it("la misma clave de una anulación ya hecha devuelve lo hecho aunque el ticket tenga documentos", async () => {
    const p = await preparar();
    const cambios = { clave: nuevaClave(), ejemplarNuevoId: nuevoId() };
    valorDe(await anular(p, cambios));
    expect(valorDe(await anular(p, cambios)).yaExistia).toBe(true);
    // Anulado, ya no se factura.
    expect(falla(await facturar(p.e, p.t.ticketId))).toBe("TICKET_NO_FACTURABLE");
  });

  // ---- concurrencia ------------------------------------------------------------------------------------------------------------

  it("anular y facturar el MISMO ticket a la vez: uno gana y el otro recibe un error claro; nunca un ticket anulado con factura vigente", async () => {
    const vueltas = Number(process.env["PEDERNAL_VUELTAS_DE_FACTURAR"] ?? "3");
    for (let vuelta = 0; vuelta < vueltas; vuelta++) {
      const p = await preparar();
      const [a, f] = await Promise.all([anular(p), facturar(p.e, p.t.ticketId)]);
      const ctx = `vuelta ${vuelta}`;
      // Exactamente uno gana; el perdedor trae el error claro de su lado (o agotó los reintentos de la serializable).
      expect([a.ok, f.ok].filter(Boolean), ctx).toHaveLength(1);
      const perdedor = a.ok ? f : a;
      if (!perdedor.ok && !esConcurrenciaAgotada(perdedor.error)) {
        expect(perdedor.error, ctx).toEqual(
          a.ok
            ? "TICKET_NO_FACTURABLE"
            : {
                error: "TICKET_CON_COMPROBANTE_VIGENTE",
                comprobanteId: expect.any(String) as unknown,
              },
        );
      }
      const punteros = await m.contar(
        "select count(*) as n from documento_de_ticket where ticket_id = $1 and vigente",
        [p.t.ticketId],
      );
      const comprobantes = await m.contar(
        "select count(*) as n from comprobante where empresa_id = $1",
        [p.e.empresa],
      );
      if (a.ok) {
        expect(await estado(p.t.ticketId), ctx).toBe("ANULADO");
        expect([punteros, comprobantes], ctx).toEqual([0, 0]);
      } else {
        expect(await estado(p.t.ticketId), ctx).toBe("COBRADO");
        expect([punteros, comprobantes], ctx).toEqual([1, 1]);
      }
    }
  });
});
