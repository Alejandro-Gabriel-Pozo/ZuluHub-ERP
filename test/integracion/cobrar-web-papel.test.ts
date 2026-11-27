import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  anularElTicket,
  cobrarLaVenta,
  papelDelTicket,
  type DependenciasDeCobrarWeb,
} from "../../src/composicion/cobrar-web";
import {
  montarVentas,
  nuevaClave,
  nuevoId,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * Composición web de «Imprimir ticket» (mostrador, K6) con los casos de uso reales y una base real: `papelDelTicket` devuelve SOLO `ancho` y `lineas` (lista blanca); un ticket de otra empresa, de una sucursal fuera del
 * alcance o anulado sale como el genérico; el pedido no admite más que el `ticketId`; sin persona sale con el código del guard; y es una LECTURA: repetirla y pedirla a la vez da lo mismo y no escribe nada
 * (ni ticket, ni cobro, ni caja, ni auditoría). El contenido del papel está en `ventas-documento-del-ticket.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const monto = (m: string) => ({ moneda: "ARS", monto: m });
const GENERICO = { ok: false, error: { codigo: "CAJA_ACCION_NO_PERMITIDA" } };

describe.skipIf(base === null)("composición web: el papel del ticket", () => {
  let m: MundoDeVentas;
  let d: DependenciasDeCobrarWeb;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base);
    d = {
      casosDeUso: () => m.casos,
      consultas: () => m.consultas,
      respuesta: { registrar: () => undefined },
    };
  });
  afterAll(async () => {
    await m.cerrar();
  });

  type Caja = Awaited<ReturnType<MundoDeVentas["cajaAbierta"]>>;

  const cobrada = async (e: EscenarioDeVentas, caja: Caja, sucursal = e.sucursal) => {
    const r = await cobrarLaVenta(d, e.gerente, sucursal, {
      claveIdempotencia: nuevaClave(),
      cuentaId: nuevoId(),
      ejemplarId: nuevoId(),
      lineas: [{ lineaId: nuevoId(), productoId: e.producto, opcionIds: [], cantidad: "1" }],
      totalEsperado: monto("1000.00"),
      cajaId: caja.cajaId,
      cobros: [
        {
          medioDePagoId: caja.medios["EFECTIVO"],
          cuentaDeCobroId: null,
          importe: monto("1000.00"),
        },
      ],
    });
    if (!r.ok) throw new Error("no cobró");
    return r.dato;
  };
  const contar = (tabla: string, empresa: string) =>
    m.contar(`select count(*) as n from ${tabla} where empresa_id = $1`, [empresa]);
  const rastros = async (e: EscenarioDeVentas) => ({
    cuentas: await contar("cuenta_consumo", e.empresa),
    tickets: await contar("ticket", e.empresa),
    cobranzas: await contar("cobranza_de_ticket", e.empresa),
    movimientos: await contar("movimiento_caja", e.empresa),
    cobros: await contar("cobro", e.empresa),
    auditoria: await contar("auditoria_empresa", e.empresa),
  });

  it("devuelve SOLO ancho y líneas (texto y estilo), con el importe y la fecha como los lee la persona", async () => {
    const e = await m.escenario();
    const venta = await cobrada(e, await m.cajaAbierta(e));
    const r = await papelDelTicket(d, e.gerente, { ticketId: venta.ticketId });
    if (!r.ok) throw new Error("sin papel");
    expect(Object.keys(r.dato).sort()).toEqual(["ancho", "lineas"]);
    expect(r.dato.ancho).toBe(80);
    for (const l of r.dato.lineas) expect(Object.keys(l).sort()).toEqual(["estilo", "texto"]);
    expect(r.dato.lineas[0]).toEqual({ texto: `Ticket N.º ${venta.numero}`, estilo: "NEGRITA" });
    expect(r.dato.lineas.at(-1)?.texto.endsWith("1.000,00")).toBe(true);
    expect(JSON.stringify(r.dato)).not.toContain(venta.ticketId);
  });

  it("idempotencia: repetir y pedirla a la vez da lo mismo y no escribe nada", async () => {
    const e = await m.escenario();
    const venta = await cobrada(e, await m.cajaAbierta(e));
    const primera = await papelDelTicket(d, e.gerente, { ticketId: venta.ticketId });
    const antes = await rastros(e);
    const varias = await Promise.all(
      Array.from({ length: 5 }, () => papelDelTicket(d, e.gerente, { ticketId: venta.ticketId })),
    );
    for (const r of varias) expect(r).toEqual(primera);
    expect(await papelDelTicket(d, e.gerente, { ticketId: venta.ticketId })).toEqual(primera);
    expect(await rastros(e)).toEqual(antes);
  });

  it("un ticket anulado, inexistente o de otra empresa sale como el genérico", async () => {
    const a = await m.escenario();
    const b = await m.escenario();
    const venta = await cobrada(a, await m.cajaAbierta(a));
    const otra = await cobrada(a, await m.cajaAbierta(a));
    const anulado = await anularElTicket(d, a.gerente, a.sucursal, {
      claveIdempotencia: nuevaClave(),
      ticketId: otra.ticketId,
      ejemplarBaseId: otra.ejemplarId,
      ejemplarNuevoId: nuevoId(),
      motivo: "Se cobró de más",
    });
    expect(anulado.ok).toBe(true);
    const antes = await rastros(a);
    expect(await papelDelTicket(d, a.gerente, { ticketId: otra.ticketId })).toMatchObject(GENERICO);
    expect(await papelDelTicket(d, a.gerente, { ticketId: nuevoId() })).toMatchObject(GENERICO);
    expect(await papelDelTicket(d, b.gerente, { ticketId: venta.ticketId })).toMatchObject(
      GENERICO,
    );
    expect(await rastros(a)).toEqual(antes);
  });

  it("autorización y alcance: el operador ve el de su sucursal y no el de otra; sin persona sale el código del guard", async () => {
    const e = await m.escenario();
    const mio = await cobrada(e, await m.cajaAbierta(e));
    const ajeno = await cobrada(
      e,
      await m.cajaAbierta(e, { sucursal: e.otraSucursal }),
      e.otraSucursal,
    );
    expect((await papelDelTicket(d, e.operador, { ticketId: mio.ticketId })).ok).toBe(true);
    expect(await papelDelTicket(d, e.operador, { ticketId: ajeno.ticketId })).toMatchObject(
      GENERICO,
    );
    expect(
      await papelDelTicket(d, { ...e.gerente, personaId: null }, { ticketId: mio.ticketId }),
    ).toMatchObject({ ok: false, error: { codigo: "MODULO_NO_ACTIVO" } });
  });

  it("el pedido solo admite el ticketId: el ancho, la sucursal o una clave de más se rechazan", async () => {
    const e = await m.escenario();
    const venta = await cobrada(e, await m.cajaAbierta(e));
    for (const extra of [{ ancho: 58 }, { sucursalId: e.otraSucursal }, { empresaId: e.empresa }]) {
      expect(
        await papelDelTicket(d, e.gerente, { ticketId: venta.ticketId, ...extra }),
      ).toMatchObject(GENERICO);
    }
    expect(await papelDelTicket(d, e.gerente, {})).toMatchObject(GENERICO);
    expect(await papelDelTicket(d, e.gerente, null)).toMatchObject(GENERICO);
    expect(await papelDelTicket(d, e.gerente, { ticketId: "no-es-un-id" })).toMatchObject(GENERICO);
  });
});
