import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeMesa } from "./FormularioDeMesa.cliente";
import { armarElFormularioDeMesa } from "./modelo-de-mesas";
import { MEDIDAS_DE_PRUEBA } from "../../pruebas/ayudas-de-mesas";

/**
 * El formulario de una mesa en Chromium (maqueta `mesas.html`, «Agregar mesa» y «Editar mesa»): los cinco campos, lo que viaja al guardar, el doble toque (un solo envío), sin permiso, el error
 * debajo, axe y tamaños en 390 y 1280 px.
 */
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });

afterEach(async () => {
  await page.viewport(390, 844);
});

const formulario = (accion: AccionDeFormulario = ok, puede = true) => (
  <FormularioDeMesa
    formulario={armarElFormularioDeMesa(null, puede, { medidas: MEDIDAS_DE_PRUEBA, mesas: [] })}
    accion={accion}
  />
);
const guardar = () => page.getByRole("button", { name: "Guardar" });
const llenar = async () => {
  await userEvent.fill(page.getByLabelText("Número", { exact: true }), "7");
  await userEvent.fill(page.getByLabelText("Columna", { exact: true }), "3");
  await userEvent.fill(page.getByLabelText("Fila", { exact: true }), "2");
};

describe("FormularioDeMesa", () => {
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

  it("abre con «Guardar» apagado hasta tener número, columna y fila", async () => {
    await render(formulario());
    await expect.element(guardar()).toBeDisabled();
    await llenar();
    await expect.element(guardar()).toBeEnabled();
  });

  it("al guardar manda solo los cinco datos, tal como se escribieron (la sucursal, la empresa y la clave no viajan)", async () => {
    const accion = vi.fn(ok);
    await render(formulario(accion));
    await llenar();
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(datos.entries())).toEqual({
      numero: "7",
      forma: "REDONDA",
      tamano: "CHICA",
      columna: "3",
      fila: "2",
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
    await llenar();
    tocar(guardar());
    await expect.element(guardar()).toHaveAttribute("aria-busy", "true");
    tocar(guardar());
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(guardar()).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("el mapa chico se redibuja con lo que se escribe: aparece al poner columna y fila y se mueve al cambiarlas", async () => {
    await render(formulario());
    await expect.element(page.getByRole("list", { name: "Plano" })).toBeVisible();
    expect(document.querySelector('[data-borrador="si"]')).toBeNull();
    await llenar();
    const borrador = () => document.querySelector<HTMLElement>('[data-borrador="si"]');
    await vi.waitFor(() =>
      expect(borrador()?.style.getPropertyValue("--izquierda")).toBe(`${String((2 / 14) * 100)}%`),
    );
    await userEvent.fill(page.getByLabelText("Columna", { exact: true }), "5");
    await vi.waitFor(() =>
      expect(borrador()?.style.getPropertyValue("--izquierda")).toBe(`${String((4 / 14) * 100)}%`),
    );
    await userEvent.fill(page.getByLabelText("Columna", { exact: true }), "");
    await vi.waitFor(() => expect(borrador()).toBeNull());
  });

  it("sin permiso «Guardar» sale apagado aunque estén los datos", async () => {
    await render(formulario(ok, false));
    await llenar();
    await expect.element(guardar()).toBeDisabled();
  });

  it("un error del servidor sale debajo, con su texto aprobado", async () => {
    const error: ErrorPublico = {
      codigo: "SALON_NUMERO_DE_MESA_EN_USO",
      clave: "salon.texto.admin_ya_existe_una_mesa_con_ese_numero",
      presentacion: "AVISO",
    };
    await render(formulario(() => Promise.resolve({ error })));
    await llenar();
    tocar(guardar());
    await expect.element(page.getByText("Ya existe una mesa con ese número")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});
