import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { Pila } from "./Pila";
import { SoloLector } from "./SoloLector";
import { Texto } from "./Texto";

describe("primitivas visuales", () => {
  it("Texto: la etiqueta HTML la elige quien arma la pantalla y la jerarquía queda bien", async () => {
    await render(
      <>
        <Texto como="h1" variante="titulo">
          Título
        </Texto>
        <Texto como="h2" variante="subtitulo">
          Sección
        </Texto>
        <Texto>Cuerpo</Texto>
        <Texto variante="suave">Suave</Texto>
        <Texto variante="chico">Chico</Texto>
      </>,
    );
    await expect.element(page.getByRole("heading", { level: 1, name: "Título" })).toBeVisible();
    await expect.element(page.getByRole("heading", { level: 2, name: "Sección" })).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("Pila: separa y ordena los hijos en columna o en fila", async () => {
    const { container } = await render(
      <Pila separacion={4} direccion="fila" alinear="centro" envolver>
        <span>a</span>
        <span>b</span>
      </Pila>,
    );
    const pila = container.firstElementChild as HTMLElement;
    const estilo = getComputedStyle(pila);
    expect(estilo.flexDirection).toBe("row");
    expect(estilo.flexWrap).toBe("wrap");
    expect(estilo.alignItems).toBe("center");
    expect(parseFloat(estilo.columnGap)).toBe(16);
  });

  it("SoloLector: no se ve pero el lector de pantalla lo tiene", async () => {
    await render(
      <button type="button">
        Cobrar <SoloLector>la venta 15</SoloLector>
      </button>,
    );
    await expect
      .element(page.getByRole("button", { name: "Cobrar la venta 15" }))
      .toBeInTheDocument();
    const caja = page.getByText("la venta 15").element().getBoundingClientRect();
    expect(caja.width).toBeLessThanOrEqual(1);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});
