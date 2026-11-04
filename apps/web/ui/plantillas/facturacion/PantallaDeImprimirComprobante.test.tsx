import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { comprobanteDePrueba, QR_DE_PRUEBA } from "./impresion/ayudas-de-impresion";
import { PantallaDeImprimirComprobante } from "./PantallaDeImprimirComprobante.cliente";

/**
 * La vista previa para imprimir en Chromium (D-97, D-100): A4 al abrir, el selector cambia a Ticket sin recargar, «Imprimir» llama a
 * `window.print()` (espía: no se abre un diálogo real), los controles quedan fuera de la zona de impresión, axe sin violaciones, objetivos
 * de toque de 44 px y letra legible. Se corre a 390 px (celular) y a 1280 px (escritorio) con el tamaño de la ventana de cada proyecto.
 */

const dibujar = () =>
  render(
    <>
      <h1>Título de la pantalla</h1>
      <PantallaDeImprimirComprobante
        comprobante={comprobanteDePrueba({ renglones: 3 })}
        qrSvg={QR_DE_PRUEBA}
      />
    </>,
  );

const formatoMostrado = (): string | null =>
  document.querySelector("style[data-estilo-de-pagina]")?.getAttribute("data-estilo-de-pagina") ??
  null;

const radio = (nombre: string): HTMLInputElement => {
  const etiqueta = [...document.querySelectorAll("label")].find(
    (l) => l.textContent?.trim() === nombre,
  );
  const control = etiqueta?.querySelector("input");
  if (!control) throw new Error(`no hay formato ${nombre}`);
  return control;
};

const etiquetaDe = (nombre: string): HTMLElement => {
  const etiqueta = radio(nombre).closest("label");
  if (!etiqueta) throw new Error(`no hay etiqueta de ${nombre}`);
  return etiqueta;
};

const luminancia = (rgb: string): number => {
  const [r = 0, g = 0, b = 0] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const lineal = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (lineal[0] ?? 0) + 0.7152 * (lineal[1] ?? 0) + 0.0722 * (lineal[2] ?? 0);
};

/** Hay anillo de foco sobre la etiqueta: contorno con estilo y ancho, y contraste de 3:1 o más con el fondo de la página. */
const anilloVisible = (nombre: string): boolean => {
  const estilo = getComputedStyle(etiquetaDe(nombre));
  if (estilo.outlineStyle === "none" || Number.parseFloat(estilo.outlineWidth) <= 0) return false;
  const a = luminancia(estilo.outlineColor);
  const b = luminancia(getComputedStyle(document.body).backgroundColor);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 3;
};

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("vista previa para imprimir", () => {
  it("abre en A4 y el selector pasa a Ticket y vuelve sin recargar", async () => {
    await dibujar();
    await expect.poll(() => document.querySelectorAll("[data-hoja]").length).toBeGreaterThan(0);
    expect(formatoMostrado()).toBe("A4");
    expect(radio("A4").checked).toBe(true);
    const marca = document.body.appendChild(document.createElement("i"));
    radio("Ticket").click();
    await expect.poll(() => document.querySelector("[data-ticket]")).not.toBeNull();
    expect(formatoMostrado()).toBe("TICKET");
    expect(document.querySelectorAll("[data-hoja]")).toHaveLength(0);
    // Sin recarga: lo agregado a mano a la página sigue ahí.
    expect(document.body.contains(marca)).toBe(true);
    radio("A4").click();
    await expect.poll(() => document.querySelectorAll("[data-hoja]").length).toBeGreaterThan(0);
    expect(document.querySelector("[data-ticket]")).toBeNull();
    marca.remove();
  });

  it("con teclado el foco se ve sobre la etiqueta del formato (el radio es transparente) y se mueve con las flechas", async () => {
    await dibujar();
    document.body.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(radio("A4"));
    expect(anilloVisible("A4")).toBe(true);
    expect(anilloVisible("Ticket")).toBe(false);
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(radio("Ticket"));
    expect(anilloVisible("Ticket")).toBe(true);
    expect(anilloVisible("A4")).toBe(false);
  });

  it("«Imprimir» abre el diálogo de impresión del navegador (window.print) y no hace otra cosa", async () => {
    const imprimir = vi.spyOn(window, "print").mockImplementation(() => undefined);
    try {
      await dibujar();
      const boton = [...document.querySelectorAll("button")].find(
        (b) => b.textContent === "Imprimir",
      );
      expect(boton).toBeDefined();
      boton?.click();
      expect(imprimir).toHaveBeenCalledTimes(1);
    } finally {
      imprimir.mockRestore();
    }
  });

  it("los controles quedan fuera de la zona de impresión", async () => {
    await dibujar();
    const zona = document.querySelector("[data-zona-de-impresion]");
    expect(zona).not.toBeNull();
    expect(zona?.querySelector("button, input")).toBeNull();
  });

  it.each([
    ["A4", 390],
    ["Ticket", 390],
    ["A4", 1280],
    ["Ticket", 1280],
  ] as const)(
    "%s a %i px: sin violaciones de accesibilidad, objetivos de 44 px, letra de 16 px o más en los controles y sin desborde lateral",
    async (formato, ancho) => {
      await page.viewport(ancho, 900);
      await dibujar();
      radio(formato).click();
      await expect
        .poll(() =>
          formato === "A4"
            ? document.querySelectorAll("[data-hoja]").length
            : document.querySelectorAll("[data-ticket]").length,
        )
        .toBeGreaterThan(0);
      expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
      const controles = [...document.querySelectorAll<HTMLElement>("button, label")].filter(
        (el) => !el.closest("[data-zona-de-impresion]"),
      );
      expect(controles.length).toBe(3);
      for (const el of controles) {
        const caja = el.getBoundingClientRect();
        expect(caja.height, el.textContent ?? "").toBeGreaterThanOrEqual(44);
        expect(caja.width, el.textContent ?? "").toBeGreaterThanOrEqual(44);
        expect(
          Number.parseFloat(getComputedStyle(el).fontSize),
          el.textContent ?? "",
        ).toBeGreaterThanOrEqual(16);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    },
  );
});
