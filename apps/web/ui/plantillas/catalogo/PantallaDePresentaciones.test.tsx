import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { verificarFoco, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { PantallaDePresentaciones } from "./PantallaDePresentaciones";
import {
  armarLaListaDePresentaciones,
  type PresentacionesDeLaPantalla,
} from "./modelo-de-presentaciones";

/**
 * La lista de presentaciones de un producto en Chromium (maqueta `presentaciones.html`): las tarjetas con su cantidad y sus marcas, «Editar» y «Agregar presentación» como enlaces (apagados sin
 * permiso, no escondidos), la lista vacía, el teclado y axe, tamaños y sin desborde en 390 y 1280 px.
 */
const P = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const DATO: PresentacionesDeLaPantalla = {
  producto: { id: P, nombre: "Queso cremoso", unidadBase: "kg", activo: true },
  presentaciones: [
    {
      id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
      nombre: "Caja de 5 kg",
      cantidad: "5.0000",
      dePesoVariable: false,
      activa: true,
      version: 1,
    },
    {
      id: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a",
      nombre: "Horma",
      cantidad: "4.0000",
      dePesoVariable: true,
      activa: false,
      version: 3,
    },
  ],
};

afterEach(async () => {
  await page.viewport(390, 844);
});

const pantalla = (dato = DATO, puedeEditar = true) => (
  <PantallaDePresentaciones lista={armarLaListaDePresentaciones(dato, puedeEditar)} />
);

describe("PantallaDePresentaciones", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 900],
      [1280, 800],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(pantalla());
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });

  it("cada tarjeta dice su nombre, su cantidad con la unidad y sus marcas", async () => {
    await render(pantalla());
    await expect.element(page.getByText("Caja de 5 kg")).toBeVisible();
    await expect.element(page.getByText("5 kg", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Horma")).toBeVisible();
    await expect.element(page.getByText("≈ 4 kg")).toBeVisible();
    await expect.element(page.getByText("De peso variable")).toBeVisible();
    await expect.element(page.getByText("Desactivado")).toBeVisible();
  });

  it("«Editar» lleva a la presentación y «Agregar presentación» al alta, como enlaces", async () => {
    await render(pantalla());
    const editar = page.getByRole("link", { name: "Editar" });
    await expect
      .element(editar.first())
      .toHaveAttribute(
        "href",
        `/catalogo/productos/${P}/compra/1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f`,
      );
    await expect
      .element(page.getByRole("link", { name: "Agregar presentación" }))
      .toHaveAttribute("href", `/catalogo/productos/${P}/compra/nueva`);
  });

  it("sin permiso los botones de escribir se ven apagados y sin enlace, no escondidos", async () => {
    await render(pantalla(DATO, false));
    expect(document.querySelectorAll("a")).toHaveLength(0);
    await expect.element(page.getByRole("button", { name: "Agregar presentación" })).toBeDisabled();
    for (const boton of page.getByRole("button", { name: "Editar" }).elements()) {
      expect((boton as HTMLButtonElement).disabled).toBe(true);
    }
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin presentaciones dice «Sin presentaciones» y ofrece «Agregar presentación»", async () => {
    await render(pantalla({ ...DATO, presentaciones: [] }));
    await expect.element(page.getByText("Sin presentaciones")).toBeVisible();
    await expect.element(page.getByRole("link", { name: "Agregar presentación" })).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el teclado recorre «Editar» de cada tarjeta y «Agregar presentación», con el foco a la vista", async () => {
    await render(pantalla());
    const primero = page.getByRole("link", { name: "Editar" }).first().element() as HTMLElement;
    await verificarFoco(primero);
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe("Editar");
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe("Agregar presentación");
  });
});
