import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { errorDeCodigo } from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeNuevaOrden } from "./FormularioDeNuevaOrden.cliente";

/**
 * «Nueva orden» de producción en Chromium (maqueta `produccion.html`): el producto y la cantidad, «Abrir orden» que espera lo necesario y el permiso, el doble toque manda un solo envío, los nombres de campo son
 * los que espera el servidor (y no hay otros: ni depósito, ni unidad), y tras el aviso de faltante el botón pasa a «Producir igual» y reenvía confirmando; cambiar un dato descarta la confirmación. Las reglas de la
 * cantidad, el permiso y el stock las prueba el servidor.
 */
const TEXTOS = {
  producto: "Producto",
  cantidad: "Cantidad a producir",
  abrir: "Abrir orden",
  producirIgual: "Producir igual",
  cancelar: "Cancelar",
};
const PRODUCTOS = [
  { valor: "p1", etiqueta: "Masa (Kilogramo)" },
  { valor: "p2", etiqueta: "Pan (Unidad)" },
];
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const formulario = (accion: AccionDeFormulario = ok, puedeEnviar = true) => (
  <FormularioDeNuevaOrden
    accion={accion}
    textos={TEXTOS}
    productos={PRODUCTOS}
    hrefDeCancelar="/catalogo/produccion"
    puedeEnviar={puedeEnviar}
  />
);

describe("FormularioDeNuevaOrden", () => {
  it("lleva el producto (con su unidad) y la cantidad, «Cancelar» vuelve a la lista y es accesible", async () => {
    await render(formulario());
    await expect.element(page.getByLabelText("Producto")).toBeVisible();
    await expect.element(page.getByLabelText("Cantidad a producir")).toBeVisible();
    await expect
      .element(page.getByRole("option", { name: "Masa (Kilogramo)" }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("link", { name: "Cancelar" }))
      .toHaveAttribute("href", "/catalogo/produccion");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Abrir orden» espera la cantidad y el permiso", async () => {
    const accion = vi.fn(ok);
    await render(formulario(accion));
    await expect.element(page.getByRole("button", { name: "Abrir orden" })).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Cantidad a producir"), "2");
    await expect.element(page.getByRole("button", { name: "Abrir orden" })).toBeEnabled();
  });

  it("sin permiso, «Abrir orden» sale apagado y no envía", async () => {
    const accion = vi.fn(ok);
    await render(formulario(accion, false));
    await userEvent.fill(page.getByLabelText("Cantidad a producir"), "2");
    const abrir = page.getByRole("button", { name: "Abrir orden" });
    await expect.element(abrir).toBeDisabled();
    tocar(abrir);
    expect(accion).not.toHaveBeenCalled();
  });

  it("manda solo el producto y la cantidad con los nombres del servidor, y el doble toque dispara un solo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (_previo: unknown, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(formulario(accion));
    await userEvent.selectOptions(page.getByLabelText("Producto"), "p2");
    await userEvent.fill(page.getByLabelText("Cantidad a producir"), "16,5");
    const abrir = page.getByRole("button", { name: "Abrir orden" });
    tocar(abrir);
    await expect.element(abrir).toHaveAttribute("aria-busy", "true");
    tocar(abrir);
    tocar(abrir);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(abrir).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(datos.entries())).toEqual({ productoId: "p2", cantidad: "16.5" });
  });

  it("tras el aviso de faltante el botón pasa a «Producir igual» y reenvía confirmando", async () => {
    const aviso = { error: errorDeCodigo("STOCK_CONTROL_AVISA") };
    const accion = vi.fn((_previo: unknown, datos: FormData) => {
      void datos;
      return Promise.resolve(accion.mock.calls.length === 1 ? aviso : { error: null });
    });
    await render(formulario(accion));
    await userEvent.fill(page.getByLabelText("Cantidad a producir"), "16");
    tocar(page.getByRole("button", { name: "Abrir orden" }));
    await expect.element(page.getByText("Va a quedar en negativo. ¿Confirmás?")).toBeVisible();
    expect(accion.mock.calls[0]?.[1].get("confirmar")).toBeNull();
    const igual = page.getByRole("button", { name: "Producir igual" });
    await expect.element(igual).toBeVisible();
    tocar(igual);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2));
    expect(accion.mock.calls[1]?.[1].get("confirmar")).toBe("1");
  });

  it("si después del aviso cambia la cantidad o el producto, vuelve «Abrir orden» y el reenvío ya no confirma", async () => {
    const aviso = { error: errorDeCodigo("STOCK_CONTROL_AVISA") };
    const accion = vi.fn((_previo: unknown, datos: FormData) => {
      void datos;
      return Promise.resolve(aviso);
    });
    await render(formulario(accion));
    await userEvent.fill(page.getByLabelText("Cantidad a producir"), "16");
    tocar(page.getByRole("button", { name: "Abrir orden" }));
    await expect.element(page.getByRole("button", { name: "Producir igual" })).toBeVisible();
    await userEvent.fill(page.getByLabelText("Cantidad a producir"), "20");
    await expect.element(page.getByRole("button", { name: "Abrir orden" })).toBeVisible();
    tocar(page.getByRole("button", { name: "Abrir orden" }));
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2));
    expect(accion.mock.calls[1]?.[1].get("confirmar")).toBeNull();
    await expect.element(page.getByRole("button", { name: "Producir igual" })).toBeVisible();
    await userEvent.selectOptions(page.getByLabelText("Producto"), "p2");
    await expect.element(page.getByRole("button", { name: "Abrir orden" })).toBeVisible();
  });

  it("otro error (el genérico) no cambia el botón: sigue «Abrir orden»", async () => {
    const accion = vi.fn((_previo: unknown, datos: FormData) => {
      void datos;
      return Promise.resolve({ error: errorDeCodigo("PRODUCCION_ACCION_NO_PERMITIDA") });
    });
    await render(formulario(accion));
    await userEvent.fill(page.getByLabelText("Cantidad a producir"), "16");
    tocar(page.getByRole("button", { name: "Abrir orden" }));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Abrir orden" })).toBeVisible();
    expect(page.getByRole("button", { name: "Producir igual" }).elements()).toHaveLength(0);
  });
});
