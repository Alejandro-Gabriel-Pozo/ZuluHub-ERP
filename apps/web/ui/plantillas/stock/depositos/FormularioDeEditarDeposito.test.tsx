import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { tocar, violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../../patrones/FormularioDeAccion.cliente";
import { FormularioDeEditarDeposito } from "./FormularioDeEditarDeposito.cliente";

/**
 * Editar un depósito en Chromium (maqueta `stock-depositos-gestion.html`, 25/11/2026): el nombre y «De venta» (solo si el uso lo admite), el uso se ve y no se cambia, «Guardar» espera a que haya un
 * nombre y a que haya permiso, el doble toque manda un solo envío, y el error del servidor (otra persona lo modificó, nombre repetido) sale con su texto.
 */
const TEXTOS = {
  nombre: "Nombre",
  uso: "Uso",
  deVenta: "De venta",
  guardar: "Guardar",
  cancelar: "Cancelar",
};
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });

const formulario = (
  accion: AccionDeFormulario = ok,
  extra: Partial<{
    puedeGuardar: boolean;
    uso: string;
    admiteDeVenta: boolean;
    deVenta: boolean;
  }> = {},
) => (
  <FormularioDeEditarDeposito
    accion={accion}
    textos={TEXTOS}
    actual={{
      nombre: "Cocina",
      uso: extra.uso ?? "Normal",
      deVenta: extra.deVenta ?? false,
      admiteDeVenta: extra.admiteDeVenta ?? true,
    }}
    hrefDeCancelar="/stock/depositos"
    puedeGuardar={extra.puedeGuardar ?? true}
  />
);

describe("FormularioDeEditarDeposito", () => {
  it("muestra el nombre actual y el uso como texto (no como campo); es accesible", async () => {
    await render(formulario());
    await expect.element(page.getByLabelText("Nombre")).toHaveValue("Cocina");
    await expect.element(page.getByText("Uso")).toBeVisible();
    await expect.element(page.getByText("Normal")).toBeVisible();
    expect(page.getByLabelText("Uso").elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«De venta» se ofrece solo si el uso lo admite, y viene con lo que hoy tiene el depósito", async () => {
    await render(formulario(ok, { deVenta: true }));
    await expect.element(page.getByLabelText("De venta")).toBeChecked();
  });

  it("con un uso que no admite «De venta» (Cuarentena) la casilla no se ofrece", async () => {
    await render(formulario(ok, { uso: "Cuarentena", admiteDeVenta: false }));
    expect(page.getByLabelText("De venta").elements()).toHaveLength(0);
  });

  it("«Guardar» sale apagado con el nombre vacío y se enciende al escribir", async () => {
    await render(formulario());
    const guardar = page.getByRole("button", { name: "Guardar" });
    await expect.element(guardar).toBeEnabled();
    await userEvent.fill(page.getByLabelText("Nombre"), "   ");
    await expect.element(guardar).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Nombre"), "Cocina grande");
    await expect.element(guardar).toBeEnabled();
  });

  it("sin permiso, «Guardar» sale apagado y no envía", async () => {
    const accion = vi.fn(ok);
    await render(formulario(accion, { puedeGuardar: false }));
    const guardar = page.getByRole("button", { name: "Guardar" });
    await expect.element(guardar).toBeDisabled();
    tocar(guardar);
    expect(accion).not.toHaveBeenCalled();
  });

  it("manda nombre y «De venta» a la acción, y el doble toque dispara una sola vez", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (_previo: unknown, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(formulario(accion));
    await userEvent.fill(page.getByLabelText("Nombre"), "Cocina grande");
    await userEvent.click(page.getByLabelText("De venta"));
    const guardar = page.getByRole("button", { name: "Guardar" });
    tocar(guardar);
    await expect.element(guardar).toHaveAttribute("aria-busy", "true");
    tocar(guardar);
    tocar(guardar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(guardar).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(datos.get("nombre")).toBe("Cocina grande");
    expect(datos.get("deVenta")).not.toBeNull();
  });

  it("«De venta» desmarcada no se manda", async () => {
    const accion = vi.fn(ok);
    await render(formulario(accion));
    tocar(page.getByRole("button", { name: "Guardar" }));
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect((accion.mock.calls[0]?.[1] as FormData).get("deVenta")).toBeNull();
  });

  it.each([
    [
      "STOCK_DEPOSITO_DESACTUALIZADO",
      "stock.error.deposito_desactualizado",
      "Otra persona modificó este depósito. Actualizá la pantalla",
    ],
    [
      "STOCK_NOMBRE_DUPLICADO",
      "stock.error.nombre_duplicado",
      "Ya existe un depósito con ese nombre",
    ],
  ])("el error %s sale con su texto, anunciado, y es accesible", async (codigo, clave, texto) => {
    const rechazo: AccionDeFormulario = () =>
      Promise.resolve({ error: { codigo, clave, presentacion: "AVISO" } as never });
    await render(formulario(rechazo));
    await userEvent.fill(page.getByLabelText("Nombre"), "Otro");
    tocar(page.getByRole("button", { name: "Guardar" }));
    await expect.element(page.getByRole("alert")).toBeVisible();
    await expect.element(page.getByText(texto)).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Cancelar» es un enlace a la lista, a la izquierda de «Guardar», no dispara la acción, y sigue sin permiso", async () => {
    const accion = vi.fn(ok);
    await render(formulario(accion, { puedeGuardar: false }));
    const cancelar = page.getByRole("link", { name: "Cancelar" });
    await expect.element(cancelar).toHaveAttribute("href", "/stock/depositos");
    expect(page.getByRole("button", { name: "Cancelar" }).elements()).toHaveLength(0);
    const izquierda = cancelar.element().getBoundingClientRect();
    const derecha = page.getByRole("button", { name: "Guardar" }).element().getBoundingClientRect();
    expect(izquierda.right).toBeLessThanOrEqual(derecha.left);
    cancelar.element().addEventListener("click", (evento) => evento.preventDefault());
    await userEvent.click(cancelar);
    expect(accion).not.toHaveBeenCalled();
  });
});
