import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
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
 * La venta a $ 0 (PR-6, decisión 155, maqueta `venta-rapida-v4.html:915-918,1029-1033`): con total $ 0 «Cobrar» abre el diálogo y «Confirmar» cierra la venta sin cobro; con una línea a $ 0 dentro de un
 * total mayor «Confirmar» pasa al cobro normal; cualquier cambio de la cuenta pierde la confirmación; un doble toque es un solo envío.
 */

const producto = (id: string, nombre: string): ProductoDeLaVenta => ({
  id,
  nombre,
  seccionId: "comer",
  unidadDeVentaId: "UNIDAD",
  codigo: null,
  codigoDeBarras: null,
  pasoMinimo: "1.0000",
  porcionesOfrecidas: [],
  variante: null,
  grupos: [],
  precio: { tipo: "BASE", importe: "800.00" },
});
const secciones = [{ id: "comer", nombre: "Para comer" }] as const;
const importe = (monto: string) => ({ moneda: "ARS", monto });
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
        datosQueSePiden: { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false },
      },
    ],
    marcasDeTarjeta: [],
  },
};
const CORTESIA: VentaCobrada = {
  ticketId: "t1",
  ejemplarId: "e1",
  numero: 9,
  estado: "CORTESIA",
  total: importe("0.00"),
  cobros: [],
};
const COBRADA: VentaCobrada = {
  ...CORTESIA,
  numero: 10,
  estado: "COBRADO",
  total: importe("800.00"),
  cobros: [{ medioDePagoId: "m-efectivo", cuentaDeCobroId: null, importe: importe("800.00") }],
};

/** Cada línea cotizada: «gratis» (a $ 0) o con su precio; el total es la suma que decide la prueba. */
const cotizacionDe = (total: string, unitarios: readonly string[]): CotizacionDeLaVenta => ({
  total: importe(total),
  lineas: unitarios.map((u) => ({ precioUnitario: importe(u), importe: importe(u) })),
});

async function pantalla(
  cotizar: (lineas: number) => CotizacionDeLaVenta,
  respuesta: VentaCobrada,
  demoraMs = 0,
) {
  const cobrar = vi.fn<(p: unknown) => Promise<Respuesta<VentaCobrada>>>(
    () => new Promise((r) => setTimeout(() => r({ ok: true, dato: respuesta }), demoraMs)),
  );
  await render(
    <PantallaDeVentaRapida
      secciones={secciones}
      productos={[producto("cafe", "Café"), producto("agua", "Agua")]}
      textos={textosDeLaVenta()}
      cotizar={(pedido) =>
        Promise.resolve({
          ok: true,
          dato: cotizar((pedido as { lineas: unknown[] }).lineas.length),
        })
      }
      cobro={{
        preparado: LISTO,
        textos: textosDeCobrar(),
        cobrar,
        anular: vi.fn<(p: unknown) => Promise<Respuesta<TicketAnulado>>>(),
        imprimir: vi.fn(),
        rutaParaAbrirLaCaja: null,
      }}
    />,
  );
  return { cobrar };
}

const agregar = async (nombre: RegExp) => {
  // Tras cerrar la hoja un segundo toque se ignora un rato (500 ms): se espera antes de elegir otro producto.
  await new Promise((r) => setTimeout(r, 600));
  await userEvent.click(page.getByRole("button", { name: nombre }));
  await userEvent.click(page.getByRole("button", { name: /^Agregar( ·|$)/ }));
};
const cobrarBoton = () => page.getByRole("button", { name: "Cobrar", exact: true });
const confirmar = () => page.getByRole("button", { name: "Confirmar", exact: true });
const dialogo = () => page.getByRole("dialog");
const esperarTotal = (texto: string) =>
  expect.poll(() => document.querySelector("[data-total]")?.textContent).toBe(texto);

