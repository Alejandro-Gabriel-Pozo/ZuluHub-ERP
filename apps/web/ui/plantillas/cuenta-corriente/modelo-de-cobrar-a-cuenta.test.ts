import { describe, expect, it } from "vitest";
import type { MedioParaCobrar } from "../cobrar/modelo-de-cobro";
import {
  armarLaHoja,
  armarLoCobrado,
  cajaInicial,
  cajasParaElegir,
  lineaDeLaCaja,
  pagoInicial,
  pedidoDeCobrarACuenta,
  sePuedeCobrar,
  textoDeCobrar,
  type HojaParaCobrarALaCuenta,
  type TicketCobradoALaCuenta,
} from "./modelo-de-cobrar-a-cuenta";
import { textosDeCobrarACuenta } from "./textos-de-cobrar-a-cuenta";

/** El modelo de «Cobrar un ticket a cuenta»: qué cajas se ofrecen, cuándo se puede cobrar, el pedido (sin importe) y el estado «Cobrado». Puro, sin pantalla. */
const nada = { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false };
const EFECTIVO: MedioParaCobrar = {
  id: "m-efectivo",
  tipo: "EFECTIVO",
  nombre: null,
  cuentas: [],
  datosQuePide: nada,
  datosQueSePiden: nada,
};
const DEBITO: MedioParaCobrar = {
  id: "m-debito",
  tipo: "TARJETA_DEBITO",
  nombre: null,
  cuentas: [{ id: "c-1", tipo: "TERMINAL", nombre: "Posnet" }],
  datosQuePide: { ...nada, cupon: true, ultimos4: true, cuotas: true },
  datosQueSePiden: nada,
};
const CAJA = {
  cajaId: "caja-1",
  nombre: "Caja 1",
  estado: "ABIERTA" as const,
  sesionId: "s-1",
  fechaDeNegocio: "2026-11-09",
  jornadaVencida: false,
};
const HOJA: HojaParaCobrarALaCuenta = {
  cliente: { id: "cl-1", nombre: "Agencia" },
  ticket: {
    ticketId: "t-1",
    numero: 4821,
    canal: "MOSTRADOR",
    sucursalId: "su-1",
    fechaNegocio: "2026-10-12",
    ejemplarId: "e-1",
    total: { moneda: "ARS", monto: "1234.50" },
    venceEl: null,
    vencida: true,
    sucursal: null,
  },
  cajas: [CAJA],
  jornadaActual: { fechaDeNegocio: "2026-11-09", estado: "ABIERTA" },
  opciones: { medios: [EFECTIVO, DEBITO], marcasDeTarjeta: [] },
};
const textos = textosDeCobrarACuenta();

describe("las cajas donde se cobra", () => {
  it("ofrece solo las abiertas HOY, con su sucursal; sin sucursal, «—»", () => {
    expect(cajasParaElegir(HOJA)).toEqual([
      {
        cajaId: "caja-1",
        etiqueta: "Caja 1 · — · sesión abierta hoy",
        fechaDeNegocio: "2026-11-09",
      },
    ]);
    const conSucursal = { ...HOJA, ticket: { ...HOJA.ticket, sucursal: "Centro" } };
    expect(cajasParaElegir(conSucursal)[0]?.etiqueta).toBe("Caja 1 · Centro · sesión abierta hoy");
  });

  it.each([
    [
      "sin sesión",
      { ...CAJA, estado: "SIN_SESION" as const, sesionId: null, fechaDeNegocio: null },
    ],
    ["en cierre", { ...CAJA, estado: "EN_CIERRE" as const }],
    ["de un día anterior", { ...CAJA, jornadaVencida: true }],
    ["sin fecha de negocio", { ...CAJA, fechaDeNegocio: null }],
  ])("una caja %s no se ofrece", (_caso, caja) => {
    expect(cajasParaElegir({ ...HOJA, cajas: [caja] })).toEqual([]);
  });

  it.each(["EN_AUDITORIA", "CERRADA"] as const)("con el día %s no se ofrece ninguna", (estado) => {
    expect(
      cajasParaElegir({ ...HOJA, jornadaActual: { fechaDeNegocio: "2026-11-09", estado } }),
    ).toEqual([]);
  });

  it("arranca con la caja única; con varias o ninguna, sin elegir", () => {
    const una = cajasParaElegir(HOJA);
    expect(cajaInicial(una)).toBe("caja-1");
    const dos = cajasParaElegir({ ...HOJA, cajas: [CAJA, { ...CAJA, cajaId: "caja-2" }] });
    expect(cajaInicial(dos)).toBe("");
    expect(cajaInicial([])).toBe("");
  });

  it("la línea de la caja dice la fecha de la elegida, y nada si no hay elegida", () => {
    const cajas = cajasParaElegir(HOJA);
    expect(lineaDeLaCaja(cajas, "caja-1")).toBe("Este cobro entra en la caja del 09/11/2026.");
    expect(lineaDeLaCaja(cajas, "")).toBe("");
    expect(lineaDeLaCaja(cajas, "otra")).toBe("");
  });
});

describe("la hoja y el botón", () => {
  it("arma las filas con fechas dd/mm/aaaa, importe en pesos y «Vencida» solo si vence", () => {
    expect(armarLaHoja(HOJA, textos)).toEqual({
      cliente: "Agencia",
      ticket: "4821 · Mostrador · 12/10/2026",
      venceEl: "—",
      vencida: "Vencida",
      total: "$ 1.234,50",
    });
    const salon = armarLaHoja(
      {
        ...HOJA,
        cliente: { id: "cl-1", nombre: null },
        ticket: { ...HOJA.ticket, canal: "SALON", venceEl: "2026-12-09", vencida: false },
      },
      textos,
    );
    expect(salon).toMatchObject({
      cliente: "—",
      ticket: "4821 · Salón · 12/10/2026",
      venceEl: "09/12/2026",
      vencida: null,
    });
  });

  it("el botón dice el total del ticket", () => {
    expect(textoDeCobrar(HOJA)).toBe("Cobrar $ 1.234,50");
  });
});

