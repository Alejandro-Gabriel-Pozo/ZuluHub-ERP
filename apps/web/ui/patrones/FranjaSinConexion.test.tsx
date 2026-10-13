import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { restaurarConexion, simularConexion, violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { FranjaSinConexion } from "./FranjaSinConexion";

afterEach(restaurarConexion);

describe("FranjaSinConexion", () => {
  it("con conexión no se ve", async () => {
    await render(<FranjaSinConexion texto="Sin conexión." />);
    expect(page.getByText("Sin conexión.").query()).toBeNull();
  });

  it("al perder la conexión aparece, persistente y como mensaje de estado; al volver, se va", async () => {
    await render(<FranjaSinConexion texto="Sin conexión. Cuando vuelva, podés seguir." />);
    simularConexion(false);
    const franja = page.getByRole("status");
    await expect.element(franja).toBeVisible();
    await expect
      .element(franja)
      .toMatchAriaInlineSnapshot(`- status: Sin conexión. Cuando vuelva, podés seguir.`);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    // No tiene botón para descartarla.
    expect(page.getByRole("button").query()).toBeNull();
    simularConexion(true);
    await expect.element(franja).not.toBeInTheDocument();
  });

  it("si ya empieza sin conexión, se ve desde el primer momento", async () => {
    simularConexion(false);
    await render(<FranjaSinConexion texto="Sin conexión." />);
    await expect.element(page.getByRole("status")).toHaveTextContent("Sin conexión.");
  });
});
