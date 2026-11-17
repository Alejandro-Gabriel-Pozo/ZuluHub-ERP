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

const URL_DEL_PDF = "/facturacion/comprobantes/0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b/pdf";

const dibujar = () =>
  render(
    <>
      <h1>Título de la pantalla</h1>
      <PantallaDeImprimirComprobante
        comprobante={comprobanteDePrueba({ renglones: 3 })}
        qrSvg={QR_DE_PRUEBA}
        urlDelPdf={URL_DEL_PDF}
      />
    </>,
  );

const formatoMostrado = (): string | null =>
  document.querySelector("[data-zona-de-impresion]")?.getAttribute("data-formato") ?? null;

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

  it("«Descargar PDF» es un enlace a la ruta del PDF del comprobante, fuera de la zona de impresión, y no abre el diálogo de impresión", async () => {
    const imprimir = vi.spyOn(window, "print").mockImplementation(() => undefined);
    try {
      await dibujar();
      const enlaces = [...document.querySelectorAll("a")].filter(
        (a) => a.textContent === "Descargar PDF",
      );
      expect(enlaces).toHaveLength(1);
      expect(enlaces[0]?.getAttribute("href")).toBe(URL_DEL_PDF);
      expect(enlaces[0]?.closest("[data-zona-de-impresion]")).toBeNull();
      // Es un enlace que navega (la descarga la sirve el servidor): tocarlo no llama a `window.print`.
      enlaces[0]?.addEventListener("click", (evento) => evento.preventDefault());
      enlaces[0]?.click();
      expect(imprimir).not.toHaveBeenCalled();
    } finally {
      imprimir.mockRestore();
    }
  });

  it("con teclado «Descargar PDF» se alcanza después de «Imprimir» y muestra su foco", async () => {
    await dibujar();
    const enlace = [...document.querySelectorAll("a")].find(
      (a) => a.textContent === "Descargar PDF",
    );
    const imprimirBoton = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Imprimir",
    );
    expect(enlace).toBeDefined();
    imprimirBoton?.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(enlace);
    const estilo = getComputedStyle(enlace as HTMLElement);
    expect(estilo.outlineStyle === "none" && estilo.boxShadow === "none").toBe(false);
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
      const controles = [...document.querySelectorAll<HTMLElement>("button, label, a")].filter(
        (el) => !el.closest("[data-zona-de-impresion]"),
      );
      // Los dos formatos, «Imprimir» y «Descargar PDF».
      expect(controles.length).toBe(4);
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
