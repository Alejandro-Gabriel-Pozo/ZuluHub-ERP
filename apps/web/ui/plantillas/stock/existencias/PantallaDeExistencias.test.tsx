import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import { armarLasExistencias, type ExistenciasDeLaComposicion } from "./modelo-de-existencias";
import { PantallaDeExistencias } from "./PantallaDeExistencias";

/** «Existencias» en Chromium (maqueta `stock.html`): el selector de depósitos como enlaces, una tarjeta por artículo con su existencia y unidad, «Negativa» solo en el saldo bajo cero, accesible y sin botones. */
const TEXTOS = { depositos: "Depósitos", negativa: "Negativa", siguiente: "Siguiente" };
const DATO: ExistenciasDeLaComposicion = {
  depositos: [
    { id: "d1", nombre: "Salón" },
    { id: "d2", nombre: "Cocina" },
  ],
  depositoId: "d1",
  existencias: [
    {
      articuloId: "a1",
      nombre: "Harina",
      unidadId: "KILOGRAMO",
      existencia: "12.5000",
      negativa: false,
    },
    {
      articuloId: "a2",
      nombre: "Sal",
      unidadId: "KILOGRAMO",
      existencia: "-2.0000",
      negativa: true,
    },
  ],
  siguiente: null,
};
const pantalla = (dato = DATO) => (
  <PantallaDeExistencias vista={armarLasExistencias(dato)} textos={TEXTOS} />
);

describe("PantallaDeExistencias", () => {
  it("muestra una tarjeta por artículo con su existencia; «Negativa» solo en el saldo negativo; es accesible", async () => {
    await render(pantalla());
    await expect.element(page.getByText("Harina")).toBeVisible();
    await expect.element(page.getByText("12,5", { exact: false })).toBeVisible();
    expect(page.getByText("Negativa").elements()).toHaveLength(1);
    expect(page.getByRole("button").elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el selector lista los depósitos como enlaces a su dirección y marca el elegido", async () => {
    await render(pantalla());
    await expect
      .element(page.getByRole("link", { name: "Cocina" }))
      .toHaveAttribute("href", "/stock/existencias?deposito=d2");
    await expect
      .element(page.getByRole("link", { name: "Salón" }))
      .toHaveAttribute("aria-current", "page");
  });

  it("«Siguiente» aparece solo si hay otra página y lleva el cursor tal cual", async () => {
    await render(pantalla());
    expect(page.getByRole("link", { name: "Siguiente" }).elements()).toHaveLength(0);
  });

  it("con otra página, «Siguiente» conserva el depósito y el cursor", async () => {
    await render(pantalla({ ...DATO, siguiente: "abc_-123" }));
    await expect
      .element(page.getByRole("link", { name: "Siguiente" }))
      .toHaveAttribute("href", "/stock/existencias?deposito=d1&despues=abc_-123");
  });
});
