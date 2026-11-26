import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { pestanasDeStock } from "./pestanas-de-stock";
import { PestanasDeStock } from "./PestanasDeStock";
import { PESTANAS_CONSTRUIDAS, RUTAS_DE_STOCK } from "./rutas-de-stock";

/** Las pestañas de Stock en Chromium (maqueta `stock.html`, 09/11/2026): solo las de pantallas construidas, la actual marcada, accesibles. */
describe("PestanasDeStock", () => {
  it("hoy son tres enlaces (Existencias, Movimientos y Depósitos), con el actual marcado", async () => {
    await render(<PestanasDeStock pestanas={pestanasDeStock("movimientos")} />);
    await expect
      .element(page.getByRole("link", { name: "Existencias" }))
      .toHaveAttribute("href", "/stock/existencias");
    await expect
      .element(page.getByRole("link", { name: "Movimientos" }))
      .toHaveAttribute("aria-current", "page");
    await expect
      .element(page.getByRole("link", { name: "Depósitos" }))
      .toHaveAttribute("href", "/stock/depositos");
    expect(page.getByRole("link").elements()).toHaveLength(3);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("ningún enlace lleva a una pantalla que todavía no existe (evita el 404)", async () => {
    await render(<PestanasDeStock pestanas={pestanasDeStock("depositos")} />);
    const permitidas = PESTANAS_CONSTRUIDAS.map((clave) => RUTAS_DE_STOCK[clave]);
    for (const enlace of page.getByRole("link").elements()) {
      expect(permitidas).toContain(enlace.getAttribute("href"));
    }
    for (const nombre of ["Conteo"]) {
      expect(page.getByRole("link", { name: nombre }).elements()).toHaveLength(0);
    }
  });
});
