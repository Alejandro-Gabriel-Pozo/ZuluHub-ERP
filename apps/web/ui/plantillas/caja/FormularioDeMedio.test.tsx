import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeMedio } from "./FormularioDeMedio.cliente";
import { opcionesDeTipo, type MedioDeLaLista } from "./modelo-de-medios-de-pago";

/** El formulario de un medio de pago en Chromium (maqueta `medios.html`, 09/11/2026): alta y edición, error del servidor, doble toque y sin permiso. */
const TEXTOS = { tipo: "Tipo", nombre: "Nombre (opcional)", guardar: "Guardar" };
const ORIGINAL: MedioDeLaLista = {
  id: "m1",
  tipo: "QR",
  nombre: "Mercado Pago",
  activo: true,
  version: 4,
};
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });

const formulario = (
  original: MedioDeLaLista | null,
  accion: AccionDeFormulario = ok,
  puedeGuardar = true,
) => (
  <FormularioDeMedio
    original={original}
    tipos={opcionesDeTipo(original)}
    accion={accion}
    textos={TEXTOS}
    puedeGuardar={puedeGuardar}
  />
);

describe("FormularioDeMedio", () => {
  it("el alta ofrece los tipos sin el efectivo y es accesible", async () => {
    await render(formulario(null));
    const selector = page.getByLabelText("Tipo");
    await expect.element(selector).toBeEnabled();
    const opciones = selector.elements()[0]?.querySelectorAll("option");
    expect([...(opciones ?? [])].map((o) => o.textContent)).toEqual([
      "Tarjeta de débito",
      "Tarjeta de crédito",
      "Transferencia",
      "QR",
      "Otro",
    ]);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("manda el tipo y el nombre a la acción y el segundo toque no manda un segundo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (_previo: unknown, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(formulario(null, accion));
    await userEvent.selectOptions(page.getByLabelText("Tipo"), "TRANSFERENCIA");
    await userEvent.fill(page.getByLabelText("Nombre (opcional)"), "Cuenta del banco");
    const guardar = page.getByRole("button", { name: "Guardar" });
    tocar(guardar);
    await expect.element(guardar).toHaveAttribute("aria-busy", "true");
    tocar(guardar);
    tocar(guardar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    // Se espera a que termine el envío: una acción en vuelo no tiene que pasar al próximo caso.
    await expect.element(guardar).not.toHaveAttribute("aria-busy", "true");
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect([datos.get("tipo"), datos.get("nombre")]).toEqual(["TRANSFERENCIA", "Cuenta del banco"]);
  });

  it("la edición trae el nombre del medio y el tipo apagado (no se cambia)", async () => {
    await render(formulario(ORIGINAL));
    await expect.element(page.getByLabelText("Nombre (opcional)")).toHaveValue("Mercado Pago");
    await expect.element(page.getByLabelText("Tipo")).toBeDisabled();
    await expect.element(page.getByLabelText("Tipo")).toHaveValue("QR");
  });

  it("el error del servidor sale debajo con su texto", async () => {
    const rechazo: AccionDeFormulario = () =>
      Promise.resolve({
        error: {
          codigo: "CAJA_MEDIO_REPETIDO",
          clave: "caja.error.medio_repetido",
          presentacion: "AVISO",
        },
      });
    await render(formulario(null, rechazo));
    tocar(page.getByRole("button", { name: "Guardar" }));
    await expect.element(page.getByText("Ya existe un medio con ese nombre")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin permiso, «Guardar» sale apagado y no envía", async () => {
    const accion = vi.fn(ok);
    await render(formulario(null, accion, false));
    await expect.element(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
    tocar(page.getByRole("button", { name: "Guardar" }));
    expect(accion).not.toHaveBeenCalled();
  });
});
