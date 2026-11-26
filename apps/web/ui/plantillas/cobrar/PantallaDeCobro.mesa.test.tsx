import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { restaurarConexion, tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { PantallaDeCobro } from "./PantallaDeCobro.cliente";
import type {
  CobroPreparado,
  MedioParaCobrar,
  TicketAnulado,
  VentaCobrada,
} from "./modelo-de-cobro";
import { textosDeCobrar } from "./textos-de-cobrar";

/**
 * La hoja de cobro en modo «cuenta existente» (SAL-D, cobrar la mesa; DEC-1039: se reutiliza la de la venta rápida): el pedido lleva el id de la cuenta de la mesa y NO lleva líneas ni propina; la clave y el id del ejemplar
 * se fijan una vez por intento (un doble toque es un solo cobro y un reintento repite lo mismo); falta o sobra un centavo apaga «Cobrar»; tras cobrar se ofrece «Anular» con motivo obligatorio (SAL-C2) y el último botón es «Volver».
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
    id: "m-transf",
    tipo: "TRANSFERENCIA",
    nombre: null,
    cuentas: [],
    datosQuePide: nada,
    datosQueSePiden: nada,
  },
];
const LISTO: CobroPreparado = {
  estado: "LISTO",
  cajaId: "caja-1",
  opciones: { medios: MEDIOS, marcasDeTarjeta: [] },
};
const TOTAL = { moneda: "ARS", monto: "12345.67" };
const VENTA: VentaCobrada = {
  ticketId: "ticket-1",
  ejemplarId: "ejemplar-1",
  numero: 7,
  estado: "COBRADO",
  total: TOTAL,
  cobros: [
    {
      medioDePagoId: "m-efectivo",
      cuentaDeCobroId: null,
      importe: { moneda: "ARS", monto: "10000.00" },
    },
    {
      medioDePagoId: "m-transf",
      cuentaDeCobroId: null,
      importe: { moneda: "ARS", monto: "2345.67" },
    },
  ],
};

let contador = 0;
const nuevoId = () => `id-${String(++contador)}`;
type Cobrar = (pedido: unknown) => Promise<Respuesta<VentaCobrada>>;

async function hojaDeLaMesa(cobrar: Cobrar = () => Promise.resolve({ ok: true, dato: VENTA })) {
  const alCobrar = vi.fn<Cobrar>(cobrar);
  const anular = vi.fn<(pedido: unknown) => Promise<Respuesta<TicketAnulado>>>();
  const alNuevaVenta = vi.fn();
  const alVolver = vi.fn();
  await render(
    <PantallaDeCobro
      cuenta={[]}
      total={TOTAL}
      preparado={LISTO}
      textos={textosDeCobrar()}
      cobrar={alCobrar}
      anular={anular}
      imprimir={vi.fn()}
      alVolver={alVolver}
      alNuevaVenta={alNuevaVenta}
      cuentaExistente={{ cuentaId: "cuenta-de-la-mesa" }}
      nuevoId={nuevoId}
      esperaEntreVerificacionesMs={10}
    />,
  );
  return { alCobrar, anular, alNuevaVenta, alVolver };
}

const boton = (nombre: string) => page.getByRole("button", { name: nombre, exact: true });
const importes = () => page.getByRole("textbox", { name: "Importe" });
const pedidoDe = (llamadas: { mock: { calls: unknown[][] } }, n: number) =>
  llamadas.mock.calls[n]?.[0] as Record<string, unknown>;

afterEach(() => {
  restaurarConexion();
});

describe("PantallaDeCobro: modo cuenta existente (cobrar la mesa)", () => {
  it("el pedido lleva la cuenta de la mesa, el total que se vio y los cobros; NO lleva líneas ni propina; sin violaciones de accesibilidad", async () => {
    const { alCobrar } = await hojaDeLaMesa();
    expect(page.getByText("Propina").elements()).toHaveLength(0);
    // $ 10.000,00 en efectivo y $ 2.345,67 por transferencia.
    await userEvent.fill(importes().first(), "10000");
    await userEvent.click(boton("Agregar otro medio"));
    await userEvent.selectOptions(page.getByRole("combobox", { name: "Medio" }).nth(1), "m-transf");
    await expect.element(page.getByText("Cobro completo")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await userEvent.click(boton("Cobrar"));
    await vi.waitFor(() => {
      expect(alCobrar).toHaveBeenCalledTimes(1);
    });
    const pedido = pedidoDe(alCobrar, 0);
    expect(pedido).toMatchObject({
      cuentaId: "cuenta-de-la-mesa",
      totalEsperado: { moneda: "ARS", monto: "12345.67" },
      cajaId: "caja-1",
    });
    expect(Object.keys(pedido)).not.toContain("lineas");
    expect(Object.keys(pedido).sort()).toEqual(
      ["cajaId", "claveIdempotencia", "cobros", "cuentaId", "ejemplarId", "totalEsperado"].sort(),
    );
    expect(
      (pedido["cobros"] as { importe: { monto: string } }[]).map((c) => c.importe.monto),
    ).toEqual(["10000.00", "2345.67"]);
  });

  it("DINERO: un centavo de menos dice «Falta cobrar $ 0,01» y apaga «Cobrar»; un centavo de más con otro medio es «Sobran» y tampoco cobra", async () => {
    const { alCobrar } = await hojaDeLaMesa();
    await userEvent.fill(importes().first(), "10000");
    await userEvent.click(boton("Agregar otro medio"));
    await userEvent.selectOptions(page.getByRole("combobox", { name: "Medio" }).nth(1), "m-transf");
    await userEvent.fill(importes().nth(1), "2345,66");
    await expect.element(page.getByText("Falta cobrar $ 0,01")).toBeVisible();
    await expect.element(boton("Cobrar")).toBeDisabled();
    // Con efectivo, de más es vuelto; con otro medio de más es «Sobran» y no se cobra.
    await userEvent.click(boton("Quitar"));
    await userEvent.selectOptions(
      page.getByRole("combobox", { name: "Medio" }).first(),
      "m-transf",
    );
    await userEvent.fill(importes().first(), "12345,68");
    await expect.element(page.getByText("Sobran $ 0,01")).toBeVisible();
    await expect.element(boton("Cobrar")).toBeDisabled();
    expect(alCobrar).not.toHaveBeenCalled();
  });

  it("IDEMPOTENCIA: un doble toque es UN solo cobro; tras un corte, repetir manda la MISMA clave y el MISMO ejemplar", async () => {
    let intento = 0;
    const { alCobrar } = await hojaDeLaMesa(() => {
      intento += 1;
      return intento === 1
        ? Promise.reject(new Error("sin red"))
        : Promise.resolve({ ok: true, dato: VENTA });
    });
    const cobrar = boton("Cobrar");
    tocar(cobrar);
    tocar(cobrar);
    await vi.waitFor(() => {
      expect(alCobrar.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
    await expect.element(page.getByText("Cobrado")).toBeVisible();
    // Cualquiera haya sido la cantidad de reintentos automáticos, TODOS llevaron lo mismo.
    const claves = new Set(
      alCobrar.mock.calls.map((c) => (c[0] as Record<string, unknown>)["claveIdempotencia"]),
    );
    const ejemplares = new Set(
      alCobrar.mock.calls.map((c) => (c[0] as Record<string, unknown>)["ejemplarId"]),
    );
    expect(claves.size).toBe(1);
    expect(ejemplares.size).toBe(1);
    expect(alCobrar.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("tras cobrar: «Cobrado», el número del ticket, «Imprimir ticket» y «Anular» y «Volver» al salón; NO hay «Nueva venta»", async () => {
    const { alNuevaVenta, anular } = await hojaDeLaMesa();
    await userEvent.click(boton("Cobrar"));
    await expect.element(page.getByText("Cobrado")).toBeVisible();
    await expect.element(page.getByText("Ticket N.º 7")).toBeVisible();
    await expect.element(boton("Imprimir ticket")).toBeVisible();
    await expect.element(boton("Anular")).toBeVisible();
    expect(page.getByRole("button", { name: "Nueva venta", exact: true }).elements()).toHaveLength(
      0,
    );
    await userEvent.click(boton("Volver"));
    expect(alNuevaVenta).toHaveBeenCalledTimes(1);
    expect(anular).not.toHaveBeenCalled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("ANULAR el cobro: pide motivo, manda el ejemplar del cobro, queda «Anulado» y sigue «Volver»", async () => {
    const { anular, alNuevaVenta } = await hojaDeLaMesa();
    anular.mockResolvedValue({
      ok: true,
      dato: {
        ticketId: "ticket-1",
        numero: 7,
        estado: "ANULADO",
      },
    });
    await userEvent.click(boton("Cobrar"));
    await expect.element(page.getByText("Cobrado")).toBeVisible();
    await userEvent.click(boton("Anular"));
    const delCuadro = (nombre: string) =>
      page.getByRole("dialog").getByRole("button", { name: nombre, exact: true });
    await userEvent.click(delCuadro("Anular"));
    await expect.element(page.getByText("Escribí el motivo")).toBeVisible();
    expect(anular).not.toHaveBeenCalled();
    await userEvent.fill(page.getByRole("textbox", { name: /Motivo/ }), "Se cobró de más");
    await userEvent.click(delCuadro("Anular"));
    await expect.element(page.getByText("Anulado", { exact: true }).first()).toBeVisible();
    expect(anular).toHaveBeenCalledTimes(1);
    expect(pedidoDe(anular, 0)).toMatchObject({
      ticketId: "ticket-1",
      ejemplarBaseId: "ejemplar-1",
      motivo: "Se cobró de más",
    });
    await userEvent.click(boton("Volver"));
    expect(alNuevaVenta).toHaveBeenCalledTimes(1);
  });

  it("un rechazo del servidor sale como el genérico y se puede volver al cobro sin cobrar nada más", async () => {
    const { alCobrar } = await hojaDeLaMesa(() =>
      Promise.resolve({ ok: false, error: errorDeCodigo("CAJA_ACCION_NO_PERMITIDA") }),
    );
    await userEvent.click(boton("Cobrar"));
    await expect.element(page.getByText("No se pudo cobrar. No se cobró nada.")).toBeVisible();
    expect(alCobrar).toHaveBeenCalledTimes(1);
  });
});
