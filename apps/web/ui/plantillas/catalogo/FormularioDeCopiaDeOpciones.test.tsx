import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeCopiaDeOpciones } from "./FormularioDeCopiaDeOpciones.cliente";
import { armarLaCopia, type CopiaArmada, type CopiaDeLaPantalla } from "./modelo-de-opciones";

/**
 * «Copiar de otro producto» en Chromium (maqueta `productos.html`, función `vCopia`): el selector con los productos, lo que viaja al copiar (solo el producto de origen elegido), el
 * doble toque, el error, sin permiso, sin candidatos, el teclado y axe, en 390 y 1280 px.
 */
const COPIA: CopiaDeLaPantalla = {
  id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
  nombre: "Milanesa",
  versionDeOpciones: 4,
  candidatos: [
    { id: "a", nombre: "Hamburguesa" },
    { id: "b", nombre: "Pizza" },
  ],
  claveDeLaCopia: "clave",
};
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const rechazo =
  (error: ErrorPublico): AccionDeFormulario =>
  () =>
    Promise.resolve({ error });
const formulario = (
  copia: CopiaArmada = armarLaCopia(COPIA),
  accion: AccionDeFormulario = ok,
  puedeGuardar = true,
) => <FormularioDeCopiaDeOpciones copia={copia} accion={accion} puedeGuardar={puedeGuardar} />;
const copiar = () => page.getByRole("button", { name: "Copiar" });

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("FormularioDeCopiaDeOpciones", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 800],
      [1280, 800],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(formulario());
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(ancho);
      await unmount();
    }
  });

  it("ofrece los productos y arranca con el primero elegido", async () => {
    await render(formulario());
    const selector = page.getByLabelText("Producto", { exact: true });
    await expect.element(selector).toHaveValue("a");
    expect([...selector.element().querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Hamburguesa",
      "Pizza",
    ]);
  });

  it("al copiar manda solo el producto de origen elegido", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarLaCopia(COPIA), accion));
    await userEvent.selectOptions(page.getByLabelText("Producto", { exact: true }), "b");
    tocar(copiar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries((accion.mock.calls[0]?.[1] as FormData).entries())).toEqual({
      productoOrigenId: "b",
    });
  });

  it("copiar sin tocar el selector manda el primero", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarLaCopia(COPIA), accion));
    tocar(copiar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries((accion.mock.calls[0]?.[1] as FormData).entries())).toEqual({
      productoOrigenId: "a",
    });
  });

  it("el segundo toque no manda un segundo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (_previo: unknown, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(formulario(armarLaCopia(COPIA), accion));
    tocar(copiar());
    await expect.element(copiar()).toHaveAttribute("aria-busy", "true");
    tocar(copiar());
    tocar(copiar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(copiar()).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("un error sale debajo con el patrón común", async () => {
    await render(
      formulario(
        armarLaCopia(COPIA),
        rechazo({
          codigo: "CATALOGO_ACCION_NO_PERMITIDA",
          clave: "catalogo.error.accion_no_permitida",
          presentacion: "AVISO",
        }),
      ),
    );
    tocar(copiar());
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin permiso, «Copiar» sale apagado y no envía", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarLaCopia(COPIA), accion, false));
    await expect.element(copiar()).toBeDisabled();
    tocar(copiar());
    expect(accion).not.toHaveBeenCalled();
  });

  it("sin productos de dónde copiar no hay formulario", async () => {
    await render(formulario(armarLaCopia({ ...COPIA, candidatos: [] })));
    expect(document.querySelector("form, select, button")).toBeNull();
  });

  it("el teclado va del selector a «Copiar»", async () => {
    await render(formulario());
    await userEvent.tab();
    expect(document.activeElement?.tagName).toBe("SELECT");
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe("Copiar");
  });
});
