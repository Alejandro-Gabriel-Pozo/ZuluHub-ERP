import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDePreciosPorMedida } from "./FormularioDePreciosPorMedida.cliente";
import {
  armarLosPreciosPorMedida,
  type PreciosPorMedidaArmados,
  type PreciosPorMedidaDeLaPantalla,
} from "./modelo-de-precios-por-medida";

/**
 * Los precios por medida en Chromium (maqueta `productos.html`, solapa «Precios» con variante): un campo por medida con su precio vigente, lo que viaja al guardar (texto decimal canónico),
 * el error asociado al campo de SU medida, el doble toque, sin permiso, el teclado y axe en 390 y 1280 px.
 */
const PANTALLA: PreciosPorMedidaDeLaPantalla = {
  id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
  nombre: "Latte",
  claveDelCambio: "c",
  medidas: [
    { opcionId: "a", nombre: "Chico", vigente: { precioId: "p", importe: "3200.000000" } },
    { opcionId: "b", nombre: "Grande", vigente: null },
  ],
};
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const rechazo =
  (error: ErrorPublico): AccionDeFormulario =>
  () =>
    Promise.resolve({ error });
const formulario = (
  precios: PreciosPorMedidaArmados = armarLosPreciosPorMedida(PANTALLA),
  accion: AccionDeFormulario = ok,
  puedeGuardar = true,
) => <FormularioDePreciosPorMedida precios={precios} accion={accion} puedeGuardar={puedeGuardar} />;
const guardar = () => page.getByRole("button", { name: "Guardar" });
const campo = (nombre: string) => page.getByLabelText(nombre, { exact: true });

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("FormularioDePreciosPorMedida", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 900],
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

  it("un campo por medida con su nombre y el vigente puesto (vacío si no tiene)", async () => {
    await render(formulario());
    await expect.element(campo("Chico")).toHaveValue("3.200,00");
    await expect.element(campo("Grande")).toHaveValue("");
  });

  it("al guardar manda cada precio por su posición como texto decimal canónico (nunca el texto con coma)", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarLosPreciosPorMedida(PANTALLA), accion));
    await userEvent.fill(campo("Grande"), "3800,5");
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries((accion.mock.calls[0]?.[1] as FormData).entries())).toEqual({
      precio_0: "3200.00",
      precio_1: "3800.50",
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
    await render(formulario(armarLosPreciosPorMedida(PANTALLA), accion));
    tocar(guardar());
    await expect.element(guardar()).toHaveAttribute("aria-busy", "true");
    tocar(guardar());
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(guardar()).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("el error de una medida se asocia a su campo y no se repite debajo; la frase del precio cambiado lleva el importe", async () => {
    await render(
      formulario(
        armarLosPreciosPorMedida(PANTALLA),
        rechazo({
          codigo: "CATALOGO_PRECIO_DESACTUALIZADO",
          clave: "catalogo.precio.vigente_ahora",
          presentacion: "AVISO",
          campo: "precio_1",
          parametros: { importe: "15000.000000" },
        }),
      ),
    );
    tocar(guardar());
    await expect
      .element(
        page.getByText("El precio vigente ahora es $ 15.000,00. Revisalo y volvé a intentar."),
      )
      .toBeVisible();
    expect(campo("Grande").element().getAttribute("aria-invalid")).toBe("true");
    expect(campo("Chico").element().getAttribute("aria-invalid")).toBeNull();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("un error sin campo (el genérico) sale debajo y ningún campo queda inválido", async () => {
    await render(
      formulario(
        armarLosPreciosPorMedida(PANTALLA),
        rechazo({
          codigo: "CATALOGO_ACCION_NO_PERMITIDA",
          clave: "catalogo.error.accion_no_permitida",
          presentacion: "AVISO",
        }),
      ),
    );
    tocar(guardar());
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(document.querySelector("[aria-invalid=true]")).toBeNull();
  });

  it("sin permiso, «Guardar» sale apagado y no envía", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarLosPreciosPorMedida(PANTALLA), accion, false));
    await expect.element(guardar()).toBeDisabled();
    tocar(guardar());
    expect(accion).not.toHaveBeenCalled();
  });

  it("el teclado va de una medida a la otra y a «Guardar»", async () => {
    await render(formulario());
    await userEvent.click(campo("Chico"));
    await userEvent.tab();
    expect(document.activeElement).toBe(campo("Grande").element());
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe("Guardar");
  });
});
