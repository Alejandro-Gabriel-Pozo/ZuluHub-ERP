import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { cssDeTema } from "../../../../src/capacidades/experiencia/tema-css";
import { violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { CabeceraDeMarca } from "./CabeceraDeMarca";
import { EnlaceDeAccion } from "./EnlaceDeAccion";
import { EstiloDeMarca } from "./EstiloDeMarca";

const NONCE = "bm9uY2UtZGUtcHJ1ZWJhLTE2Ynl0ZXM=";

describe("EstiloDeMarca", () => {
  it("pinta un style con el nonce y el css del tema", async () => {
    const css = cssDeTema({ primary: "#7a1f1f", "on-primary": "#ffffff" });
    const { container } = await render(<EstiloDeMarca css={css} nonce={NONCE} />);
    const estilo = document.querySelector("style[nonce]");
    expect(estilo?.textContent).toBe(css);
    expect(container.children).toHaveLength(1);
  });

  it("sin css o sin nonce no pinta nada", async () => {
    await render(<EstiloDeMarca css="" nonce={NONCE} />);
    expect(document.querySelectorAll("style[nonce]")).toHaveLength(0);
    await render(<EstiloDeMarca css=":root{--brand-primary:#7a1f1f}" nonce={null} />);
    expect(document.querySelectorAll("style[nonce]")).toHaveLength(0);
  });
});

describe("CabeceraDeMarca", () => {
  it("muestra el nombre como texto, también si trae marcado", async () => {
    const { container } = await render(<CabeceraDeMarca nombre={'<b>Hotel</b> "del" Lago'} />);
    expect(container.querySelector("b")).toBeNull();
    await expect.element(page.getByText('<b>Hotel</b> "del" Lago')).toBeVisible();
    expect(page.getByRole("banner")).toBeDefined();
  });

  it("sin violaciones de accesibilidad (contraste incluido) con el tema de marca puesto", async () => {
    document.documentElement.style.setProperty("--brand-primary", "#7a1f1f");
    document.documentElement.style.setProperty("--brand-on-primary", "#ffffff");
    try {
      await render(<CabeceraDeMarca nombre="Hotel del Lago" />);
      expect(await violacionesDeAccesibilidad()).toEqual([]);
    } finally {
      document.documentElement.style.removeProperty("--brand-primary");
      document.documentElement.style.removeProperty("--brand-on-primary");
    }
  });
});

describe("EnlaceDeAccion", () => {
  it("es un enlace con su destino y su verbo, y sin violaciones", async () => {
    await render(<EnlaceDeAccion href="https://app.hoteldellago.test/">Ingresar</EnlaceDeAccion>);
    const enlace = page.getByRole("link", { name: "Ingresar" });
    await expect.element(enlace).toBeVisible();
    await expect.element(enlace).toHaveAttribute("href", "https://app.hoteldellago.test/");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el objetivo táctil no baja del mínimo de la superficie", async () => {
    await render(<EnlaceDeAccion href="/x">Ingresar</EnlaceDeAccion>);
    const caja = page.getByRole("link", { name: "Ingresar" }).element().getBoundingClientRect();
    expect(caja.height).toBeGreaterThanOrEqual(44);
    expect(caja.width).toBeGreaterThanOrEqual(44);
  });
});
