import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { ContenedorDeLetra } from "./ContenedorDeLetra.cliente";
import { PaginaDeProducto, PaginaDeProductoQueYaNoEsta } from "./PaginaDeProducto";
import { CAPUCHINO, CON_FOTO, SIN_NADA, TEXTOS } from "./datosDePrueba";

afterEach(() => {
  window.localStorage.clear();
  Reflect.deleteProperty(navigator, "share");
  vi.restoreAllMocks();
});

const pagina = (producto = CAPUCHINO) => (
  <ContenedorDeLetra letraBase="NORMAL">
    <PaginaDeProducto
      producto={producto}
      vidriera="La Esquina Café"
      hrefDeLaVidriera="/ejemplo#cafes"
      textos={TEXTOS}
    />
  </ContenedorDeLetra>
);

describe("página del producto (entrada directa, §3.2)", () => {
  it("sin violaciones de axe como página (contraste incluido)", async () => {
    await render(pagina());
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });

  it("un h1 con el nombre, la lista de precios, los adicionales y «Ver toda la carta» a su sección", async () => {
    await render(pagina());
    expect(page.getByRole("heading", { level: 1 }).element().textContent).toBe("Capuchino");
    await expect.element(page.getByRole("heading", { level: 2, name: "Precios" })).toBeVisible();
    await expect.element(page.getByText("Leche de almendras")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Ver toda la carta" }))
      .toHaveAttribute("href", "/ejemplo#cafes");
  });

  it("sin foto ni descripción ni adicionales no dibuja bloques vacíos", async () => {
    await render(pagina(SIN_NADA));
    expect(document.querySelector("img")).toBeNull();
    expect(document.body.textContent).not.toContain("Sin descripción");
    expect(document.querySelectorAll("h2")).toHaveLength(0);
    expect(document.body.textContent).toContain("$ 900");
  });

  it("con foto: una imagen con su texto alternativo, width y height", async () => {
    await render(pagina(CON_FOTO));
    const img = document.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("Torta rogel con dulce de leche");
    expect(img?.getAttribute("width")).toBe("480");
  });

  it("respeta el paso de «Letra» recordado: 25 px con «muy grande»", async () => {
    window.localStorage.setItem("pd-carta-letra", "MUY_GRANDE");
    await render(pagina());
    await vi.waitFor(() => {
      const h2 = document.querySelector("h2") as Element;
      expect(parseFloat(getComputedStyle(h2).fontSize)).toBeGreaterThanOrEqual(16);
      expect(
        parseFloat(getComputedStyle(document.querySelector("main") as Element).fontSize),
      ).toBeCloseTo(25, 1);
    });
  });

  it("compartir sin Web Share copia el enlace", async () => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    const escribir = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await render(pagina());
    await userEvent.click(page.getByRole("button", { name: "Compartir" }));
    await expect.element(page.getByRole("status")).toHaveTextContent("Enlace copiado");
    expect(escribir).toHaveBeenCalledWith(new URL(CAPUCHINO.href, window.location.href).toString());
  });

  it("producto que ya no está: lo dice y ofrece la carta, con axe limpio", async () => {
    await render(<PaginaDeProductoQueYaNoEsta hrefDeLaVidriera="./" textos={TEXTOS} />);
    expect(page.getByRole("heading", { level: 1 }).element().textContent).toBe(
      "Este producto ya no está en la carta.",
    );
    await expect
      .element(page.getByRole("link", { name: "Ver toda la carta" }))
      .toHaveAttribute("href", "./");
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });
});
