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
import { ESPERA_AL_ABRIR_EL_COBRO_MS } from "./useAperturaDelCobro.cliente";

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

async function pantalla(
  opciones: {
    conCobro?: boolean;
    total?: string;
    preparado?: CobroPreparado;
    rutaParaAbrirLaCaja?: string | null;
  } = {},
) {
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
          : {
              preparado: opciones.preparado ?? LISTO,
              textos: textosDeCobrar(),
              cobrar,
              anular,
              rutaParaAbrirLaCaja: opciones.rutaParaAbrirLaCaja ?? null,
            }
      }
    />,
  );
  return { cobrar };
}

const agregarUna = async () => {
  await userEvent.click(page.getByRole("button", { name: /Medialuna/ }));
  await userEvent.click(page.getByRole("button", { name: /^Agregar( ·|$)/ }));
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

  it("el cobro es una vista: «Cobro» con «Volver a la cuenta», sin la venta debajo; volver deja la cuenta como estaba y el foco en «Cobrar»; cobrada, «Nueva venta» la deja vacía", async () => {
    const { cobrar } = await pantalla();
    await agregarUna();
    await userEvent.click(cobrarBoton());
    expect(document.querySelector("[data-total-del-cobro]")?.textContent).toBe("$ 800,00");
    await expect.element(page.getByRole("heading", { name: "Cobro", level: 2 })).toHaveFocus();
    expect(page.getByRole("button", { name: "Volver", exact: true }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: /Medialuna/ }).elements()).toHaveLength(0);
    await userEvent.click(page.getByRole("button", { name: "Volver a la cuenta", exact: true }));
    expect(document.querySelector("[data-total]")?.textContent).toBe("$ 800,00");
    await expect.element(cobrarBoton()).toHaveFocus();
    await userEvent.click(cobrarBoton());
    // Pasada la espera de apertura, «Cobrar» de la vista cobra.
    await new Promise((r) => setTimeout(r, ESPERA_AL_ABRIR_EL_COBRO_MS + 100));
    await userEvent.click(cobrarBoton());
    await expect.element(page.getByText("Ticket N.º 7")).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Resultado", level: 2 })).toBeVisible();
    expect(cobrar).toHaveBeenCalledTimes(1);
    await userEvent.click(page.getByRole("button", { name: "Nueva venta", exact: true }));
    await expect.element(cobrarBoton()).toBeDisabled();
    expect(document.querySelector("[data-total]")?.textContent).toBe("$ 0,00");
  });

  it("DOBLE TOQUE en «Cobrar» de la venta: abre el cobro y NO cobra solo (el segundo toque dentro de la espera se ignora)", async () => {
    const { cobrar } = await pantalla();
    await agregarUna();
    await userEvent.click(cobrarBoton());
    await userEvent.click(cobrarBoton());
    expect(cobrar).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, ESPERA_AL_ABRIR_EL_COBRO_MS + 100));
    await userEvent.click(cobrarBoton());
    await expect.element(page.getByText("Ticket N.º 7")).toBeVisible();
    expect(cobrar).toHaveBeenCalledTimes(1);
  });

  it("sin caja abierta la venta avisa «Abrí la caja para cobrar», ofrece «Abrir caja» a quien puede y «Cobrar» queda apagado", async () => {
    await pantalla({ preparado: { estado: "ABRIR_LA_CAJA" }, rutaParaAbrirLaCaja: "/caja" });
    await agregarUna();
    await expect.element(page.getByText("Abrí la caja para cobrar")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Abrir caja" }))
      .toHaveAttribute("href", "/caja");
    await expect.element(cobrarBoton()).toBeDisabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin caja abierta y sin permiso para abrirla: el aviso va sin botón", async () => {
    await pantalla({ preparado: { estado: "ABRIR_LA_CAJA" }, rutaParaAbrirLaCaja: null });
    await expect.element(page.getByText("Abrí la caja para cobrar")).toBeVisible();
    expect(page.getByRole("link", { name: "Abrir caja" }).elements()).toHaveLength(0);
  });

  it("no permitido: el genérico y «Cobrar» apagado, pero se puede armar la cuenta; con el día en cierre o cerrado las tarjetas quedan apagadas", async () => {
    await pantalla({ preparado: { estado: "NO_PERMITIDO", jornadaAbierta: true } });
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    await expect.element(cobrarBoton()).toBeDisabled();
    await expect.element(page.getByRole("button", { name: /Medialuna/ })).toBeEnabled();
  });

  it("con el día en cierre las tarjetas de producto quedan apagadas", async () => {
    await pantalla({ preparado: { estado: "NO_PERMITIDO", jornadaAbierta: false } });
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    await expect.element(page.getByRole("button", { name: /Medialuna/ })).toBeDisabled();
    await expect.element(cobrarBoton()).toBeDisabled();
  });
});
