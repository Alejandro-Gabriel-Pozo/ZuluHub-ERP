import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { EnlaceDeAccion } from "./EnlaceDeAccion";

describe("EnlaceDeAccion", () => {
  it("es un enlace con su destino y, sin decir la variante, el aspecto primario", async () => {
    await render(<EnlaceDeAccion href="/destino">Ingresar</EnlaceDeAccion>);
    const enlace = page.getByRole("link", { name: "Ingresar" });
    await expect.element(enlace).toHaveAttribute("href", "/destino");
    await expect.element(enlace).toHaveAttribute("data-variante", "primaria");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("la variante secundaria cambia el aspecto (fondo del campo, no el de la acción) y sigue siendo accesible", async () => {
    await render(
      <>
        <EnlaceDeAccion href="/a">Principal</EnlaceDeAccion>
        <EnlaceDeAccion href="/b" variante="secundaria">
          Editar
        </EnlaceDeAccion>
      </>,
    );
    const primario = getComputedStyle(page.getByRole("link", { name: "Principal" }).element());
    const secundario = getComputedStyle(page.getByRole("link", { name: "Editar" }).element());
    expect(secundario.backgroundColor).not.toBe(primario.backgroundColor);
    expect(
      page.getByRole("link", { name: "Editar" }).element().getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(44);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});
