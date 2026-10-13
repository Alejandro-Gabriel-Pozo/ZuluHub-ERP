import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { Insignia } from "./Insignia";

describe("Insignia", () => {
  it.each(["peligro", "exito", "aviso", "info", "neutro"] as const)(
    "%s: sin violaciones (contraste incluido) y con texto",
    async (tono) => {
      await render(<Insignia tono={tono}>Estado</Insignia>);
      await expect.element(page.getByText("Estado")).toBeVisible();
      expect(await violacionesDeAccesibilidad()).toEqual([]);
    },
  );

  it.each(["peligro", "exito", "aviso", "info"] as const)(
    "%s: el estado no se dice solo con color, lleva un ícono además del texto",
    async (tono) => {
      const { container } = await render(<Insignia tono={tono}>Estado</Insignia>);
      expect(container.querySelector("svg")).not.toBeNull();
      expect(container.textContent).toBe("Estado");
    },
  );

  it("la neutra no tiene ícono: no afirma ningún estado", async () => {
    const { container } = await render(<Insignia tono="neutro">Borrador</Insignia>);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("aria snapshot: el nombre es el texto", async () => {
    await render(
      <ul>
        <li>
          <Insignia tono="exito">Cobrado</Insignia>
        </li>
      </ul>,
    );
    await expect.element(page.getByRole("list")).toMatchAriaInlineSnapshot(`
      - list:
        - listitem: Cobrado
    `);
  });
});
