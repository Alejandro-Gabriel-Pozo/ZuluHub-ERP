import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeDatosDelMedio } from "./FormularioDeDatosDelMedio.cliente";

/** «Datos que se piden al cobrar» en Chromium (maqueta `datos-cobro.html`): una casilla por dato admitido, el conjunto final al servidor, doble toque y sin permiso. */
const TEXTOS = { titulo: "Datos que se piden al cobrar", guardar: "Guardar" };
const CASILLAS = [
  { dato: "cupon", etiqueta: "Cupón", pide: true },
  { dato: "ultimos4", etiqueta: "Últimos 4 dígitos", pide: false },
  { dato: "marca", etiqueta: "Marca de la tarjeta", pide: false },
] as const;
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });

const formulario = (accion: AccionDeFormulario = ok, puedeGuardar = true) => (
  <FormularioDeDatosDelMedio
    casillas={CASILLAS}
    accion={accion}
    textos={TEXTOS}
    puedeGuardar={puedeGuardar}
  />
);

describe("FormularioDeDatosDelMedio", () => {
  it("muestra el título, una casilla por dato con el estado actual y es accesible", async () => {
    await render(formulario());
    await expect.element(page.getByRole("group", { name: TEXTOS.titulo })).toBeVisible();
    await expect.element(page.getByRole("checkbox", { name: "Cupón" })).toBeChecked();
    await expect
      .element(page.getByRole("checkbox", { name: "Últimos 4 dígitos" }))
      .not.toBeChecked();
    await expect
      .element(page.getByRole("checkbox", { name: "Marca de la tarjeta" }))
      .not.toBeChecked();
    expect(page.getByRole("checkbox").elements()).toHaveLength(3);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("manda a la acción solo los datos tildados y el segundo toque no manda un segundo envío", async () => {
    let liberar: () => void = () => undefined;
    const enviados: string[][] = [];
    const accion = vi.fn(async (_previo: unknown, datos: FormData) => {
      enviados.push(datos.getAll("datos").map(String));
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(formulario(accion));
    await userEvent.click(page.getByRole("checkbox", { name: "Cupón" }));
    await userEvent.click(page.getByRole("checkbox", { name: "Marca de la tarjeta" }));
    const guardar = page.getByRole("button", { name: "Guardar" });
    tocar(guardar);
    await expect.element(guardar).toHaveAttribute("aria-busy", "true");
    tocar(guardar);
    tocar(guardar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(guardar).not.toHaveAttribute("aria-busy", "true");
    expect(enviados).toEqual([["marca"]]);
  });

  it("sin permiso: las casillas y «Guardar» salen apagadas y no se envía nada", async () => {
    const accion = vi.fn(ok);
    await render(formulario(accion, false));
    for (const casilla of page.getByRole("checkbox").elements()) {
      expect((casilla as HTMLInputElement).disabled).toBe(true);
    }
    await expect.element(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(accion).not.toHaveBeenCalled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("un error del servidor sale debajo con su texto", async () => {
    const conError: AccionDeFormulario = () =>
      Promise.resolve({
        error: {
          codigo: "CAJA_ACCION_NO_PERMITIDA",
          clave: "caja.error.accion_no_permitida",
          presentacion: "AVISO",
        },
      });
    await render(formulario(conError));
    tocar(page.getByRole("button", { name: "Guardar" }));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
  });
});