describe("cuándo se puede cobrar", () => {
  const pago = pagoInicial(HOJA, "p-1");
  const base = { hoja: HOJA, puedeCobrar: true, cajaId: "caja-1", pago };

  it("arranca con el efectivo y el total del ticket como importe", () => {
    expect(pago).toMatchObject({ medioId: "m-efectivo", importe: "1234.50", cuentaId: "" });
    expect(pagoInicial({ ...HOJA, opciones: null }, "p")).toBeNull();
    expect(pagoInicial({ ...HOJA, opciones: { medios: [], marcasDeTarjeta: [] } }, "p")).toBeNull();
  });

  it("se puede con permiso, caja ofrecida y medio ofrecido", () => {
    expect(sePuedeCobrar(base)).toBe(true);
  });

  it.each([
    ["sin permiso", { ...base, puedeCobrar: false }],
    ["sin caja elegida", { ...base, cajaId: "" }],
    ["con una caja que no se ofreció", { ...base, cajaId: "otra" }],
    ["sin pago", { ...base, pago: null }],
    ["sin opciones", { ...base, hoja: { ...HOJA, opciones: null } }],
    [
      "con el día cerrado",
      {
        ...base,
        hoja: {
          ...HOJA,
          jornadaActual: { fechaDeNegocio: "2026-11-09", estado: "CERRADA" as const },
        },
      },
    ],
  ])("no se puede %s", (_caso, entrada) => {
    expect(sePuedeCobrar(entrada)).toBe(false);
  });

  it("un dato del medio mal escrito lo apaga", () => {
    const malo = {
      ...(pago as NonNullable<typeof pago>),
      medioId: "m-debito",
      datos: { cupon: "", ultimos4: "12", marca: "", cuotas: "", dni: "" },
    };
    expect(sePuedeCobrar({ ...base, pago: malo })).toBe(false);
    expect(
      sePuedeCobrar({ ...base, pago: { ...malo, datos: { ...malo.datos, ultimos4: "1234" } } }),
    ).toBe(true);
  });
});

describe("el pedido", () => {
  const pago = pagoInicial(HOJA, "p-1") as NonNullable<ReturnType<typeof pagoInicial>>;

  it("lleva el ticket, el ejemplar, la caja, el medio y la cuenta, y NINGÚN importe", () => {
    expect(pedidoDeCobrarACuenta({ hoja: HOJA, cajaId: "caja-1", pago })).toEqual({
      ticketId: "t-1",
      ejemplarId: "e-1",
      cajaId: "caja-1",
      medioDePagoId: "m-efectivo",
      cuentaDeCobroId: null,
    });
  });

  it("con tarjeta lleva la cuenta y solo los datos escritos que el medio admite (las cuotas, como número)", () => {
    const tarjeta = {
      ...pago,
      medioId: "m-debito",
      cuentaId: "c-1",
      datos: { cupon: "A1", ultimos4: "", marca: "visa", cuotas: "3", dni: "30111222" },
    };
    expect(pedidoDeCobrarACuenta({ hoja: HOJA, cajaId: "caja-1", pago: tarjeta })).toEqual({
      ticketId: "t-1",
      ejemplarId: "e-1",
      cajaId: "caja-1",
      medioDePagoId: "m-debito",
      cuentaDeCobroId: "c-1",
      // «marca» y «dni» no los admite este medio: no viajan.
      datos: { cupon: "A1", cuotas: 3 },
    });
  });

  it("un medio que ya no figura en las opciones no arma pedido", () => {
    expect(
      pedidoDeCobrarACuenta({ hoja: HOJA, cajaId: "caja-1", pago: { ...pago, medioId: "x" } }),
    ).toBeNull();
    expect(
      pedidoDeCobrarACuenta({ hoja: { ...HOJA, opciones: null }, cajaId: "caja-1", pago }),
    ).toBeNull();
  });
});

describe("lo cobrado", () => {
  const COBRADO: TicketCobradoALaCuenta = {
    ticketId: "t-1",
    numero: 4821,
    cobranzaId: "c-1",
    cliente: { id: "cl-1", nombre: "Agencia" },
    total: { moneda: "ARS", monto: "1234.50" },
    fechaDeCobro: "2026-11-09",
    jornadaVencida: false,
    saldoDelCliente: { moneda: "ARS", monto: "-10.00" },
    yaExistia: false,
  };

  it("cuenta ticket, fecha, medio en minúscula, importe del servidor y saldo del cliente", () => {
    expect(armarLoCobrado(COBRADO, DEBITO).detalle).toBe(
      "El ticket 4821 quedó cobrado el 09/11/2026 por tarjeta de débito: $ 1.234,50. El saldo de Agencia bajó a -$ 10,00.",
    );
  });

  it("lo que no se sabe sale «—»: medio que ya no figura, cliente sin nombre y saldo sin permiso", () => {
    const sinNada = { ...COBRADO, cliente: { id: "cl-1", nombre: null }, saldoDelCliente: null };
    expect(armarLoCobrado(sinNada, undefined).detalle).toBe(
      "El ticket 4821 quedó cobrado el 09/11/2026 por —: $ 1.234,50. El saldo de — bajó a —.",
    );
  });
});
