import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { MAXIMO_DE_PARTES_POR_PORCENTAJE } from "../../../../../src/primitivas/cuentas/limites-de-division";
import { restaurarConexion, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { PantallaDeCobro } from "./PantallaDeCobro.cliente";
import type { CobroPreparado, MedioParaCobrar, VentaCobrada } from "./modelo-de-cobro";
import { textosDeCobrar } from "./textos-de-cobrar";
import { textosDeDividirEnElCobro } from "./textos-de-dividir-en-el-cobro";

/**
 * «Dividir la cuenta» por porcentaje dentro del cobro de una mesa (SAL-E3): dividir es UN ticket con varios cobros. La hoja propone los importes de cada parte (la 1 es el resto hasta 100 %) y «Usar en el cobro» solo carga las filas
 * de cobro, cada una con su medio; no cobra nada. El pedido que llega al servidor es el de siempre: la cuenta de la mesa y un cobro por parte, y la suma de los importes es el total al centavo.
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
// Con un centavo suelto: en tres partes iguales sobra uno y va a la parte 1.
const TOTAL = { moneda: "ARS", monto: "100.01" };
const VENTA: VentaCobrada = {
  ticketId: "ticket-1",
  ejemplarId: "ejemplar-1",
  numero: 7,
  estado: "COBRADO",
  total: TOTAL,
  cobros: [],
};

let contador = 0;
const nuevoId = () => `id-${String(++contador)}`;
type Cobrar = (pedido: unknown) => Promise<Respuesta<VentaCobrada>>;

async function hojaDeLaMesa(opciones: { conReparto?: boolean } = {}) {
  const alCobrar = vi.fn<Cobrar>(() => Promise.resolve({ ok: true, dato: VENTA }));
  await render(
    <PantallaDeCobro
      cuenta={[]}
      total={TOTAL}
      preparado={LISTO}
      textos={textosDeCobrar()}
      dividirPorPorcentaje={opciones.conReparto === false ? undefined : textosDeDividirEnElCobro()}
      cobrar={alCobrar}
      anular={vi.fn()}
      imprimir={vi.fn()}
      alVolver={vi.fn()}
      alNuevaVenta={vi.fn()}
      cuentaExistente={{ cuentaId: "cuenta-de-la-mesa" }}
      nuevoId={nuevoId}
      esperaEntreVerificacionesMs={10}
    />,
  );
  return { alCobrar };
}

const boton = (nombre: string) => page.getByRole("button", { name: nombre, exact: true });
const importes = () => page.getByRole("textbox", { name: "Importe" });

afterEach(() => {
  restaurarConexion();
});

describe("PantallaDeCobro: dividir la cuenta por porcentaje (SAL-E3)", () => {
  it("sin los textos de dividir (el mostrador) no se ofrece «Dividir la cuenta»", async () => {
    await hojaDeLaMesa({ conReparto: false });
    expect(boton("Dividir la cuenta").elements()).toHaveLength(0);
  });

  it("la hoja empieza con la parte 1 al 100 % y «Usar en el cobro» apagado hasta agregar otra parte; sin violaciones de accesibilidad", async () => {
    await hojaDeLaMesa();
    await userEvent.click(boton("Dividir la cuenta"));
    await expect.element(page.getByRole("heading", { name: "Por porcentaje" })).toBeVisible();
    await expect.element(page.getByText("100.00 %")).toBeVisible();
    await expect.element(boton("Usar en el cobro")).toBeDisabled();
    await userEvent.click(boton("Agregar parte"));
    await expect.element(boton("Usar en el cobro")).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("tres partes iguales con un centavo suelto: el centavo va a la parte 1; «Usar en el cobro» carga tres filas con un medio distinto cada una y los cobros del pedido suman el total al centavo", async () => {
    const { alCobrar } = await hojaDeLaMesa();
    await userEvent.click(boton("Dividir la cuenta"));
    await userEvent.click(boton("Agregar parte"));
    await userEvent.click(boton("Agregar parte"));
    await userEvent.click(boton("Usar en el cobro"));
    await expect.element(page.getByText("Cobro completo")).toBeVisible();
    expect(importes().elements()).toHaveLength(3);
    await userEvent.click(boton("Cobrar"));
    await vi.waitFor(() => {
      expect(alCobrar).toHaveBeenCalledTimes(1);
    });
    const pedido = alCobrar.mock.calls[0]?.[0] as {
      cuentaId: string;
      totalEsperado: { monto: string };
      cobros: { importe: { monto: string } }[];
    };
    expect(pedido.cuentaId).toBe("cuenta-de-la-mesa");
    expect(pedido.totalEsperado.monto).toBe("100.01");
    // Parte 1 en efectivo (33,34), parte 2 por transferencia (33,34) y parte 3 otra vez en efectivo (33,33): el efectivo se junta en una fila.
    expect(pedido.cobros.map((c) => c.importe.monto)).toEqual(["66.67", "33.34"]);
  });

  it("escribir un porcentaje cambia los importes; uno que deja la parte 1 en cero apaga «Usar en el cobro»; volver a la hoja de cobro no carga nada", async () => {
    await hojaDeLaMesa();
    await userEvent.click(boton("Dividir la cuenta"));
    await userEvent.click(boton("Agregar parte"));
    await userEvent.fill(page.getByRole("textbox", { name: "Parte 2 (%)" }), "10");
    await expect.element(page.getByText("90.00 %")).toBeVisible();
    await userEvent.fill(page.getByRole("textbox", { name: "Parte 2 (%)" }), "100");
    await expect.element(boton("Usar en el cobro")).toBeDisabled();
    await userEvent.click(page.getByRole("button", { name: "Volver al cobro" }));
    // Sigue la hoja de cobro de siempre, con su única fila por el total.
    expect(importes().elements()).toHaveLength(1);
    await expect.element(boton("Dividir la cuenta")).toBeVisible();
  });

  it("agregar parte llega al máximo de la primitiva de límites y se apaga; quitar una parte deja agregar otra", async () => {
    await hojaDeLaMesa();
    await userEvent.click(boton("Dividir la cuenta"));
    for (let i = 1; i < MAXIMO_DE_PARTES_POR_PORCENTAJE; i++) {
      await userEvent.click(boton("Agregar parte"));
    }
    await expect.element(boton("Agregar parte")).toBeDisabled();
    expect(page.getByRole("textbox", { name: /^Parte \d+ \(%\)$/ }).elements()).toHaveLength(
      MAXIMO_DE_PARTES_POR_PORCENTAJE - 1,
    );
    await userEvent.click(boton("Quitar").first());
    await expect.element(boton("Agregar parte")).toBeEnabled();
  });
});
