import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { reglaDePaginaAdoptada } from "../facturacion/impresion/ayudas-de-impresion";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { BotonDePruebaDeImpresora } from "./BotonDePruebaDeImpresora.cliente";

/**
 * «Imprimir prueba» en Chromium (maqueta `imprimir.html`): abre el diálogo de impresión del sistema (`window.print`, un espía: no se abre un diálogo real) con una hoja fija (el nombre y el ancho de la impresora, sin
 * palabras nuevas) y con la regla de página del ancho ya adoptada; el botón se apaga mientras corre y el segundo toque no abre un segundo diálogo; al terminar saca la hoja y suelta la regla. Es solo del navegador: no pide nada al servidor.
 */
let imprimir: MockInstance<() => void>;
let reglaAlImprimir = "";
let textoAlImprimir = "";

beforeEach(() => {
  reglaAlImprimir = "";
  textoAlImprimir = "";
  imprimir = vi.spyOn(window, "print").mockImplementation(() => {
    reglaAlImprimir = reglaDePaginaAdoptada();
    textoAlImprimir = document.querySelector("[data-papel]")?.textContent ?? "";
  });
});
afterEach(() => {
  imprimir.mockRestore();
});

const boton = () => page.getByRole("button", { name: /Imprimir prueba|Imprimiendo/ });
const dibujar = () =>
  render(
    <BotonDePruebaDeImpresora
      texto="Imprimir prueba"
      textoImprimiendo="Imprimiendo"
      nombre="Caja"
      papelMm={58}
    />,
  );

describe("BotonDePruebaDeImpresora", () => {
  it("abre el diálogo de impresión con la hoja fija (nombre y «58 mm») y la regla de página del ancho ya adoptada", async () => {
    await dibujar();
    tocar(boton());
    await vi.waitFor(() => expect(imprimir).toHaveBeenCalledTimes(1));
    expect(textoAlImprimir).toBe("Caja58 mm");
    expect(reglaAlImprimir).toMatch(/size: 58mm \d+mm/);
  });

  it("al terminar saca la hoja, suelta la regla y el botón vuelve a estar disponible", async () => {
    await dibujar();
    tocar(boton());
    await vi.waitFor(() => expect(imprimir).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(document.querySelector("[data-papel]")).toBeNull());
    expect(reglaDePaginaAdoptada()).toBe("");
    await expect.element(boton()).not.toHaveAttribute("aria-busy", "true");
    await expect.element(boton()).toHaveTextContent("Imprimir prueba");
  });

  it("DOBLE TOQUE: se apaga («Imprimiendo») y el segundo toque no abre un segundo diálogo", async () => {
    imprimir.mockImplementation(() => {
      // El diálogo queda abierto un rato: window.print bloquea mientras tanto.
      const hasta = performance.now() + 300;
      while (performance.now() < hasta) {
        /* espera */
      }
    });
    await dibujar();
    tocar(boton());
    tocar(boton());
    tocar(boton());
    await vi.waitFor(() => expect(imprimir).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(document.querySelector("[data-papel]")).toBeNull());
    expect(imprimir).toHaveBeenCalledTimes(1);
  });

  it("DOBLE TOQUE REAL con el diálogo bloqueando la página: el segundo toque, que el navegador entrega al terminar, no abre otro diálogo; uno deliberado, más tarde, sí", async () => {
    imprimir.mockImplementation(() => {
      const hasta = performance.now() + 300;
      while (performance.now() < hasta) {
        /* el diálogo bloquea la página */
      }
    });
    await dibujar();
    await userEvent.dblClick(boton());
    await vi.waitFor(() => expect(imprimir).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 500));
    expect(imprimir).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 900));
    tocar(boton());
    await vi.waitFor(() => expect(imprimir).toHaveBeenCalledTimes(2));
  });

  it("si el navegador no puede imprimir, no se rompe: la hoja se saca y el botón vuelve", async () => {
    imprimir.mockImplementation(() => {
      throw new Error("sin diálogo");
    });
    await dibujar();
    tocar(boton());
    await vi.waitFor(() => expect(document.querySelector("[data-papel]")).toBeNull());
    await expect.element(boton()).toHaveTextContent("Imprimir prueba");
  });

  it("axe sin violaciones", async () => {
    await dibujar();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});
