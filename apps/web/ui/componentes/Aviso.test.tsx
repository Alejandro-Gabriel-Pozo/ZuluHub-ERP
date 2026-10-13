import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { Boton } from "./Boton";
import { Aviso } from "./Aviso";

describe("Aviso", () => {
  it.each(["peligro", "exito", "aviso", "info"] as const)(
    "%s: sin violaciones y con ícono además del color",
    async (tono) => {
      const { container } = await render(
        <Aviso tono={tono} titulo="Atención">
          Algo pasó.
        </Aviso>,
      );
      expect(container.querySelector("svg")).not.toBeNull();
      expect(await violacionesDeAccesibilidad()).toEqual([]);
    },
  );

  it("el peligro se anuncia como alerta y lo demás como estado", async () => {
    await render(
      <>
        <Aviso tono="peligro">Falló.</Aviso>
        <Aviso tono="info">Dato.</Aviso>
      </>,
    );
    await expect.element(page.getByRole("alert")).toHaveTextContent("Falló.");
    await expect.element(page.getByRole("status")).toHaveTextContent("Dato.");
  });

  it("puede traer la acción y aria snapshot", async () => {
    await render(
      <Aviso tono="peligro" titulo="No se pudo completar" accion={<Boton>Reintentar</Boton>}>
        Podés reintentar.
      </Aviso>,
    );
    await expect.element(page.getByRole("alert")).toMatchAriaInlineSnapshot(`
      - alert:
        - paragraph: No se pudo completar
        - text: Podés reintentar.
        - button "Reintentar"
    `);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});
