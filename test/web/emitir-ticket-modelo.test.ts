import { describe, expect, it } from "vitest";
import { clienteInicial } from "../../apps/web/ui/plantillas/facturacion/eleccion-de-emision";
import {
  tituloDelTicket,
  vistaDeLaRevisionDeUnTicket,
  type TicketParaLaPantalla,
} from "../../apps/web/ui/plantillas/facturacion/modelo-de-emision-de-un-ticket";
import { armarElPedidoDelTicket } from "../../apps/web/ui/plantillas/facturacion/pedido-de-emision-de-un-ticket";

/** El modelo de vista y el pedido de «Emitir desde un ticket»: lo que se ve es lo que congeló ventas, y el pedido solo lleva lo que debe. */

const TICKET: TicketParaLaPantalla = {
  ticketId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  numero: 124,
  numeroDeCorreccion: null,
  sucursalId: "5c4b3a29-1807-4f6e-9d5c-4b3a29180716",
  total: { moneda: "ARS", monto: "17525.00" },
  lineas: [
    {
      descripcion: "Milanesa",
      varianteNombre: "Grande",
      opciones: ["Napolitana", "Carne"],
      cantidad: "1.0000",
      unidad: null,
      precioUnitario: "12000.000000",
      alicuota: "21",
      importe: "12000.00",
    },
    {
      descripcion: "Pan de campo",
      varianteNombre: null,
      opciones: [],
      cantidad: "1.2500",
      unidad: "kg",
      precioUnitario: "4420.000000",
      alicuota: "10.5",
      importe: "5525.00",
    },
    {
      descripcion: "Alfajor",
      varianteNombre: null,
      opciones: [],
      cantidad: "2.0000",
      unidad: null,
      precioUnitario: "0.000000",
      alicuota: "EXENTO",
      importe: "0.00",
    },
  ],
};
const PUNTO = {
  id: "6a1f0c2e-3b4d-4e5f-8a7b-9c0d1e2f3a4b",
  numero: 1,
  ambiente: "PRODUCCION",
} as const;
const PRUEBAS = {
  id: "7b2a1d3f-4c5e-4f60-9b8c-0d1e2f3a4b5c",
  numero: 2,
  ambiente: "HOMOLOGACION",
} as const;

const vista = (cambios: Partial<Parameters<typeof vistaDeLaRevisionDeUnTicket>[1]> = {}) =>
  vistaDeLaRevisionDeUnTicket(
    {},
    {
      ticket: TICKET,
      cliente: clienteInicial,
      discriminaIva: true,
      puntos: [PUNTO],
      puntoElegido: "",
      ...cambios,
    },
  );

describe("el modelo de «Emitir desde un ticket»", () => {
  it("«Venta N.º 124»", () => {
    expect(tituloDelTicket({}, TICKET)).toBe("Venta N.º 124");
  });

  it("los renglones salen tal cual el ticket: descripción con « · », cantidad con su unidad, precio, IVA e importe", () => {
    const filas = vista().renglones.filas;
    expect(filas.map((f) => [f.descripcion, f.cuenta, f.iva, f.importe])).toEqual([
      ["Milanesa · Grande · Napolitana · Carne", "1 × $ 12.000,00", "IVA 21 %", "$ 12.000,00"],
      ["Pan de campo", "1,25 kg × $ 4.420,00", "IVA 10,5 %", "$ 5.525,00"],
      ["Alfajor", "2 × $ 0,00", "Exento", "$ 0,00"],
    ]);
    expect(vista().renglones.total).toBe("$ 17.525,00");
  });

  it("sin discriminar IVA (letra C) no hay alícuota por renglón", () => {
    expect(vista({ discriminaIva: false }).renglones.filas.map((f) => f.iva)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("el punto de venta: ninguno, uno solo (se usa sin elegir) o varios (se elige), y el de pruebas avisa", () => {
    expect(vista({ puntos: [] }).puntoDeVenta).toMatchObject({ modo: "ninguno", opciones: [] });
    expect(vista().puntoDeVenta).toMatchObject({ modo: "uno", avisoDePruebas: null });
    const varios = vista({ puntos: [PUNTO, PRUEBAS], puntoElegido: PRUEBAS.id }).puntoDeVenta;
    expect(varios.modo).toBe("varios");
    expect(varios.opciones.map((o) => o.valor)).toEqual([PUNTO.id, PRUEBAS.id]);
    expect(varios.avisoDePruebas).not.toBeNull();
  });

  it("el cliente de la revisión es el escrito: consumidor final por defecto", () => {
    expect(vista().cliente.principal).toBe("Consumidor final");
  });
});

describe("el pedido de «Emitir desde un ticket»", () => {
  it("lleva solo el ticket, el punto de venta y el receptor", () => {
    const pedido = armarElPedidoDelTicket(clienteInicial, TICKET.ticketId, PUNTO.id);
    expect(Object.keys(pedido).sort()).toEqual(["puntoDeVentaId", "receptor", "ticketId"]);
    expect(pedido).toEqual({
      ticketId: TICKET.ticketId,
      puntoDeVentaId: PUNTO.id,
      receptor: {
        nombre: null,
        documento: { tipo: "SIN_IDENTIFICAR" },
        condicionIva: "CONSUMIDOR_FINAL",
        domicilio: null,
      },
    });
  });

  it("con un documento escrito, el receptor lo lleva recortado", () => {
    const pedido = armarElPedidoDelTicket(
      {
        ...clienteInicial,
        documento: "DNI",
        numero: " 27345678 ",
        nombre: " Juan Pérez ",
        condicionIva: "CONSUMIDOR_FINAL",
        domicilio: "  ",
      },
      TICKET.ticketId,
      PUNTO.id,
    );
    expect(pedido.receptor).toEqual({
      nombre: "Juan Pérez",
      documento: { tipo: "DNI", numero: "27345678" },
      condicionIva: "CONSUMIDOR_FINAL",
      domicilio: null,
    });
  });
});
