import { describe, expect, it } from "vitest";
import {
  armarLosPendientes,
  direccionDeLaPaginaDePendientes,
  pedidoDeLosPendientes,
  type PendientesParaMostrar,
} from "../../apps/web/ui/plantillas/facturacion/modelo-de-pendientes";

/** El modelo de vista de «Pendientes de facturar»: solo el número de la venta, el día y el total; el cursor viaja por la dirección y se valida de nuevo. */

const T1 = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const SUCURSAL = "5c4b3a29-1807-4f6e-9d5c-4b3a29180716";

const PAGINA: PendientesParaMostrar = {
  tickets: [
    {
      ticketId: T1,
      numero: 124,
      fechaNegocio: "2026-11-09",
      total: { moneda: "ARS", monto: "12000.00" },
    },
  ],
  siguiente: { fechaNegocio: "2026-11-09", numero: 124, sucursalId: SUCURSAL },
};

describe("armarLosPendientes", () => {
  it("cada fila lleva el enlace a Emitir desde ese ticket, «Venta N.º», el día y el total", () => {
    const m = armarLosPendientes({}, PAGINA);
    expect(m.filas).toEqual([
      {
        id: T1,
        href: `/facturacion/comprobantes/emitir/venta/${T1}`,
        venta: "Venta N.º 124",
        fecha: "09/11/2026",
        total: "$ 12.000,00",
      },
    ]);
    expect(m.vacio).toBeNull();
    expect(m.siguiente?.texto).toBe("Página siguiente");
  });

  it("solo sale lo aprobado: nada más que esas cinco cosas por fila (ni motivo, ni sucursal, ni cuenta)", () => {
    const fila = armarLosPendientes(
      {},
      {
        ...PAGINA,
        tickets: [
          {
            ...(PAGINA.tickets[0] as (typeof PAGINA.tickets)[number]),
            motivo: "COMPROBANTE_ANULADO",
            sucursalId: SUCURSAL,
          } as never,
        ],
      },
    ).filas[0];
    expect(Object.keys(fila ?? {}).sort()).toEqual(["fecha", "href", "id", "total", "venta"]);
  });

  it("sin tickets: el aviso «No hay ventas pendientes de facturar», sin filas ni página siguiente", () => {
    const m = armarLosPendientes({}, { tickets: [], siguiente: null });
    expect(m).toEqual({
      filas: [],
      vacio: "No hay ventas pendientes de facturar",
      siguiente: null,
    });
  });

  it("la página que sigue lleva el cursor en la dirección, y el pedido lo vuelve a leer igual", () => {
    const direccion = direccionDeLaPaginaDePendientes({
      fechaNegocio: "2026-11-09",
      numero: 124,
      sucursalId: SUCURSAL,
    });
    expect(direccion).toBe(
      `/facturacion/comprobantes/pendientes?despuesFecha=2026-11-09&despuesNumero=124&despuesSucursal=${SUCURSAL}`,
    );
    const params = Object.fromEntries(new URL(direccion, "https://x.test").searchParams);
    expect(pedidoDeLosPendientes(params)).toEqual({
      despuesDe: { fechaNegocio: "2026-11-09", numero: "124", sucursalId: SUCURSAL },
    });
  });
});

describe("pedidoDeLosPendientes", () => {
  it("sin cursor, o con uno incompleto, es la primera página; nada más del pedido pasa", () => {
    expect(pedidoDeLosPendientes({})).toEqual({});
    expect(pedidoDeLosPendientes({ despuesFecha: "2026-11-09" })).toEqual({});
    expect(pedidoDeLosPendientes({ sucursalId: "otra", limite: "1000", motivo: "x" })).toEqual({});
  });

  it("un valor repetido toma el primero", () => {
    expect(
      pedidoDeLosPendientes({
        despuesFecha: ["2026-11-09", "otro"],
        despuesNumero: ["3", "4"],
        despuesSucursal: [SUCURSAL],
      }),
    ).toEqual({ despuesDe: { fechaNegocio: "2026-11-09", numero: "3", sucursalId: SUCURSAL } });
  });
});
