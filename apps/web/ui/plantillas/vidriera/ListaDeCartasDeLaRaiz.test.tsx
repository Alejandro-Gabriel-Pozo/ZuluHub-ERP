import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { PlantillaNeutra } from "../PlantillaNeutra";
import { ListaDeCartasDeLaRaiz } from "./ListaDeCartasDeLaRaiz";

const CARTAS = [
  {
    codigo: "codigo-uno-xxxxxxxxxxxxxxxxxx",
    nombre: "Restaurante",
    rubro: "Cocina",
    lugar: "Av. Argentina 123",
  },
  { codigo: "codigo-dos-xxxxxxxxxxxxxxxxxx", nombre: "Pileta", rubro: null, lugar: null },
] as const;

const lista = () => (
  <PlantillaNeutra titulo="Hoteles del Sur">
    <ListaDeCartasDeLaRaiz cartas={CARTAS} rutaDe={(codigo) => `/${codigo}`} />
  </PlantillaNeutra>
);

describe("lista de cartas de la raíz (host dedicado con varias cartas)", () => {
  it("sin violaciones de axe como página (contraste incluido)", async () => {
    await render(lista());
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });

  it("un enlace por carta a /<código>, con nombre y, solo si los hay, rubro y lugar", async () => {
    await render(lista());
    const uno = page.getByRole("link", { name: /Restaurante/ });
    await expect.element(uno).toHaveAttribute("href", "/codigo-uno-xxxxxxxxxxxxxxxxxx");
    expect(uno.element().textContent).toContain("Cocina");
    expect(uno.element().textContent).toContain("Av. Argentina 123");
    const dos = page.getByRole("link", { name: "Pileta" });
    await expect.element(dos).toHaveAttribute("href", "/codigo-dos-xxxxxxxxxxxxxxxxxx");
    expect(dos.element().textContent).toBe("Pileta");
    expect(document.querySelectorAll("li")).toHaveLength(2);
  });
});
