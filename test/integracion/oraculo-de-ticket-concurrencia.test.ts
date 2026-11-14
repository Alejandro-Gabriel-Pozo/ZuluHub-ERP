import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { ORACULO_DE_VENTAS } from "../../src/modulos/ventas/dominio/oraculo-de-ticket";
import {
  celdaPor,
  celdasPendientes,
  etiquetaDePendiente,
} from "../../src/primitivas/oraculo/celdas";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { agotadaEnElResultado, repetirSiAgotada } from "./concurrencia-apoyo";
import { montarVentas, nuevaClave, nuevoId, valorDe, type MundoDeVentas } from "./ventas-apoyo";
import {
  crearFiscalDePrueba,
  escenarioFacturable,
  nuevaClaveDeFactura,
  receptorConsumidorFinal,
  ticketCobrado,
  type EscenarioDeFacturacionDeTickets,
} from "./ventas-facturar-apoyo";

/**
 * EL ORÁCULO, DOS ACCIONES A LA VEZ (bloque D de `oraculo-ticket-cobranza.md`): las celdas D-02, D-03, D-05, D-06, D-07 y D-08 con el motor real
 * (SERIALIZABLE) y una barrera que suelta las dos acciones juntas. Las celdas D-01, D-04 y D-09 dependen de casos de uso que todavía no existen
 * (cobrar en partes, facturar por cantidad): figuran `PENDIENTE (tramo X)` y se escriben con su tramo.
 * D-05 NO afirma la política (R-32: anular con factura vigente no se debe poder; hoy sí se puede, defecto T0): afirma lo que vale hoy y siempre,
 * que ninguna de las dos acciones deja el ticket a medias (a lo sumo una factura y tantos punteros como facturas). Rondas: `PEDERNAL_RONDAS` (4 por defecto).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 600_000 });

const RONDAS = (() => {
  const n = Number(process.env["PEDERNAL_RONDAS"] ?? "4");
  return Number.isInteger(n) && n >= 1 ? n : 4;
})();

type Cualquiera = Resultado<unknown, unknown>;
const codigo = (r: Cualquiera): string => {
  if (r.ok) return "ok";
  const x = r.error;
  if (typeof x === "string") return x;
  if (typeof x === "object" && x !== null) {
    for (const k of ["error", "codigo", "tipo"] as const) {
      const v = (x as Record<string, unknown>)[k];
      if (typeof v === "string") return v;
    }
  }
  return "otro";
};
const firme = <R extends Cualquiera>(trabajo: () => Promise<R>) =>
  repetirSiAgotada(trabajo, { esAgotada: agotadaEnElResultado });

describe.skipIf(base === null)("oráculo de ticket: dos acciones a la vez e idempotencia", () => {
  let m: MundoDeVentas;
  let fiscal: ReturnType<typeof crearFiscalDePrueba>;
  let e: EscenarioDeFacturacionDeTickets;
  let caja: Awaited<ReturnType<MundoDeVentas["cajaAbierta"]>>;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { facturacion: true, conexiones: 24 });
    fiscal = crearFiscalDePrueba(m);
    e = await escenarioFacturable(m);
    caja = await m.cajaAbierta(e);
  });
  afterAll(async () => {
    if (base === null) return;
    await fiscal.cerrar();
    await m.cerrar();
  });

  /** `n` pedidos a la vez con una barrera de `n` participantes. */
  const aLaVez = async <T>(pedidos: readonly (() => Promise<T>)[]): Promise<T[]> => {
    m.armarBarrera(pedidos.length);
    try {
      return await Promise.all(pedidos.map((p) => p()));
    } finally {
      m.soltarBarrera();
    }
  };

  /** Dos pedidos distintos a la vez con una barrera de dos (el resultado conserva el tipo de cada uno). */
  const dosALaVez = async <A, B>(a: () => Promise<A>, b: () => Promise<B>): Promise<[A, B]> => {
    m.armarBarrera(2);
    try {
      return await Promise.all([a(), b()]);
    } finally {
      m.soltarBarrera();
    }
  };

  const monto = (v: string) => ({ moneda: "ARS", monto: v });
  const ticketEmitido = async () => {
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal }));
    valorDe(
      await m.casos.agregarLinea(e.gerente, {
        cuentaId: cuenta,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    );
    return valorDe(
      await m.casos.cerrarCuenta(e.gerente, { cuentaId: cuenta, ejemplarId: nuevoId() }),
    );
  };
  const cobrar = (
    t: Readonly<{ ticketId: string; ejemplarId: string }>,
    clave = nuevaClave(),
    medio = "EFECTIVO",
  ) =>
    firme(() =>
      m.casos.cobrar(e.gerente, {
        claveIdempotencia: clave,
        ticketId: t.ticketId,
        ejemplarId: t.ejemplarId,
        cajaId: caja.cajaId,
        cobros: [
          {
            medioDePagoId: caja.medios[medio] as string,
            cuentaDeCobroId: null,
            importe: monto("1000.00"),
          },
        ],
      }),
    );
  const anular = (
    t: Readonly<{ ticketId: string; ejemplarId: string }>,
    clave = nuevaClave(),
    ejemplarNuevoId = nuevoId(),
  ) =>
    firme(() =>
      m.casos.anularTicket(e.gerente, {
        claveIdempotencia: clave,
        ticketId: t.ticketId,
        ejemplarBaseId: t.ejemplarId,
        ejemplarNuevoId,
        motivo: "Error del cajero",
      }),
    );
  const facturar = (ticketId: string, clave = nuevaClaveDeFactura()) =>
    firme(() =>
      m.casos.emitirComprobanteDeTicket(
        { ...e.gerente, ahora: fiscal.reloj.ahora() },
        { ticketId, receptor: receptorConsumidorFinal(), puntoDeVentaId: e.pv, clave },
      ),
    );
  const filaDe = async (ticketId: string) => ({
    estado: (
      await m.filas<{ estado: string }>("select estado from ticket where id = $1", [ticketId])
    )[0]?.estado,
    cobranzas: await m.contar("select count(*) as n from cobranza_de_ticket where ticket_id = $1", [
      ticketId,
    ]),
    anulaciones: await m.contar(
      "select count(*) as n from ticket_ejemplar where ticket_id = $1 and tipo = 'ANULACION'",
      [ticketId],
    ),
    punteros: await m.contar("select count(*) as n from documento_de_ticket where ticket_id = $1", [
      ticketId,
    ]),
    vigentes: await m.contar(
      "select count(*) as n from documento_de_ticket where ticket_id = $1 and vigente",
      [ticketId],
    ),
  });

  it(`${celdaPor(ORACULO_DE_VENTAS, "D-02").id}: el mismo cobro (misma clave y huella) seis veces a la vez deja UN cobro y todas devuelven lo mismo`, async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const t = await ticketEmitido();
      const clave = nuevaClave();
      const rs = await aLaVez(Array.from({ length: 6 }, () => () => cobrar(t, clave)));
      const ctx = `ronda ${ronda}: ${rs.map(codigo).join(" / ")}`;
      expect(
        rs.every((r) => r.ok),
        ctx,
      ).toBe(true);
      expect(
        new Set(rs.map((r) => (r.ok ? (r.valor as { cobranzaId: string }).cobranzaId : ""))).size,
        ctx,
      ).toBe(1);
      expect(
        rs.filter((r) => r.ok && !(r.valor as { yaExistia: boolean }).yaExistia),
        ctx,
      ).toHaveLength(1);
      expect((await filaDe(t.ticketId)).cobranzas, ctx).toBe(1);
      expect((await filaDe(t.ticketId)).estado, ctx).toBe("COBRADO");
    }
  });

  it(`${celdaPor(ORACULO_DE_VENTAS, "D-03").id}: la misma clave con otra huella, a la vez: uno cobra y el otro recibe CLAVE_REUTILIZADA`, async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const t = await ticketEmitido();
      const clave = nuevaClave();
      const [a, b] = await dosALaVez(
        () => cobrar(t, clave, "EFECTIVO"),
        () => cobrar(t, clave, "TARJETA_DEBITO"),
      );
      const ctx = `ronda ${ronda}: ${codigo(a)} / ${codigo(b)}`;
      expect(
        [a, b].filter((r) => r.ok),
        ctx,
      ).toHaveLength(1);
      expect([a, b].filter((r) => !r.ok).map(codigo), ctx).toEqual(["CLAVE_REUTILIZADA"]);
      expect((await filaDe(t.ticketId)).cobranzas, ctx).toBe(1);
    }
  });

  it(`${celdaPor(ORACULO_DE_VENTAS, "D-06").id}: anular el mismo ticket dos veces a la vez (misma clave) deja UNA anulación`, async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const t = await ticketEmitido();
      const clave = nuevaClave();
      const ejemplarNuevoId = nuevoId();
      const rs = await dosALaVez(
        () => anular(t, clave, ejemplarNuevoId),
        () => anular(t, clave, ejemplarNuevoId),
      );
      const ctx = `ronda ${ronda}: ${rs.map(codigo).join(" / ")}`;
      expect(
        rs.every((r) => r.ok),
        ctx,
      ).toBe(true);
      const f = await filaDe(t.ticketId);
      expect(f.estado, ctx).toBe("ANULADO");
      expect(f.anulaciones, ctx).toBe(1);
    }
  });

  it(`${celdaPor(ORACULO_DE_VENTAS, "D-07").id}: cobrar y anular a la vez: una gana y el ticket no queda a medias`, async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const t = await ticketEmitido();
      const [cobro, anulacion] = await dosALaVez(
        () => cobrar(t),
        () => anular(t),
      );
      const ctx = `ronda ${ronda}: cobro=${codigo(cobro)} anulación=${codigo(anulacion)}`;
      const f = await filaDe(t.ticketId);
      // Anular siempre entra (anular un cobrado está permitido) y deja un solo ejemplar de anulación.
      expect(anulacion.ok, ctx).toBe(true);
      expect(f.estado, ctx).toBe("ANULADO");
      expect(f.anulaciones, ctx).toBe(1);
      if (cobro.ok) expect(f.cobranzas, ctx).toBe(1);
      else {
        expect(["TICKET_ANULADO", "EJEMPLAR_DESACTUALIZADO"], ctx).toContain(codigo(cobro));
        expect(f.cobranzas, ctx).toBe(0);
      }
    }
  });

  it(`${celdaPor(ORACULO_DE_VENTAS, "D-08").id}: el mismo pedido de facturar (corte de red, doble clic) a la vez emite UNA factura`, async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      fiscal.adelantar();
      const t = await ticketCobrado(m, e, caja);
      const clave = nuevaClaveDeFactura();
      const rs = await aLaVez(Array.from({ length: 4 }, () => () => facturar(t.ticketId, clave)));
      const ctx = `ronda ${ronda}: ${rs.map(codigo).join(" / ")}`;
      expect(
        rs.every((r) => r.ok),
        ctx,
      ).toBe(true);
      expect(
        new Set(rs.map((r) => (r.ok ? (r.valor as { comprobanteId: string }).comprobanteId : "")))
          .size,
        ctx,
      ).toBe(1);
      const f = await filaDe(t.ticketId);
      expect(f.punteros, ctx).toBe(1);
      expect(f.vigentes, ctx).toBe(1);
    }
  });

  it(`${celdaPor(ORACULO_DE_VENTAS, "D-05").id} PENDIENTE (tramo T0): anular y facturar a la vez: nada a medias (la política R-32 todavía no existe)`, async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      fiscal.adelantar();
      const cobrado = await ticketCobrado(m, e, caja);
      const t = await m.filas<{ ejemplar_vigente_id: string }>(
        `select e.id as ejemplar_vigente_id from ticket t join ticket_ejemplar e on e.ticket_id = t.id and e.numero_de_ejemplar = t.ejemplar_vigente where t.id = $1`,
        [cobrado.ticketId],
      );
      const ticket = { ticketId: cobrado.ticketId, ejemplarId: t[0]?.ejemplar_vigente_id ?? "" };
      const [factura, anulacion] = await dosALaVez(
        () => facturar(ticket.ticketId),
        () => anular(ticket),
      );
      const ctx = `ronda ${ronda}: factura=${codigo(factura)} anulación=${codigo(anulacion)}`;
      const f = await filaDe(ticket.ticketId);
      expect(["COBRADO", "ANULADO"], ctx).toContain(f.estado);
      // A lo sumo una factura y su puntero; si ganó anular, facturar no emitió nada.
      expect(f.punteros, ctx).toBeLessThanOrEqual(1);
      expect(f.vigentes, ctx).toBe(f.punteros);
      expect(f.punteros === 1, ctx).toBe(factura.ok);
      expect(f.estado === "ANULADO", ctx).toBe(anulacion.ok);
      if (!factura.ok)
        expect(["TICKET_NO_FACTURABLE", "TICKET_YA_FACTURADO"], ctx).toContain(codigo(factura));
    }
  });

  // Las celdas de dos acciones a la vez que esperan su tramo: no hay caso de uso que ejecutar todavía.
  for (const celda of celdasPendientes(ORACULO_DE_VENTAS).filter(
    (c) => c.id.startsWith("D-") && c.id !== "D-05",
  )) {
    it(`${celda.id} ${etiquetaDePendiente(celda) ?? ""}: ${celda.accion}`, () => {
      expect(celda.pendiente).not.toBeNull();
    });
  }
});
