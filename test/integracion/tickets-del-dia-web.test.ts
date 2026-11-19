import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  fichaDelTicketParaLaPantalla,
  ticketsDelDiaParaLaPantalla,
  type DependenciasDeTicketsDelDiaWeb,
} from "../../src/composicion/tickets-del-dia-web";
import { crearConsultasDeIdentidad } from "../../src/modulos/identidad/publico";
import { crearFacturadorDeTickets } from "../../src/composicion/facturacion-de-tickets";
import { crearConsultasDeVentas } from "../../src/modulos/ventas/publico";
import {
  montarVentas,
  nuevaClave,
  nuevoId,
  REGLAS_DE_PRUEBA,
  valorDe,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * La composición web de «Tickets del día» y la ficha, con una base real: lista blanca (ningún id de persona sale; el correo en su lugar), el
 * pedido con una clave de más se rechaza, la sucursal no la pone el pedido, y un error de negocio sale como el genérico.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const GENERICO = { ok: false, error: { codigo: "CAJA_ACCION_NO_PERMITIDA" } };

describe.skipIf(base === null)("composición web: tickets del día", () => {
  let m: MundoDeVentas;
  let d: DependenciasDeTicketsDelDiaWeb;
  const registrados: string[] = [];

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { facturacion: true });
    const consultas = crearConsultasDeVentas({
      transacciones: m.entorno,
      reglas: REGLAS_DE_PRUEBA,
      facturador: crearFacturadorDeTickets(REGLAS_DE_PRUEBA),
    });
    const identidad = crearConsultasDeIdentidad({
      transacciones: m.entorno,
      reglas: REGLAS_DE_EMPRESA,
    });
    d = {
      consultas: () => consultas,
      consultasDeIdentidad: () => identidad,
      respuesta: { registrar: (x) => registrados.push(x) },
    };
  });
  afterAll(async () => {
    await m.cerrar();
  });

  async function vender() {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const r = valorDe(
      await m.casos.venderYCobrar(e.gerente, {
        claveIdempotencia: nuevaClave(),
        cuentaId: nuevoId(),
        ejemplarId: nuevoId(),
        sucursalId: e.sucursal,
        lineas: [{ lineaId: nuevoId(), productoId: e.producto, opcionIds: [], cantidad: "1" }],
        totalEsperado: { moneda: "ARS", monto: "1000.00" },
        cobro: {
          cajaId: caja.cajaId,
          cobros: [
            {
              medioDePagoId: caja.medios["EFECTIVO"] as string,
              cuentaDeCobroId: null,
              importe: { moneda: "ARS", monto: "1000.00" },
            },
          ],
        },
      }),
    );
    return { e, ticketId: r.ticketId };
  }

  it("la lista sale campo por campo, sin ids de persona", async () => {
    const { e, ticketId } = await vender();
    const r = await ticketsDelDiaParaLaPantalla(d, e.operador, e.sucursal);
    if (!r.ok) throw new Error("tenía que salir");
    expect(r.dato.fechaNegocio).toBe("2026-11-09");
    expect(Object.keys(r.dato.tickets[0] ?? {}).sort()).toEqual(
      [
        "emitidoEn",
        "estado",
        "facturado",
        "numero",
        "numeroDeCorreccion",
        "ticketId",
        "totalOriginal",
        "totalVigente",
      ].sort(),
    );
    expect(r.dato.tickets[0]?.ticketId).toBe(ticketId);
  });

  it("la ficha trae el correo de quien emitió en lugar de su id; ningún id de persona sale", async () => {
    const { e, ticketId } = await vender();
    const correo = (
      await m.filas<{ email: string }>("select email from persona where id = $1", [
        e.gerente.personaId,
      ])
    )[0]?.email;
    const r = await fichaDelTicketParaLaPantalla(d, e.operador, { ticketId });
    if (!r.ok) throw new Error("tenía que salir");
    expect(r.dato.emitidoPor).toBe(correo);
    expect(JSON.stringify(r.dato)).not.toContain(e.gerente.personaId as string);
    expect(r.dato.anulacion).toBeNull();
    expect(r.dato.cobros).toHaveLength(1);
  });

  it("el pedido con una clave de más, o con un id mal escrito, se rechaza; un ticket ajeno, también", async () => {
    const { e, ticketId } = await vender();
    expect(
      await fichaDelTicketParaLaPantalla(d, e.operador, { ticketId, sucursalId: e.sucursal }),
    ).toMatchObject(GENERICO);
    expect(await fichaDelTicketParaLaPantalla(d, e.operador, { ticketId: "x" })).toMatchObject(
      GENERICO,
    );
    const otra = await m.escenario();
    expect(await fichaDelTicketParaLaPantalla(d, otra.gerente, { ticketId })).toMatchObject(
      GENERICO,
    );
  });

  it("un error de negocio (sucursal fuera del alcance) sale como el genérico", async () => {
    const { e } = await vender();
    expect(await ticketsDelDiaParaLaPantalla(d, e.operador, e.otraSucursal)).toMatchObject(
      GENERICO,
    );
  });
});
