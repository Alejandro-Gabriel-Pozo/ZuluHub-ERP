import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { restaurarConexion, tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { LineaDeLaVenta } from "../venta/modelo-de-la-cuenta";
import { PantallaDeCobro } from "./PantallaDeCobro.cliente";
import type { CobroPreparado, TicketAnulado, VentaCobrada } from "./modelo-de-cobro";
import type { PapelDeTicket } from "./PapelDelTicket.cliente";
import { textosDeCobrar } from "./textos-de-cobrar";

// «Imprimir ticket» desde el resultado del cobro (PR-5): pide el papel al servidor UNA vez por toque, muestra «Ticket del cliente», vuelve al resultado y no se ofrece tras anular.

const nada = { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false };
const LISTO: CobroPreparado = {
  estado: "LISTO",
  cajaId: "caja-1",
  opciones: {
    medios: [{ id: "m-efectivo", tipo: "EFECTIVO", nombre: null, cuentas: [], datosQuePide: nada }],
    marcasDeTarjeta: [],
  },
};
const cuenta: readonly LineaDeLaVenta[] = [
  { clave: "l1", productoId: "p1", varianteId: null, opcionIds: [], cantidad: 20_000, revision: 0 },
];
const TOTAL = { moneda: "ARS", monto: "3000.00" };
const VENTA: VentaCobrada = {
  ticketId: "ticket-1",
  ejemplarId: "ejemplar-1",
  numero: 12,
  estado: "COBRADO",
  total: TOTAL,
  cobros: [
    {
      medioDePagoId: "m-efectivo",
      cuentaDeCobroId: null,
      importe: { moneda: "ARS", monto: "3000.00" },
    },
  ],
};
const PAPEL: PapelDeTicket = {
  ancho: 80,
  lineas: [
    { texto: "Ticket N.º 12", estilo: "NEGRITA" },
    { texto: "18/11/2026", estilo: "NORMAL" },
    { texto: "", estilo: "SEPARADOR" },
    { texto: "2 Milanesa                               3.000,00", estilo: "NORMAL" },
    { texto: "", estilo: "SEPARADOR" },
    { texto: "Total                                    3.000,00", estilo: "NEGRITA" },
  ],
};
const GENERICO = { ok: false, error: errorDeCodigo("CAJA_ACCION_NO_PERMITIDA") } as const;

type Imprimir = (pedido: unknown) => Promise<Respuesta<PapelDeTicket>>;
let contador = 0;
const nuevoId = () => `imp-${String(++contador)}`;

async function cobrada(imprimir: Imprimir = () => Promise.resolve({ ok: true, dato: PAPEL })) {
  const pedir = vi.fn<Imprimir>(imprimir);
  const anular = vi.fn<(p: unknown) => Promise<Respuesta<TicketAnulado>>>(() =>
    Promise.resolve({
      ok: true,
      dato: { ticketId: "ticket-1", numero: 12, estado: "ANULADO" },
    }),
  );
  await render(
    <PantallaDeCobro
      cuenta={cuenta}
      total={TOTAL}
      preparado={LISTO}
      textos={textosDeCobrar()}
      cobrar={() => Promise.resolve({ ok: true, dato: VENTA })}
      anular={anular}
      imprimir={pedir}
      alVolver={() => undefined}
      alNuevaVenta={() => undefined}
      nuevoId={nuevoId}
      esperaEntreVerificacionesMs={10}
    />,
  );
  await userEvent.click(page.getByRole("button", { name: "Cobrar", exact: true }));
  await expect.element(page.getByText("Ticket N.º 12")).toBeVisible();
  return { pedir, anular };
}

const boton = (nombre: string) => page.getByRole("button", { name: nombre, exact: true });

afterEach(() => {
  restaurarConexion();
  vi.restoreAllMocks();
});

describe("PantallaDeCobro: «Imprimir ticket»", () => {
  it("pide el papel con solo el ticketId y muestra «Ticket del cliente» en lugar del resultado, con las líneas en orden y el foco en el título", async () => {
    const { pedir } = await cobrada();
    await userEvent.click(boton("Imprimir ticket"));
    await expect.element(page.getByRole("heading", { name: "Ticket del cliente" })).toBeVisible();
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(pedir).toHaveBeenCalledWith({ ticketId: "ticket-1" });
    const lineas = Array.from(document.querySelectorAll("[data-linea-del-papel]")).map(
      (l) => l.textContent,
    );
    expect(lineas).toEqual([
      "Ticket N.º 12",
      "18/11/2026",
      "2 Milanesa                               3.000,00",
      "Total                                    3.000,00",
    ]);
    expect(document.querySelectorAll('[data-estilo="NEGRITA"]')).toHaveLength(2);
    expect(document.querySelectorAll("hr")).toHaveLength(2);
    expect(document.activeElement?.tagName).toBe("H2");
    expect(document.activeElement?.textContent).toBe("Ticket del cliente");
    // El resultado ya no se dibuja y hay un solo título.
    expect(document.querySelectorAll("h2")).toHaveLength(1);
    expect(page.getByRole("button", { name: "Anular", exact: true }).elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("un doble toque pide el papel una sola vez", async () => {
    let entregar: (r: Respuesta<PapelDeTicket>) => void = () => undefined;
    const { pedir } = await cobrada(
      () =>
        new Promise<Respuesta<PapelDeTicket>>((resolver) => {
          entregar = resolver;
        }),
    );
    const b = boton("Imprimir ticket");
    // Dos toques en el mismo instante: el DOM los entrega antes de que React repinte el botón ocupado.
    tocar(b);
    tocar(b);
    await expect.element(b).toHaveAttribute("aria-busy", "true");
    expect(pedir).toHaveBeenCalledTimes(1);
    await expect.element(b).toHaveAttribute("aria-busy", "true");
    entregar({ ok: true, dato: PAPEL });
    await expect.element(page.getByRole("heading", { name: "Ticket del cliente" })).toBeVisible();
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it("«Imprimir» abre el diálogo del navegador una vez por toque y no está dentro de la zona de impresión", async () => {
    await cobrada();
    await userEvent.click(boton("Imprimir ticket"));
    await expect.element(page.getByRole("heading", { name: "Ticket del cliente" })).toBeVisible();
    const imprimir = vi.spyOn(window, "print").mockImplementation(() => undefined);
    await userEvent.click(boton("Imprimir"));
    expect(imprimir).toHaveBeenCalledTimes(1);
    await userEvent.click(boton("Imprimir"));
    expect(imprimir).toHaveBeenCalledTimes(2);
    const zona = document.querySelector("[data-zona-de-impresion]");
    expect(zona).not.toBeNull();
    expect(zona?.querySelector("button")).toBeNull();
    expect(zona?.textContent).toContain("Ticket N.º 12");
    expect(zona?.contains(boton("Imprimir").element())).toBe(false);
  });

  it("«Volver» deja el resultado como estaba y se puede volver a imprimir", async () => {
    const { pedir } = await cobrada();
    await userEvent.click(boton("Imprimir ticket"));
    await expect.element(page.getByRole("heading", { name: "Ticket del cliente" })).toBeVisible();
    await userEvent.click(boton("Volver"));
    await expect.element(page.getByText("Ticket N.º 12")).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Resultado" })).toBeVisible();
    await expect.element(boton("Anular")).toBeVisible();
    await expect.element(boton("Nueva venta")).toBeVisible();
    expect(document.querySelector("[data-zona-de-impresion]")).toBeNull();
    await userEvent.click(boton("Imprimir ticket"));
    await expect.element(page.getByRole("heading", { name: "Ticket del cliente" })).toBeVisible();
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it("si la lectura falla se ve el error, no se muestra ticket y se puede reintentar", async () => {
    let n = 0;
    const { pedir } = await cobrada(() =>
      Promise.resolve(++n === 1 ? GENERICO : { ok: true, dato: PAPEL }),
    );
    await userEvent.click(boton("Imprimir ticket"));
    await expect.poll(() => pedir.mock.calls.length).toBe(1);
    await expect.element(boton("Imprimir ticket")).toBeVisible();
    expect(document.querySelector("[data-zona-de-impresion]")).toBeNull();
    expect(document.querySelectorAll("[data-linea-del-papel]")).toHaveLength(0);
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    await userEvent.click(boton("Imprimir ticket"));
    await expect.element(page.getByRole("heading", { name: "Ticket del cliente" })).toBeVisible();
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it("tras anular no hay «Imprimir ticket»", async () => {
    await cobrada();
    await userEvent.click(boton("Anular"));
    await userEvent.fill(page.getByRole("textbox", { name: "Motivo" }), "Error de carga");
    await userEvent.click(
      page.getByRole("dialog").getByRole("button", { name: "Anular", exact: true }),
    );
    await expect.element(page.getByText("Anulado")).toBeVisible();
    expect(page.getByRole("button", { name: /Imprimir/ }).elements()).toHaveLength(0);
  });
});
