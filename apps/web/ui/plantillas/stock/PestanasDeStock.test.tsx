import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { pestanasDeStock } from "./pestanas-de-stock";
import { PestanasDeStock } from "./PestanasDeStock";

/** Las pestañas de Stock en Chromium (maqueta `stock.html`, 09/11/2026): cuatro enlaces en el orden de la maqueta, la actual marcada, accesibles. */
describe("PestanasDeStock", () => {
  it("son cuatro enlaces a sus pantallas y solo la actual lleva aria-current", async () => {
    await render(<PestanasDeStock pestanas={pestanasDeStock("depositos")} />);
    await expect
      .element(page.getByRole("link", { name: "Existencias" }))
      .toHaveAttribute("href", "/stock/existencias");
    await expect
      .element(page.getByRole("link", { name: "Movimientos" }))
      .toHaveAttribute("href", "/stock/movimientos");
    await expect
      .element(page.getByRole("link", { name: "Conteo" }))
      .toHaveAttribute("href", "/stock/conteo");
    await expect
      .element(page.getByRole("link", { name: "Depósitos" }))
      .toHaveAttribute("aria-current", "page");
    await expect
      .element(page.getByRole("link", { name: "Existencias" }))
      .not.toHaveAttribute("aria-current");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});
