import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeCaja } from "./FormularioDeCaja.cliente";

/** El formulario de una caja en Chromium (maqueta `medios.html`, 09/11/2026): solo el nombre; «Guardar» espera a que haya uno, el error del servidor sale debajo y sin permiso no envía. */
const TEXTOS = { nombre: "Nombre", guardar: "Guardar" };
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });

const formulario = (
  nombreOriginal: string | null,
  accion: AccionDeFormulario = ok,
  puedeGuardar = true,
) => (
  <FormularioDeCaja
    nombreOriginal={nombreOriginal}
    accion={accion}
    textos={TEXTOS}
    puedeGuardar={puedeGuardar}
  />
);

describe("FormularioDeCaja", () => {
  it("el alta pide solo el nombre; «Guardar» sale apagado hasta que haya uno; es accesible", async () => {
    await render(formulario(null));
    await expect.element(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Nombre"), "   ");
    await expect.element(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Nombre"), "Caja del salón");
    await expect.element(page.getByRole("button", { name: "Guardar" })).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("manda el nombre a la acción y el segundo toque no manda un segundo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (_previo: unknown, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(formulario(null, accion));
    await userEvent.fill(page.getByLabelText("Nombre"), "Caja del salón");
    const guardar = page.getByRole("button", { name: "Guardar" });
    tocar(guardar);
    await expect.element(guardar).toHaveAttribute("aria-busy", "true");
    tocar(guardar);
    tocar(guardar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(guardar).not.toHaveAttribute("aria-busy", "true");
    expect((accion.mock.calls[0]?.[1] as FormData).get("nombre")).toBe("Caja del salón");
  });

  it("la edición trae el nombre de la caja", async () => {
    await render(formulario("Caja 1"));
    await expect.element(page.getByLabelText("Nombre")).toHaveValue("Caja 1");
    await expect.element(page.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });

  it("el error del servidor (el nombre repetido, el plan o la sesión abierta) sale debajo con su texto", async () => {
    const rechazo: AccionDeFormulario = () =>
      Promise.resolve({
        error: {
          codigo: "CAJA_CAJA_REPETIDA",
          clave: "caja.error.caja_repetida",
          presentacion: "AVISO",
        },
      });
    await render(formulario("Caja 1", rechazo));
    tocar(page.getByRole("button", { name: "Guardar" }));
    await expect.element(page.getByText("Ya existe una caja con ese nombre")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin permiso, «Guardar» sale apagado y no envía", async () => {
    const accion = vi.fn(ok);
    await render(formulario("Caja 1", accion, false));
    await expect.element(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
    tocar(page.getByRole("button", { name: "Guardar" }));
    expect(accion).not.toHaveBeenCalled();
  });
});
