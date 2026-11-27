import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { VistaDeVidriera } from "../../../../../src/capacidades/experiencia/vidriera/vista";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { PlantillaDeVidriera } from "./PlantillaDeVidriera.cliente";
import { TEXTOS, vidrieraDePrueba } from "./datosDePrueba";

const URL_INICIAL = window.location.href;

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", URL_INICIAL);
  Reflect.deleteProperty(navigator, "connection");
});

function entorno(
  opciones: { ms?: number; saveData?: boolean; tipo?: string; reducido?: boolean } = {},
) {
  const { ms = 400, saveData = false, tipo = "4g", reducido = false } = opciones;
  vi.spyOn(performance, "now").mockReturnValue(ms);
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    value: { saveData, effectiveType: tipo },
  });
  const original = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((consulta: string) =>
    consulta.includes("prefers-reduced-motion")
      ? ({ ...original("(min-width: 0px)"), matches: reducido, media: consulta } as MediaQueryList)
      : original(consulta),
  );
}

const libro = (): VistaDeVidriera => vidrieraDePrueba({ modelo: "LIBRO", cantidad: 12 });

async function abrir(vista: VistaDeVidriera = libro()) {
  await render(<PlantillaDeVidriera vista={vista} textos={TEXTOS} />);
}

const contador = () => document.querySelector('[role="status"]')?.textContent ?? "";

describe("PlantillaLibro (modelo Libro sobre la Lista)", () => {
  it("con el modelo Lista no monta el Libro ni ofrece cambiar", async () => {
    entorno();
    await abrir(vidrieraDePrueba({ modelo: "LISTA", cantidad: 12 }));
    await expect.element(page.getByRole("button", { name: "Letra normal" })).toBeVisible();
    expect(page.getByRole("button", { name: "Anterior" }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Ver como libro" }).elements()).toHaveLength(0);
  });

  it("con modelo Libro y buen entorno monta el Libro: portada, índice y contador único", async () => {
    entorno();
    await abrir();
    await expect.element(page.getByText("Desliza para ver el menú")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Anterior" })).toBeDisabled();
    expect(contador()).toBe("");
    await userEvent.click(page.getByRole("button", { name: "Siguiente" }));
    await expect.element(page.getByRole("heading", { name: "Índice" })).toBeVisible();
    expect(contador()).toBe("");
    await userEvent.click(page.getByRole("link", { name: /^Infusiones/ }));
    await vi.waitFor(() => {
      expect(contador()).toBe("Sección 2 de 6");
    });
    expect(document.activeElement?.id).toBe("infusiones");
  });

  it("Siguiente, Anterior, ÍNDICE y las flechas del teclado pasan de página", async () => {
    entorno();
    await abrir();
    await userEvent.click(page.getByRole("button", { name: "Siguiente" }));
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => {
      expect(contador()).toBe("Sección 1 de 6");
    });
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => {
      expect(contador()).toBe("Sección 2 de 6");
    });
    await userEvent.keyboard("{ArrowLeft}");
    await vi.waitFor(() => {
      expect(contador()).toBe("Sección 1 de 6");
    });
    await userEvent.click(page.getByRole("button", { name: "Anterior" }));
    await expect.element(page.getByRole("heading", { name: "Índice" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Siguiente" }));
    await userEvent.click(page.getByRole("button", { name: "Índice" }));
    await vi.waitFor(() => {
      expect(contador()).toBe("");
    });
  });

  it("en la última sección «Siguiente» queda sin uso", async () => {
    entorno();
    await abrir();
    await userEvent.click(page.getByRole("button", { name: "Siguiente" }));
    for (let i = 0; i < 6; i += 1) await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => {
      expect(contador()).toBe("Sección 6 de 6");
    });
    await expect.element(page.getByRole("button", { name: "Siguiente" })).toBeDisabled();
  });

  it("`#slug` abre esa sección y deja el foco en su título", async () => {
    entorno();
    window.history.replaceState(null, "", "#salados");
    await abrir();
    await vi.waitFor(() => {
      expect(contador()).toBe("Sección 5 de 6");
    });
    expect(document.activeElement?.id).toBe("salados");
  });

  it("un `#slug` que no existe deja la portada", async () => {
    entorno();
    window.history.replaceState(null, "", "#no-existe");
    await abrir();
    await expect.element(page.getByText("Desliza para ver el menú")).toBeVisible();
  });

  it("«Ver como lista» y «Ver como libro» alternan sin guardar nada", async () => {
    entorno();
    await abrir();
    await userEvent.click(page.getByRole("button", { name: "Ver como lista" }));
    await expect.element(page.getByRole("button", { name: "Ver como libro" })).toBeVisible();
    expect(page.getByRole("button", { name: "Anterior" }).elements()).toHaveLength(0);
    await userEvent.click(page.getByRole("button", { name: "Ver como libro" }));
    await expect.element(page.getByText("Desliza para ver el menú")).toBeVisible();
    expect(window.localStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });

  it.each([
    ["el script tardó más de 2,5 s", { ms: 2501 }],
    ["hay ahorro de datos", { saveData: true }],
    ["la red es 2g", { tipo: "2g" }],
    ["la red es slow-2g", { tipo: "slow-2g" }],
    ["se pidió movimiento reducido", { reducido: true }],
  ])("cuando %s se queda en Lista y ofrece «Ver como libro»", async (_motivo, opciones) => {
    entorno(opciones);
    await abrir();
    await expect.element(page.getByRole("button", { name: "Ver como libro" })).toBeVisible();
    expect(page.getByRole("button", { name: "Anterior" }).elements()).toHaveLength(0);
    // Lo que se ve es la Lista de siempre, con su índice de anclas.
    expect(document.querySelector("#pd-indice")).not.toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Ver como libro" }));
    await expect.element(page.getByText("Desliza para ver el menú")).toBeVisible();
  });

  it("sin violaciones de axe en la portada, el índice y una sección", async () => {
    entorno();
    await abrir();
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await userEvent.click(page.getByRole("button", { name: "Siguiente" }));
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await userEvent.click(page.getByRole("link", { name: /^Cafés/ }));
    await vi.waitFor(() => {
      expect(contador()).toBe("Sección 1 de 6");
    });
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });

  it("los controles miden 48 px o más", async () => {
    entorno();
    await abrir();
    for (const nombre of ["Anterior", "Índice", "Siguiente"]) {
      const caja = (
        await page.getByRole("button", { name: nombre }).element()
      ).getBoundingClientRect();
      expect(caja.width, nombre).toBeGreaterThanOrEqual(48);
      expect(caja.height, nombre).toBeGreaterThanOrEqual(48);
    }
  });
});
