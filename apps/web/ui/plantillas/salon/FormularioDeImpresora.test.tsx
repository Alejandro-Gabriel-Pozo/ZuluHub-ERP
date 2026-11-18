import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeImpresora } from "./FormularioDeImpresora.cliente";
import { armarElFormularioDeImpresora } from "./modelo-de-impresoras";

/**
 * El formulario de una impresora en Chromium (maqueta `imprimir.html`, «Agregar impresora»): los tres campos, lo que viaja al guardar, el doble toque (un solo envío), sin permiso, el error debajo (el genérico), el foco
 * y axe y tamaños en 390 y 1280 px.
 */
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });

afterEach(async () => {
  await page.viewport(390, 844);
});

const formulario = (accion: AccionDeFormulario = ok, puede = true) => (
  <FormularioDeImpresora formulario={armarElFormularioDeImpresora(null, puede)} accion={accion} />
);
const guardar = () => page.getByRole("button", { name: "Guardar" });
const nombre = () => page.getByLabelText("Nombre", { exact: true });

describe("FormularioDeImpresora", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 900],
      [1280, 800],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(formulario());
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });

  it("abre con «Guardar» apagado hasta tener nombre (la maqueta: sin nombre no se guarda)", async () => {
    await render(formulario());
    await expect.element(guardar()).toBeDisabled();
    await userEvent.fill(nombre(), "   ");
    await expect.element(guardar()).toBeDisabled();
    await userEvent.fill(nombre(), "Cocina");
    await expect.element(guardar()).toBeEnabled();
  });

  it("propone comanda de cocina y 80 mm, con las opciones de la maqueta", async () => {
    await render(formulario());
    await expect.element(page.getByLabelText("Para qué sirve")).toHaveValue("COMANDA");
    await expect.element(page.getByLabelText("Papel")).toHaveValue("80");
    await expect
      .element(page.getByRole("option", { name: "Ticket del cliente" }))
      .toBeInTheDocument();
    await expect.element(page.getByRole("option", { name: "58 mm" })).toBeInTheDocument();
  });

  it("al guardar manda solo los tres datos, tal como se escribieron (la sucursal, la empresa y el id no viajan)", async () => {
    const accion = vi.fn(ok);
    await render(formulario(accion));
    await userEvent.fill(nombre(), "Caja");
    await userEvent.selectOptions(page.getByLabelText("Para qué sirve"), "TICKET");
    await userEvent.selectOptions(page.getByLabelText("Papel"), "58");
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(datos.entries())).toEqual({
      nombre: "Caja",
      uso: "TICKET",
      papelMm: "58",
    });
  });

  it("DOBLE ENVÍO: el segundo toque no manda un segundo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (_previo: unknown, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(formulario(accion));
    await userEvent.fill(nombre(), "Cocina");
    tocar(guardar());
    await expect.element(guardar()).toHaveAttribute("aria-busy", "true");
    tocar(guardar());
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(guardar()).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("sin permiso «Guardar» sale apagado aunque esté el nombre", async () => {
    await render(formulario(ok, false));
    await userEvent.fill(nombre(), "Cocina");
    await expect.element(guardar()).toBeDisabled();
  });

  it("un rechazo del servidor sale debajo con el mensaje genérico", async () => {
    const error: ErrorPublico = {
      codigo: "CATALOGO_ACCION_NO_PERMITIDA",
      clave: "catalogo.error.accion_no_permitida",
      presentacion: "AVISO",
    };
    await render(formulario(() => Promise.resolve({ error })));
    await userEvent.fill(nombre(), "Cocina");
    tocar(guardar());
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el foco entra por el nombre con el teclado", async () => {
    await render(formulario());
    await userEvent.tab();
    await userEvent.tab();
    expect(document.activeElement).toBe(nombre().element());
  });
});
