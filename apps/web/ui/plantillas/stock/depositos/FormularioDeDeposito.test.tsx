import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { tocar, violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../../patrones/FormularioDeAccion.cliente";
import { FormularioDeDeposito } from "./FormularioDeDeposito.cliente";

/**
 * El alta de un depósito en Chromium (maqueta `stock.html`, 09/11/2026): nombre y uso, «De venta» solo con el uso Normal (decisión del dueño, 18/11/2026); «Agregar depósito» espera a que
 * haya un nombre, el doble toque manda un solo envío y el error del servidor sale con su texto. «Cancelar» es un enlace a la lista, a la izquierda de «Agregar depósito» (ajuste a la maqueta).
 */
const TEXTOS = {
  nombre: "Nombre",
  uso: "Uso",
  deVenta: "De venta",
  guardar: "Agregar depósito",
  cancelar: "Cancelar",
};
const USOS = [
  { valor: "NORMAL", etiqueta: "Normal" },
  { valor: "CUARENTENA", etiqueta: "Cuarentena" },
  { valor: "RECHAZO", etiqueta: "Rechazo" },
] as const;
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });

const formulario = (accion: AccionDeFormulario = ok, puedeGuardar = true) => (
  <FormularioDeDeposito
    accion={accion}
    textos={TEXTOS}
    hrefDeCancelar="/stock/depositos"
    opcionesDeUso={USOS}
    puedeGuardar={puedeGuardar}
  />
);

describe("FormularioDeDeposito", () => {
  it("«Agregar depósito» sale apagado mientras el nombre está vacío; es accesible", async () => {
    await render(formulario());
    const agregar = page.getByRole("button", { name: "Agregar depósito" });
    await expect.element(agregar).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Nombre"), "   ");
    await expect.element(agregar).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Nombre"), "Cocina");
    await expect.element(agregar).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin permiso para guardar, sale apagado aunque haya nombre, y no envía", async () => {
    const accion = vi.fn(ok);
    await render(formulario(accion, false));
    await userEvent.fill(page.getByLabelText("Nombre"), "Cocina");
    const agregar = page.getByRole("button", { name: "Agregar depósito" });
    await expect.element(agregar).toBeDisabled();
    tocar(agregar);
    expect(accion).not.toHaveBeenCalled();
  });

  it("«De venta» aparece solo con el uso Normal; al cambiar de uso desaparece y queda desmarcada", async () => {
    await render(formulario());
    const deVenta = page.getByLabelText("De venta");
    await expect.element(deVenta).toBeInTheDocument();
    await expect.element(deVenta).not.toBeChecked();
    await userEvent.click(deVenta);
    await expect.element(deVenta).toBeChecked();

    await userEvent.selectOptions(page.getByLabelText("Uso"), "CUARENTENA");
    expect(page.getByLabelText("De venta").elements()).toHaveLength(0);

    await userEvent.selectOptions(page.getByLabelText("Uso"), "NORMAL");
    await expect.element(page.getByLabelText("De venta")).not.toBeChecked();
  });

  it("manda nombre, uso y «De venta» a la acción, y el doble toque dispara una sola vez", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (_previo: unknown, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(formulario(accion));
    await userEvent.fill(page.getByLabelText("Nombre"), "Cocina");
    await userEvent.click(page.getByLabelText("De venta"));
    const agregar = page.getByRole("button", { name: "Agregar depósito" });
    tocar(agregar);
    await expect.element(agregar).toHaveAttribute("aria-busy", "true");
    tocar(agregar);
    tocar(agregar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(agregar).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(datos.get("nombre")).toBe("Cocina");
    expect(datos.get("uso")).toBe("NORMAL");
    expect(datos.get("deVenta")).not.toBeNull();
  });

  it("el error del servidor (nombre repetido) sale con su texto, anunciado, y es accesible", async () => {
    const rechazo: AccionDeFormulario = () =>
      Promise.resolve({
        error: {
          codigo: "STOCK_NOMBRE_DUPLICADO",
          clave: "stock.error.nombre_duplicado",
          presentacion: "AVISO",
        },
      });
    await render(formulario(rechazo));
    await userEvent.fill(page.getByLabelText("Nombre"), "Cocina");
    tocar(page.getByRole("button", { name: "Agregar depósito" }));
    const aviso = page.getByRole("alert");
    await expect.element(aviso).toBeVisible();
    await expect.element(page.getByText("Ya existe un depósito con ese nombre")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Cancelar» es un enlace a la lista, a la izquierda de «Agregar depósito», no dispara la acción y es accesible", async () => {
    const accion = vi.fn(ok);
    await render(formulario(accion));
    const cancelar = page.getByRole("link", { name: "Cancelar" });
    await expect.element(cancelar).toHaveAttribute("href", "/stock/depositos");
    expect(page.getByRole("button", { name: "Cancelar" }).elements()).toHaveLength(0);
    const izquierda = cancelar.element().getBoundingClientRect();
    const derecha = page
      .getByRole("button", { name: "Agregar depósito" })
      .element()
      .getBoundingClientRect();
    expect(izquierda.right).toBeLessThanOrEqual(derecha.left);
    await userEvent.fill(page.getByLabelText("Nombre"), "Cocina");
    // El clic en un enlace navega; para no salir de la prueba se frena la navegación y se mira que no se envió nada.
    cancelar.element().addEventListener("click", (evento) => evento.preventDefault());
    await userEvent.click(cancelar);
    expect(accion).not.toHaveBeenCalled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Cancelar» sigue disponible aunque no haya permiso para guardar", async () => {
    await render(formulario(ok, false));
    await expect
      .element(page.getByRole("link", { name: "Cancelar" }))
      .toHaveAttribute("href", "/stock/depositos");
    await expect.element(page.getByRole("button", { name: "Agregar depósito" })).toBeDisabled();
  });
});
