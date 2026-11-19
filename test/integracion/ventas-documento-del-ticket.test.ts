import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  montarVentas,
  nuevaClave,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * Ventas (mostrador, K6): `documentoDelTicket` con los casos de uso reales y una base real. Es una consulta (no escribe): el papel sale de la ficha del ticket,
 * con la fecha en DD/MM/AAAA y el total (la cantidad «½», la medida y las opciones, en `documento-del-ticket.test.ts`); no existe para un ticket anulado o de cortesía; autorización (`ventas.ver`), alcance por
 * sucursal, aislamiento entre empresas, ancho 58/80 (80 por defecto) y repetir da lo mismo (no cambia nada en la base).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const monto = (m: string) => ({ moneda: "ARS", monto: m });

function falla<E>(r: Readonly<{ ok: true; valor: unknown } | { ok: false; error: E }>): E {
  if (r.ok) throw new Error(`se esperaba un error y vino ok ${JSON.stringify(r.valor)}`);
  return r.error;
}

describe.skipIf(base === null)("ventas: documentoDelTicket", () => {
  let m: MundoDeVentas;
  beforeAll(async () => {
    if (base !== null) m = await montarVentas(base);
  });
  afterAll(async () => {
    await m.cerrar();
  });

  type Caja = Awaited<ReturnType<MundoDeVentas["cajaAbierta"]>>;

  const vender = async (e: EscenarioDeVentas, caja: Caja, cantidad = "1", total = "1000.00") =>
    valorDe(
      await m.casos.venderYCobrar(e.gerente, {
        claveIdempotencia: nuevaClave(),
        cuentaId: nuevoId(),
        ejemplarId: nuevoId(),
        sucursalId: e.sucursal,
        lineas: [{ lineaId: nuevoId(), productoId: e.producto, opcionIds: [], cantidad }],
        totalEsperado: monto(total),
        cobro: {
          cajaId: caja.cajaId,
          cobros: [
            {
              medioDePagoId: caja.medios["EFECTIVO"] as string,
              cuentaDeCobroId: null,
              importe: monto(total),
            },
          ],
        },
      }),
    );
  const textos = (r: { lineas: readonly { texto: string }[] }) => r.lineas.map((l) => l.texto);

  it("el papel del ticket cobrado: número, fecha DD/MM/AAAA, la línea con su importe y el total; repetir da lo mismo", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const v = await vender(e, caja);
    const [a, mes, d] = [
      v.fechaNegocio.slice(8, 10),
      v.fechaNegocio.slice(5, 7),
      v.fechaNegocio.slice(0, 4),
    ];
    const papel = valorDe(
      await m.consultas.documentoDelTicket(e.gerente, { ticketId: v.ticketId }),
    );
    expect(papel.ancho).toBe(80);
    const l = textos(papel);
    expect(l[0]).toBe(`Ticket N.º ${v.numero}`);
    expect(l[1]).toBe(`${a}/${mes}/${d}`);
    expect(l.join("\n")).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(l.find((x) => x.startsWith("1 "))?.endsWith("1.000,00")).toBe(true);
    expect(l.at(-1)?.startsWith("Total")).toBe(true);
    expect(l.at(-1)?.endsWith("1.000,00")).toBe(true);
    const antes = await m.contar(
      "select count(*) as n from auditoria_empresa where empresa_id = $1",
      [e.empresa],
    );
    expect(
      valorDe(await m.consultas.documentoDelTicket(e.gerente, { ticketId: v.ticketId })),
    ).toEqual(papel);
    expect(
      await m.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
        e.empresa,
      ]),
    ).toBe(antes);
    // Ancho 58: otra maqueta, el mismo contenido.
    const angosto = valorDe(
      await m.consultas.documentoDelTicket(e.gerente, { ticketId: v.ticketId, ancho: 58 }),
    );
    expect(angosto.ancho).toBe(58);
    expect(textos(angosto).every((x) => x.length <= 32)).toBe(true);
  });

  it("un ticket anulado o de cortesía no tiene papel para el cliente", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const v = await vender(e, caja);
    valorDe(
      await m.casos.anularTicket(e.gerente, {
        claveIdempotencia: nuevaClave(),
        ticketId: v.ticketId,
        ejemplarBaseId: v.ejemplarId,
        ejemplarNuevoId: nuevoId(),
        motivo: "Se cobró de más",
      }),
    );
    expect(falla(await m.consultas.documentoDelTicket(e.gerente, { ticketId: v.ticketId }))).toBe(
      "TICKET_NO_IMPRIMIBLE",
    );
    const gratis = await m.productoVendible(e.empresa, "0");
    const cortesia = valorDe(
      await m.casos.venderYCobrar(e.gerente, {
        claveIdempotencia: nuevaClave(),
        cuentaId: nuevoId(),
        ejemplarId: nuevoId(),
        sucursalId: e.sucursal,
        lineas: [{ lineaId: nuevoId(), productoId: gratis, opcionIds: [], cantidad: "1" }],
        totalEsperado: monto("0.00"),
        confirmaciones: ["VENTA_A_CERO"],
        cobro: { cajaId: caja.cajaId, cobros: [] },
      }),
    );
    expect(cortesia.estado).toBe("CORTESIA");
    expect(
      falla(await m.consultas.documentoDelTicket(e.gerente, { ticketId: cortesia.ticketId })),
    ).toBe("TICKET_NO_IMPRIMIBLE");
  });

  it("autorización y alcance: el operador ve el ticket de su sucursal y no el de otra; sin persona no ve nada", async () => {
    const e = await m.escenario();
    const propia = await m.cajaAbierta(e);
    const otra = await m.cajaAbierta(e, { sucursal: e.otraSucursal });
    const mio = await vender(e, propia);
    const ajeno = valorDe(
      await m.casos.venderYCobrar(e.gerente, {
        claveIdempotencia: nuevaClave(),
        cuentaId: nuevoId(),
        ejemplarId: nuevoId(),
        sucursalId: e.otraSucursal,
        lineas: [{ lineaId: nuevoId(), productoId: e.producto, opcionIds: [], cantidad: "1" }],
        totalEsperado: monto("1000.00"),
        cobro: {
          cajaId: otra.cajaId,
          cobros: [
            {
              medioDePagoId: otra.medios["EFECTIVO"] as string,
              cuentaDeCobroId: null,
              importe: monto("1000.00"),
            },
          ],
        },
      }),
    );
    expect(
      valorDe(await m.consultas.documentoDelTicket(e.operador, { ticketId: mio.ticketId })).lineas
        .length,
    ).toBeGreaterThan(0);
    expect(
      falla(await m.consultas.documentoDelTicket(e.operador, { ticketId: ajeno.ticketId })),
    ).toBe("SUCURSAL_FUERA_DE_ALCANCE");
    const anonimo: ContextoOperativo = { ...e.gerente, personaId: null };
    expect((await m.consultas.documentoDelTicket(anonimo, { ticketId: mio.ticketId })).ok).toBe(
      false,
    );
  });

  it("aislamiento entre empresas: el ticket de otra empresa no existe para quien pide", async () => {
    const a = await m.escenario();
    const b = await m.escenario();
    const cajaB = await m.cajaAbierta(b);
    const deB = await vender(b, cajaB);
    expect(falla(await m.consultas.documentoDelTicket(a.gerente, { ticketId: deB.ticketId }))).toBe(
      "TICKET_NO_ENCONTRADO",
    );
  });

  it("entradas inválidas: id mal escrito, ancho que no existe, ticket inexistente", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const v = await vender(e, caja);
    expect(falla(await m.consultas.documentoDelTicket(e.gerente, { ticketId: "x" }))).toBe(
      "IDENTIFICADOR_INVALIDO",
    );
    for (const ancho of [0, 57, 100, 80.5, Number.NaN]) {
      expect(
        falla(await m.consultas.documentoDelTicket(e.gerente, { ticketId: v.ticketId, ancho })),
        String(ancho),
      ).toBe("ANCHO_INVALIDO");
    }
    expect(falla(await m.consultas.documentoDelTicket(e.gerente, { ticketId: nuevoId() }))).toBe(
      "TICKET_NO_ENCONTRADO",
    );
  });
});
