import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import {
  restaurarConexion,
  simularConexion,
  tocar,
  violacionesDeAccesibilidad,
} from "../../pruebas/ayudas";
import type { MedioParaCobrar } from "../cobrar/modelo-de-cobro";
import { textosDeCobrar } from "../cobrar/textos-de-cobrar";
import { PantallaDeCobrarACuenta } from "./PantallaDeCobrarACuenta.cliente";
import type { HojaParaCobrarALaCuenta, TicketCobradoALaCuenta } from "./modelo-de-cobrar-a-cuenta";
import { textosDeCobrarACuenta } from "./textos-de-cobrar-a-cuenta";

/**
 * «Cobrar un ticket a cuenta» (CC-5 B2b) en Chromium: lo que se ve, cuándo «Cobrar» se apaga, qué pedido sale (sin importe), el doble toque, el corte de red, el rechazo y el estado «Cobrado».
 * Lo que valida de verdad (permiso, caja, jornada, total, ticket ya cobrado) lo decide el servidor: acá solo se ve qué se ofrece y qué se manda.
 */
const nada = { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false };
const MEDIOS: readonly MedioParaCobrar[] = [
  {
    id: "m-efectivo",
    tipo: "EFECTIVO",
    nombre: null,
    cuentas: [],
    datosQuePide: nada,
    datosQueSePiden: nada,
  },
  {
    id: "m-debito",
    tipo: "TARJETA_DEBITO",
    nombre: null,
    cuentas: [{ id: "c-posnet", tipo: "TERMINAL", nombre: "Posnet 1" }],
    datosQuePide: { ...nada, cupon: true, ultimos4: true, marca: true },
    datosQueSePiden: nada,
  },
];
const CAJA_ABIERTA = {
  cajaId: "caja-1",
  nombre: "Caja 1",
  estado: "ABIERTA" as const,
  sesionId: "sesion-1",
  fechaDeNegocio: "2026-11-09",
  jornadaVencida: false,
};
const HOJA: HojaParaCobrarALaCuenta = {
  cliente: { id: "cliente-1", nombre: "Turismo Andino S. A." },
  ticket: {
    ticketId: "ticket-1",
    numero: 4821,
    canal: "SALON",
    sucursalId: "sucursal-1",
    fechaNegocio: "2026-10-12",
    ejemplarId: "ejemplar-1",
    total: { moneda: "ARS", monto: "1000.00" },
    venceEl: "2026-12-09",
    vencida: false,
    sucursal: "Centro",
  },
  cajas: [CAJA_ABIERTA],
  jornadaActual: { fechaDeNegocio: "2026-11-09", estado: "ABIERTA" },
  opciones: { medios: MEDIOS, marcasDeTarjeta: [{ id: "visa", nombre: "Visa" }] },
};
const COBRADO: TicketCobradoALaCuenta = {
  ticketId: "ticket-1",
  numero: 4821,
  cobranzaId: "cobranza-1",
  cliente: { id: "cliente-1", nombre: "Turismo Andino S. A." },
  total: { moneda: "ARS", monto: "1000.00" },
  fechaDeCobro: "2026-11-09",
  jornadaVencida: false,
  saldoDelCliente: { moneda: "ARS", monto: "250.00" },
  yaExistia: false,
};
const GENERICO = { ok: false, error: errorDeCodigo("CAJA_ACCION_NO_PERMITIDA") } as const;

let contador = 0;
const nuevoId = () => `id-${String(++contador)}`;
type Cobrar = (pedido: unknown) => Promise<Respuesta<TicketCobradoALaCuenta>>;

async function pantalla(
  o: Partial<{ hoja: HojaParaCobrarALaCuenta; puedeCobrar: boolean; cobrar: Cobrar }> = {},
) {
  const cobrar = vi.fn<Cobrar>(o.cobrar ?? (() => Promise.resolve({ ok: true, dato: COBRADO })));
  await render(
    <PantallaDeCobrarACuenta
      hoja={o.hoja ?? HOJA}
      textos={textosDeCobrarACuenta()}
      textosDeCobrar={textosDeCobrar()}
      puedeCobrar={o.puedeCobrar ?? true}
      cobrar={cobrar}
      hrefDeLaFicha="/caja/cuenta-corriente/cliente-1"
      hrefDeCobrarOtro="/caja/cuenta-corriente/cliente-1/cobrar"
      nuevoId={nuevoId}
      esperaEntreVerificacionesMs={10}
    />,
  );
  return { cobrar };
}