describe("Venta a $ 0", () => {
  it("total $ 0: «Cobrar» abre el diálogo (Total, la línea a $ 0, Confirmar, Cancelar, sin campos) y «Confirmar» cierra la venta sin cobro", async () => {
    const { cobrar } = await pantalla(() => cotizacionDe("0.00", ["0.00"]), CORTESIA);
    await agregar(/Café/);
    await esperarTotal("$ 0,00");
    await userEvent.click(cobrarBoton());
    await expect.element(dialogo()).toBeVisible();
    await expect.element(page.getByRole("dialog", { name: "Total $ 0,00" })).toBeVisible();
    expect(dialogo().element().textContent).toContain("Café");
    expect(dialogo().element().querySelectorAll("input,textarea,select")).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await userEvent.click(confirmar());
    await expect.element(page.getByText("Ticket N.º 9")).toBeVisible();
    expect(page.getByText("Cobrado", { exact: true }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Imprimir ticket" }).elements()).toHaveLength(0);
    await expect.element(page.getByRole("button", { name: "Anular", exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Nueva venta" })).toBeVisible();
    expect(cobrar).toHaveBeenCalledTimes(1);
    expect(cobrar.mock.calls[0]?.[0]).toMatchObject({
      cobros: [],
      confirmaciones: ["VENTA_A_CERO"],
      totalEsperado: importe("0.00"),
      cajaId: "caja-1",
    });
  });

  it("IDEMPOTENCIA: doble toque en «Confirmar» = un solo envío, un solo ticket", async () => {
    const { cobrar } = await pantalla(() => cotizacionDe("0.00", ["0.00"]), CORTESIA, 150);
    await agregar(/Café/);
    await esperarTotal("$ 0,00");
    await userEvent.click(cobrarBoton());
    await userEvent.dblClick(confirmar());
    await expect.element(page.getByText("Ticket N.º 9")).toBeVisible();
    expect(cobrar).toHaveBeenCalledTimes(1);
  });

  it("«Cancelar» vuelve a la cuenta sin enviar nada y el foco vuelve a «Cobrar»; Escape también", async () => {
    const { cobrar } = await pantalla(() => cotizacionDe("0.00", ["0.00"]), CORTESIA);
    await agregar(/Café/);
    await esperarTotal("$ 0,00");
    await userEvent.click(cobrarBoton());
    await userEvent.click(page.getByRole("button", { name: "Cancelar", exact: true }));
    expect(dialogo().elements()).toHaveLength(0);
    await expect.element(cobrarBoton()).toHaveFocus();
    await userEvent.click(cobrarBoton());
    await userEvent.keyboard("{Escape}");
    expect(dialogo().elements()).toHaveLength(0);
    await expect.element(cobrarBoton()).toHaveFocus();
    expect(cobrar).not.toHaveBeenCalled();
  });

  it("una línea a $ 0 dentro de un total mayor: «Confirmar» no envía, abre el cobro y el cobro manda la confirmación", async () => {
    const { cobrar } = await pantalla(
      (n) => cotizacionDe("800.00", n === 1 ? ["0.00"] : ["0.00", "800.00"]),
      COBRADA,
    );
    await agregar(/Café/);
    await agregar(/Agua/);
    await esperarTotal("$ 800,00");
    await userEvent.click(cobrarBoton());
    expect(dialogo().element().textContent).toContain("Café");
    expect(dialogo().element().textContent).not.toContain("Agua");
    await userEvent.click(confirmar());
    expect(cobrar).not.toHaveBeenCalled();
    await expect.element(page.getByRole("heading", { name: "Cobro", level: 2 })).toBeVisible();
    await new Promise((r) => setTimeout(r, 700));
    await userEvent.click(cobrarBoton());
    await expect.element(page.getByText("Ticket N.º 10")).toBeVisible();
    await expect.element(page.getByText("Cobrado", { exact: true })).toBeVisible();
    expect(cobrar.mock.calls[0]?.[0]).toMatchObject({ confirmaciones: ["VENTA_A_CERO"] });
  });

  it("la confirmación se pierde al cambiar la cuenta: confirmar, volver, agregar y «Cobrar» → el diálogo vuelve; sin cambios no", async () => {
    await pantalla((n) => cotizacionDe("800.00", n === 1 ? ["0.00"] : ["0.00", "800.00"]), COBRADA);
    await agregar(/Café/);
    await agregar(/Agua/);
    await esperarTotal("$ 800,00");
    await userEvent.click(cobrarBoton());
    await userEvent.click(confirmar());
    await userEvent.click(page.getByRole("button", { name: "Volver a la cuenta", exact: true }));
    await new Promise((r) => setTimeout(r, 700));
    await userEvent.click(cobrarBoton());
    expect(dialogo().elements()).toHaveLength(0);
    await expect.element(page.getByRole("heading", { name: "Cobro", level: 2 })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Volver a la cuenta", exact: true }));
    await agregar(/Agua/);
    await esperarTotal("$ 800,00");
    await userEvent.click(cobrarBoton());
    await expect.element(dialogo()).toBeVisible();
  });

  it("sin nada a cero «Cobrar» va directo al cobro, sin diálogo", async () => {
    await pantalla(() => cotizacionDe("800.00", ["800.00"]), COBRADA);
    await agregar(/Café/);
    await esperarTotal("$ 800,00");
    await userEvent.click(cobrarBoton());
    expect(dialogo().elements()).toHaveLength(0);
    await expect.element(page.getByRole("heading", { name: "Cobro", level: 2 })).toBeVisible();
  });

  it("un rechazo del servidor se muestra en el diálogo y se puede cancelar", async () => {
    const { cobrar } = await pantalla(() => cotizacionDe("0.00", ["0.00"]), CORTESIA);
    cobrar.mockResolvedValueOnce({ ok: false, error: errorDeCodigo("CAJA_ACCION_NO_PERMITIDA") });
    await agregar(/Café/);
    await esperarTotal("$ 0,00");
    await userEvent.click(cobrarBoton());
    await userEvent.click(confirmar());
    await expect.element(page.getByRole("button", { name: "Cancelar", exact: true })).toBeEnabled();
    expect(page.getByText("Ticket N.º 9").elements()).toHaveLength(0);
  });
});
