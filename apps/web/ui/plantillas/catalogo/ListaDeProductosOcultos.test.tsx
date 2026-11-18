import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { errorDeCodigo } from "../../../../../src/capacidades/experiencia/respuesta";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { ListaDeProductosOcultos } from "./ListaDeProductosOcultos.cliente";
import { armarLosOcultos } from "./modelo-de-ocultos";

/**
 * La lista de productos ocultos en Chromium (maqueta `productos.html`, `vListaOcultos`): avisos por alcance, que «Volver a mostrar» manda SU acción y una sola vez con el doble toque, el
 * botón apagado sin permiso, el motivo del servidor debajo, «Sin resultados» y axe en 390 y 1280 px.
 */
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const OCULTOS = [
  { productoId: "a", nombre: "Latte", local: true, empresa: false },
  { productoId: "b", nombre: "Milanesa", local: false, empresa: true },
];
const lista = (
  permisos = { local: true, empresa: true },
  acciones: Record<string, AccionDeFormulario> = {},
  ocultos = OCULTOS,
) => (
  <ListaDeProductosOcultos
    lista={armarLosOcultos(ocultos, permisos)}
    acciones={{ a: acciones["a"] ?? ok, b: acciones["b"] ?? ok }}
  />
);
const botones = () => page.getByRole("button", { name: "Volver a mostrar", exact: true });

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("ListaDeProductosOcultos", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 900],
      [1280, 700],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(lista());
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });

  it("cada producto con su aviso y su botón", async () => {
    await render(lista());
    await expect.element(page.getByText("Latte")).toBeVisible();
    await expect.element(page.getByText("Oculto", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Oculto en toda la empresa", { exact: true }))
      .toBeVisible();
    expect(botones().elements()).toHaveLength(2);
  });

  it("el botón de cada fila manda SU acción", async () => {
    const a = vi.fn(ok);
    const b = vi.fn(ok);
    await render(lista(undefined, { a, b }));
    await userEvent.click(botones().nth(1));
    await vi.waitFor(() => expect(b).toHaveBeenCalledTimes(1));
    expect(a).not.toHaveBeenCalled();
  });

  it("sin permiso para la empresa, esa fila sale apagada y no envía", async () => {
    const b = vi.fn(ok);
    await render(lista({ local: true, empresa: false }, { b }));
    await expect.element(botones().nth(1)).toBeDisabled();
    await expect.element(botones().nth(0)).toBeEnabled();
  });

  it("el motivo del servidor sale debajo", async () => {
    const rechaza: AccionDeFormulario = () =>
      Promise.resolve({ error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") });
    await render(lista(undefined, { a: rechaza }));
    await userEvent.click(botones().nth(0));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
  });

  it("sin ocultos: «Sin resultados»", async () => {
    await render(lista(undefined, {}, []));
    await expect.element(page.getByText("Sin resultados")).toBeVisible();
  });
});
