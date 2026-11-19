import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import {
  type CobroPreparado,
  type TicketAnulado,
  type VentaCobrada,
} from "../cobrar/modelo-de-cobro";
import { textosDeCobrar } from "../cobrar/textos-de-cobrar";
import { PantallaDeVentaRapida } from "./PantallaDeVentaRapida.cliente";
import type { CotizacionDeLaVenta } from "./modelo-de-la-cuenta";
import { textosDeLaVenta, type ProductoDeLaVenta } from "./modelo-de-venta-rapida";

/**
 * La unión entre armar la cuenta y cobrarla: «Cobrar» solo existe si la página lo declara, se apaga sin cuenta o con total en cero, abre la hoja con el total que cotizó el servidor para ESTA cuenta y, al
 * terminar la venta (cobrada), la cuenta queda vacía. Lo demás de la hoja se prueba en `../cobrar/PantallaDeCobro.test.tsx`.
 */

const medialuna: ProductoDeLaVenta = {
  id: "medialuna",
  nombre: "Medialuna",
  seccionId: "comer",
  unidadDeVentaId: "UNIDAD",
  codigo: null,
  codigoDeBarras: null,
  pasoMinimo: "1.0000",
  porcionesOfrecidas: [],
  variante: null,
  grupos: [],
  precio: { tipo: "BASE", importe: "800.00" },
};
const secciones = [{ id: "comer", nombre: "Para comer" }] as const;
const cotizacion = (monto: string): CotizacionDeLaVenta => ({
  total: { moneda: "ARS", monto },
  lineas: [{ precioUnitario: { moneda: "ARS", monto }, importe: { moneda: "ARS", monto } }],
});
const LISTO: CobroPreparado = {
  estado: "LISTO",
  cajaId: "caja-1",
  opciones: {
    medios: [
      {
        id: "m-efectivo",
        tipo: "EFECTIVO",
        nombre: null,
        cuentas: [],
        datosQuePide: { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false },
      },
    ],
    marcasDeTarjeta: [],
  },
};
const VENTA: VentaCobrada = {
  ticketId: "t1",
  ejemplarId: "e1",
  numero: 7,
  estado: "COBRADO",
  total: { moneda: "ARS", monto: "800.00" },
  cobros: [
    {
      medioDePagoId: "m-efectivo",
      cuentaDeCobroId: null,
      importe: { moneda: "ARS", monto: "800.00" },
    },
  ],
};

async function pantalla(opciones: { conCobro?: boolean; total?: string } = {}) {
  const cobrar = vi.fn<(p: unknown) => Promise<Respuesta<VentaCobrada>>>(() =>
    Promise.resolve({ ok: true, dato: VENTA }),
  );
  const anular = vi.fn<(p: unknown) => Promise<Respuesta<TicketAnulado>>>();
  await render(
    <PantallaDeVentaRapida
      secciones={secciones}
      productos={[medialuna]}
      textos={textosDeLaVenta()}
      cotizar={() => Promise.resolve({ ok: true, dato: cotizacion(opciones.total ?? "800.00") })}
      cobro={
        opciones.conCobro === false
          ? undefined
          : { preparado: LISTO, textos: textosDeCobrar(), cobrar, anular }
      }
    />,
  );
  return { cobrar };
}

const agregarUna = async () => {
  await userEvent.click(page.getByRole("button", { name: /Medialuna/ }));
  await userEvent.click(page.getByRole("button", { name: "Agregar" }));
};
const cobrarBoton = () => page.getByRole("button", { name: "Cobrar", exact: true });

describe("VentaRapida con cobro", () => {
  it("sin que la página lo declare, no hay «Cobrar»", async () => {
    await pantalla({ conCobro: false });
    await agregarUna();
    expect(cobrarBoton().elements()).toHaveLength(0);
  });

  it("«Cobrar» está apagado sin cuenta y se enciende cuando el servidor cotizó la cuenta", async () => {
    await pantalla();
    await expect.element(cobrarBoton()).toBeDisabled();
    await agregarUna();
    await expect.element(cobrarBoton()).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("con total cero no se cobra", async () => {
    await pantalla({ total: "0.00" });
    await agregarUna();
    await expect.poll(() => document.querySelector("[data-total]")?.textContent).toBe("$ 0,00");
    await expect.element(cobrarBoton()).toBeDisabled();
  });

  it("abre la hoja con el total cotizado; «Volver» deja la cuenta como estaba; cobrada, «Nueva venta» la deja vacía", async () => {
    const { cobrar } = await pantalla();
    await agregarUna();
    await userEvent.click(cobrarBoton());
    expect(document.querySelector("[data-total-del-cobro]")?.textContent).toBe("$ 800,00");
    await userEvent.click(page.getByRole("button", { name: "Volver", exact: true }));
    expect(document.querySelector("[data-total]")?.textContent).toBe("$ 800,00");
    await userEvent.click(cobrarBoton());
    await userEvent.click(
      page.getByRole("dialog").getByRole("button", { name: "Cobrar", exact: true }),
    );
    await expect.element(page.getByText("Ticket N.º 7")).toBeVisible();
    expect(cobrar).toHaveBeenCalledTimes(1);
    await userEvent.click(page.getByRole("button", { name: "Nueva venta", exact: true }));
    await expect.element(cobrarBoton()).toBeDisabled();
    expect(document.querySelector("[data-total]")?.textContent).toBe("");
  });
});
