import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { TEXTOS, vidrieraDePrueba } from "./datosDePrueba";
import { LibroDeVidriera } from "./LibroDeVidriera.cliente";

const URL_INICIAL = window.location.href;
const vista = vidrieraDePrueba({ cantidad: 20 });
const nombres = vista.secciones.map((s) => s.nombre);

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.history.replaceState(null, "", URL_INICIAL);
});

async function abrir() {
  const pantalla = await render(<LibroDeVidriera vista={vista} textos={TEXTOS} />);
  await expect.element(page.getByRole("heading", { level: 1, name: vista.nombre })).toBeVisible();
  return pantalla;
}

describe("LibroDeVidriera", () => {
  it("el HTML del servidor es la Lista completa: portada, índice de anclas y TODAS las secciones", () => {
    const html = renderToString(<LibroDeVidriera vista={vista} textos={TEXTOS} />);
    for (const nombre of nombres) expect(html).toContain(nombre);
    expect(html).toContain('data-modelo="LIBRO"');
    expect(html).toContain(`href="#${vista.secciones[0]?.id ?? ""}"`);
  });

  it("al hidratar muestra la portada, sin contador, y ‹ no hace nada", async () => {
    await abrir();
    expect(document.body.textContent).not.toContain("Sección 1 de");
    await expect.element(page.getByRole("button", { name: "Anterior" })).toBeDisabled();
    expect(document.body.textContent).not.toContain(nombres[0] ?? "");
  });

  it("› lleva al índice; elegir una sección muestra solo esa, con «Sección n de m»", async () => {
    await abrir();
    await userEvent.click(page.getByRole("button", { name: "Siguiente" }));
    await expect.element(page.getByRole("heading", { level: 2, name: "Índice" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: new RegExp(nombres[1] ?? "") }));
    await expect
      .element(page.getByRole("heading", { level: 2, name: nombres[1] ?? "" }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain(nombres[0] ?? "§");
    expect(
      [...document.querySelectorAll('[role="status"]')].map((e) => e.textContent).join(" "),
    ).toContain(`Sección 2 de ${String(nombres.length)}`);
    expect(window.location.hash).toBe(`#${vista.secciones[1]?.id ?? ""}`);
    // El foco quedó en el título de la página nueva.
    expect(document.activeElement?.tagName).toBe("H2");
  });

  it("el botón Índice vuelve al índice y no está en la portada ni en el índice", async () => {
    await abrir();
    expect(page.getByRole("button", { name: "Índice" }).elements()).toHaveLength(0);
    await userEvent.click(page.getByRole("button", { name: "Siguiente" }));
    expect(page.getByRole("button", { name: "Índice" }).elements()).toHaveLength(0);
    await userEvent.click(page.getByRole("button", { name: new RegExp(nombres[0] ?? "") }));
    await userEvent.click(page.getByRole("button", { name: "Índice" }));
    await expect.element(page.getByRole("heading", { level: 2, name: "Índice" })).toBeVisible();
  });

  it("cambiar de página no apila entradas en el historial («Atrás» sale de la carta)", async () => {
    await abrir();
    const antes = window.history.length;
    await userEvent.click(page.getByRole("button", { name: "Siguiente" }));
    await userEvent.click(page.getByRole("button", { name: "Siguiente" }));
    expect(window.history.length).toBe(antes);
  });

  it("las flechas del teclado cambian de página y no salen de los extremos", async () => {
    await abrir();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(page.getByRole("heading", { level: 1, name: vista.nombre })).toBeVisible();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(page.getByRole("heading", { level: 2, name: "Índice" })).toBeVisible();
    await userEvent.keyboard("{End}");
    await expect.element(page.getByRole("button", { name: "Siguiente" })).toBeDisabled();
    await userEvent.keyboard("{Home}");
    await expect.element(page.getByRole("heading", { level: 1, name: vista.nombre })).toBeVisible();
  });

  it("un #ancla abre su sección; uno desconocido abre la portada", async () => {
    window.history.replaceState(null, "", `#${vista.secciones[2]?.id ?? ""}`);
    await render(<LibroDeVidriera vista={vista} textos={TEXTOS} />);
    await expect
      .element(page.getByRole("heading", { level: 2, name: nombres[2] ?? "" }))
      .toBeVisible();
  });

  it("un #ancla desconocido no rompe nada: portada", async () => {
    window.history.replaceState(null, "", "#no-existe-%E0%A4%A");
    await abrir();
  });

  it("sin accesibilidad rota en la portada, el índice y una sección", async () => {
    const pantalla = await abrir();
    expect(await violacionesDeAccesibilidad(pantalla.container)).toEqual([]);
    await userEvent.click(page.getByRole("button", { name: "Siguiente" }));
    expect(await violacionesDeAccesibilidad(pantalla.container)).toEqual([]);
    await userEvent.click(page.getByRole("button", { name: new RegExp(nombres[0] ?? "") }));
    expect(await violacionesDeAccesibilidad(pantalla.container)).toEqual([]);
  });
});
