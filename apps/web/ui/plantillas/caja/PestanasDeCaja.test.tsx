import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { pestanasDeCaja } from "./pestanas-de-caja";
import { PestanasDeCaja } from "./PestanasDeCaja";

/** Las pestañas de la configuración de caja en Chromium (maqueta `medios.html`, 09/11/2026): tres enlaces, la actual marcada, accesibles. */
describe("PestanasDeCaja", () => {
  it("son tres enlaces a sus pantallas y solo la actual lleva aria-current", async () => {
    await render(<PestanasDeCaja pestanas={pestanasDeCaja("cuentas")} />);
    await expect
      .element(page.getByRole("link", { name: "Medios de pago" }))
      .toHaveAttribute("href", "/caja/medios-de-pago");
    await expect
      .element(page.getByRole("link", { name: "Cuentas de cobro" }))
      .toHaveAttribute("aria-current", "page");
    await expect
      .element(page.getByRole("link", { name: "Cajas" }))
      .not.toHaveAttribute("aria-current");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});