const COBRAR = "Cobrar $ 1.000,00";
const boton = (nombre: string) => page.getByRole("button", { name: nombre, exact: true });
const medio = () => page.getByRole("combobox", { name: "Medio de cobro" });
const caja = () => page.getByRole("combobox", { name: "Caja donde entra el cobro" });
const pedidoDe = (llamadas: { mock: { calls: unknown[][] } }, n: number) =>
  llamadas.mock.calls[n]?.[0] as Record<string, unknown>;

afterEach(() => {
  restaurarConexion();
});

describe("PantallaDeCobrarACuenta: la hoja", () => {
  it("muestra el cliente, el ticket, el vencimiento y el total; arranca con efectivo y la única caja abierta; sin violaciones de accesibilidad", async () => {
    await pantalla();
    await expect.element(page.getByText("Turismo Andino S. A.")).toBeVisible();
    await expect.element(page.getByText("4821 · Salón · 12/10/2026")).toBeVisible();
    await expect.element(page.getByText("09/12/2026")).toBeVisible();
    await expect.element(page.getByText("$ 1.000,00", { exact: true })).toBeVisible();
    await expect.element(medio()).toHaveValue("m-efectivo");
    await expect.element(caja()).toHaveValue("caja-1");
    await expect
      .element(page.getByRole("option", { name: "Caja 1 · Centro · sesión abierta hoy" }))
      .toBeInTheDocument();
    await expect
      .element(page.getByText("Este cobro entra en la caja del 09/11/2026."))
      .toBeVisible();
    await expect.element(boton(COBRAR)).toBeEnabled();
    expect(page.getByText("Vencida", { exact: true }).elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("un cargo vencido lleva la insignia «Vencida»", async () => {
    await pantalla({ hoja: { ...HOJA, ticket: { ...HOJA.ticket, vencida: true } } });
    await expect.element(page.getByText("Vencida", { exact: true })).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Cancelar» vuelve a la ficha: es un enlace, no manda nada", async () => {
    const { cobrar } = await pantalla();
    await expect
      .element(page.getByRole("link", { name: "Cancelar" }))
      .toHaveAttribute("href", "/caja/cuenta-corriente/cliente-1");
    expect(cobrar).not.toHaveBeenCalled();
  });

  it("solo ofrece los datos que el medio admite; un dato mal escrito apaga «Cobrar» hasta corregirlo", async () => {
    await pantalla();
    expect(page.getByRole("textbox", { name: /Cupón/ }).elements()).toHaveLength(0);
    await userEvent.selectOptions(medio(), "m-debito");
    await expect.element(page.getByRole("textbox", { name: "Cupón (opcional)" })).toBeVisible();
    await userEvent.fill(page.getByRole("textbox", { name: "Últimos 4 dígitos (opcional)" }), "12");
    await expect.element(page.getByText("Escribí 4 dígitos")).toBeVisible();
    await expect.element(boton(COBRAR)).toBeDisabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await userEvent.fill(page.getByRole("textbox", { name: "Últimos 4 dígitos (opcional)" }), "");
    await expect.element(boton(COBRAR)).toBeEnabled();
  });
});

describe("PantallaDeCobrarACuenta: lo que apaga «Cobrar»", () => {
  it("sin permiso para cobrar, «Cobrar» sale apagado y no se manda nada", async () => {
    const { cobrar } = await pantalla({ puedeCobrar: false });
    await expect.element(boton(COBRAR)).toBeDisabled();
    expect(cobrar).not.toHaveBeenCalled();
  });

  it.each([
    [
      "no hay ninguna caja con la sesión abierta",
      {
        cajas: [
          { ...CAJA_ABIERTA, estado: "SIN_SESION" as const, sesionId: null, fechaDeNegocio: null },
        ],
      },
    ],
    [
      "la caja quedó abierta de un día anterior",
      { cajas: [{ ...CAJA_ABIERTA, jornadaVencida: true }] },
    ],
    [
      "el día está en auditoría",
      { jornadaActual: { fechaDeNegocio: "2026-11-09", estado: "EN_AUDITORIA" as const } },
    ],
    [
      "el día está cerrado",
      { jornadaActual: { fechaDeNegocio: "2026-11-09", estado: "CERRADA" as const } },
    ],
  ])("si %s, avisa «Sin caja abierta hoy…» y «Cobrar» queda apagado", async (_caso, cambios) => {
    const { cobrar } = await pantalla({ hoja: { ...HOJA, ...cambios } });
    await expect.element(page.getByText(/Sin caja abierta hoy no se puede cobrar/)).toBeVisible();
    expect(
      page.getByRole("combobox", { name: "Caja donde entra el cobro" }).elements(),
    ).toHaveLength(0);
    await expect.element(boton(COBRAR)).toBeDisabled();
    expect(cobrar).not.toHaveBeenCalled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("con varias cajas abiertas no se elige una por el cajero: «Cobrar» espera a que se elija", async () => {
    const otra = { ...CAJA_ABIERTA, cajaId: "caja-2", nombre: "Caja 2", sesionId: "sesion-2" };
    const { cobrar } = await pantalla({ hoja: { ...HOJA, cajas: [CAJA_ABIERTA, otra] } });
    await expect.element(caja()).toHaveValue("");
    await expect.element(boton(COBRAR)).toBeDisabled();
    await userEvent.selectOptions(caja(), "caja-2");
    await expect.element(boton(COBRAR)).toBeEnabled();
    await userEvent.click(boton(COBRAR));
    await expect.poll(() => cobrar.mock.calls.length).toBe(1);
    expect(pedidoDe(cobrar, 0)["cajaId"]).toBe("caja-2");
  });

  it("sin medios que ofrecer (o sin opciones) no se puede cobrar: nace cerrado", async () => {
    await pantalla({ hoja: { ...HOJA, opciones: null } });
    await expect.element(boton(COBRAR)).toBeDisabled();
  });

  it("sin conexión no se puede enviar: «Cobrar» apagado con su motivo", async () => {
    const { cobrar } = await pantalla();
    simularConexion(false);
    await expect.element(page.getByText("No se puede enviar sin conexión.")).toBeVisible();
    await expect.element(boton(COBRAR)).toBeDisabled();
    expect(cobrar).not.toHaveBeenCalled();
    simularConexion(true);
    await expect.element(boton(COBRAR)).toBeEnabled();
  });
});

describe("PantallaDeCobrarACuenta: cobrar", () => {
  it("manda el ticket, el ejemplar, la caja, el medio y la clave, y NINGÚN importe", async () => {
    const { cobrar } = await pantalla();
    await userEvent.click(boton(COBRAR));
    await expect.poll(() => cobrar.mock.calls.length).toBe(1);
    const pedido = pedidoDe(cobrar, 0);
    expect(typeof pedido["claveIdempotencia"]).toBe("string");
    expect(pedido).toMatchObject({
      ticketId: "ticket-1",
      ejemplarId: "ejemplar-1",
      cajaId: "caja-1",
      medioDePagoId: "m-efectivo",
      cuentaDeCobroId: null,
    });
    expect(Object.keys(pedido).sort()).toEqual([
      "cajaId",
      "claveIdempotencia",
      "cuentaDeCobroId",
      "ejemplarId",
      "medioDePagoId",
      "ticketId",
    ]);
  });

  it("con tarjeta manda la cuenta de cobro y solo los datos escritos", async () => {
    const { cobrar } = await pantalla();
    await userEvent.selectOptions(medio(), "m-debito");
    await userEvent.selectOptions(
      page.getByRole("combobox", { name: "Cuenta de cobro" }),
      "c-posnet",
    );
    await userEvent.fill(page.getByRole("textbox", { name: "Cupón (opcional)" }), "A123");
    await userEvent.selectOptions(
      page.getByRole("combobox", { name: "Marca de la tarjeta (opcional)" }),
      "visa",
    );
    await userEvent.click(boton(COBRAR));
    await expect.poll(() => cobrar.mock.calls.length).toBe(1);
    expect(pedidoDe(cobrar, 0)).toMatchObject({
      medioDePagoId: "m-debito",
      cuentaDeCobroId: "c-posnet",
      datos: { cupon: "A123", marcaDeTarjetaId: "visa" },
    });
  });

  it("DOBLE TOQUE: un solo envío; al volver pasa a «Cobrado» con el saldo del cliente y las dos salidas", async () => {
    let resolver: (r: Respuesta<TicketCobradoALaCuenta>) => void = () => undefined;
    const { cobrar } = await pantalla({
      cobrar: () =>
        new Promise((r) => {
          resolver = r;
        }),
    });
    const cobrarBoton = boton(COBRAR);
    tocar(cobrarBoton);
    tocar(cobrarBoton);
    await expect.poll(() => cobrar.mock.calls.length).toBe(1);
    await new Promise((r) => setTimeout(r, 100));
    expect(cobrar).toHaveBeenCalledTimes(1);
    // Mientras corre no se edita.
    await expect.element(medio()).toBeDisabled();
    resolver({ ok: true, dato: COBRADO });
    await expect.element(page.getByText("Cobrado", { exact: true })).toBeVisible();
    await expect
      .element(
        page.getByText(
          "El ticket 4821 quedó cobrado el 09/11/2026 por efectivo: $ 1.000,00. El saldo de Turismo Andino S. A. bajó a $ 250,00.",
        ),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Ver la cuenta del cliente" }))
      .toHaveAttribute("href", "/caja/cuenta-corriente/cliente-1");
    await expect
      .element(page.getByRole("link", { name: "Cobrar otro ticket" }))
      .toHaveAttribute("href", "/caja/cuenta-corriente/cliente-1/cobrar");
    expect(page.getByRole("button", { name: /^Cobrar \$/ }).elements()).toHaveLength(0);
    expect(cobrar).toHaveBeenCalledTimes(1);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("CORTE DE RED: reintenta con la MISMA clave y el MISMO pedido, y se cobra una sola vez", async () => {
    let intento = 0;
    const { cobrar } = await pantalla({
      cobrar: () => {
        intento += 1;
        return intento === 1
          ? Promise.reject(new Error("red"))
          : Promise.resolve({ ok: true, dato: COBRADO });
      },
    });
    await userEvent.click(boton(COBRAR));
    await expect.element(page.getByText("Cobrado", { exact: true })).toBeVisible();
    expect(cobrar).toHaveBeenCalledTimes(2);
    expect(pedidoDe(cobrar, 1)).toEqual(pedidoDe(cobrar, 0));
  });

  it("un resultado INESPERADO no se da por definitivo: se reintenta con la misma clave", async () => {
    let intento = 0;
    const { cobrar } = await pantalla({
      cobrar: () => {
        intento += 1;
        const respuesta: Respuesta<TicketCobradoALaCuenta> =
          intento === 1
            ? {
                ok: false,
                error: { ...errorDeCodigo("ERROR_INTERNO"), presentacion: "INESPERADO" as const },
              }
            : { ok: true, dato: COBRADO };
        return Promise.resolve(respuesta);
      },
    });
    await userEvent.click(boton(COBRAR));
    await expect.element(page.getByText("Cobrado", { exact: true })).toBeVisible();
    expect(cobrar).toHaveBeenCalledTimes(2);
    expect(pedidoDe(cobrar, 1)["claveIdempotencia"]).toBe(pedidoDe(cobrar, 0)["claveIdempotencia"]);
  });

  it("si esa clave ya había cobrado (`yaExistia`) muestra lo hecho: «Cobrado», sin un segundo cobro", async () => {
    await pantalla({
      cobrar: () => Promise.resolve({ ok: true, dato: { ...COBRADO, yaExistia: true } }),
    });
    await userEvent.click(boton(COBRAR));
    await expect.element(page.getByText("Cobrado", { exact: true })).toBeVisible();
  });

  it("sin permiso para ver la cuenta el saldo sale «—» y el cobro no se esconde", async () => {
    await pantalla({
      cobrar: () => Promise.resolve({ ok: true, dato: { ...COBRADO, saldoDelCliente: null } }),
    });
    await userEvent.click(boton(COBRAR));
    await expect
      .element(page.getByText(/El saldo de Turismo Andino S. A. bajó a —\./))
      .toBeVisible();
  });

  it("un rechazo del servidor lo dice, no pasa a «Cobrado» y el siguiente intento lleva otra clave", async () => {
    let intento = 0;
    const { cobrar } = await pantalla({
      cobrar: () => {
        intento += 1;
        return Promise.resolve(intento === 1 ? GENERICO : { ok: true, dato: COBRADO });
      },
    });
    await userEvent.click(boton(COBRAR));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(page.getByText("Cobrado", { exact: true }).elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await userEvent.click(boton(COBRAR));
    await expect.element(page.getByText("Cobrado", { exact: true })).toBeVisible();
    expect(pedidoDe(cobrar, 1)["claveIdempotencia"]).not.toBe(
      pedidoDe(cobrar, 0)["claveIdempotencia"],
    );
  });
});
