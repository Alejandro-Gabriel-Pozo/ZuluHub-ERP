import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import {
  reglaDePaginaAdoptada,
  reglasAdoptadas,
} from "../../plantillas/facturacion/impresion/ayudas-de-impresion";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { PapelParaImprimir } from "./hoja-del-papel";
import { PapelImpreso } from "./PapelImpreso.cliente";

/**
 * El papel en Chromium real: ancho exacto de la impresora (58 y 80 mm), la línea más larga (32 y 48 columnas) entra sin cortarse, `@page` con el ancho y el alto medido en una hoja ADOPTADA (nunca un `<style>` ni un
 * atributo `style=`: la CSP los bloquea), «solo la hoja» al imprimir, avisa una sola vez cuando está listo y suelta su regla al desmontarse. Previene: papel que sale con el tamaño del navegador o con la pantalla entera.
 */
const MM = 96 / 25.4;
const papel = (ancho: number, columnas: number): PapelParaImprimir => ({
  ancho,
  lineas: [
    { texto: "COMANDA", estilo: "NEGRITA" },
    { texto: "MESA 5", estilo: "GRANDE" },
    { texto: "", estilo: "SEPARADOR" },
    { texto: "0".repeat(columnas), estilo: "NORMAL" },
  ],
});

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("PapelImpreso", () => {
  for (const [ancho, columnas] of [
    [58, 32],
    [80, 48],
  ] as const) {
    it(`${String(ancho)} mm: ancho exacto, ${String(columnas)} columnas sin cortarse y @page con el ancho y el alto medido`, async () => {
      await page.viewport(1280, 800);
      await render(<PapelImpreso papel={papel(ancho, columnas)} />);
      const hoja = document.querySelector<HTMLElement>("[data-papel]");
      expect(hoja).not.toBeNull();
      await vi.waitFor(() =>
        expect(reglaDePaginaAdoptada()).toMatch(new RegExp(`size: ${String(ancho)}mm \\d+mm`)),
      );
      expect(Math.abs((hoja?.getBoundingClientRect().width ?? 0) - ancho * MM)).toBeLessThan(1);
      const larga = [...document.querySelectorAll("p")].find(
        (p) => p.textContent === "0".repeat(columnas),
      );
      expect(larga).toBeDefined();
      // No se corta ni se parte en dos renglones: entra en una línea.
      expect((larga?.getBoundingClientRect().height ?? 99) < 20).toBe(true);
      expect(larga?.scrollWidth).toBeLessThanOrEqual((larga?.clientWidth ?? 0) + 1);
      // El alto de la regla cubre el alto real de la hoja.
      const alto = Number(/size: \d+mm (\d+)mm/.exec(reglaDePaginaAdoptada())?.[1]);
      expect(alto * MM).toBeGreaterThanOrEqual((hoja?.offsetHeight ?? 0) - 1);
    });
  }

  it("la hoja se imprime sola: la regla «solo la hoja» está adoptada y el HTML del servidor no trae estilos en línea (la CSP real los bloquea)", async () => {
    await render(<PapelImpreso papel={papel(80, 48)} />);
    await vi.waitFor(() => expect(reglasAdoptadas()).toContain("data-zona-de-impresion"));
    expect(document.querySelector("[data-zona-de-impresion]")).not.toBeNull();
    const html = renderToStaticMarkup(<PapelImpreso papel={papel(80, 48)} />);
    expect(html).not.toMatch(/<[a-z][^>]*?\sstyle\s*=/i);
    expect(html).not.toMatch(/<style\b/i);
  });

  it("avisa UNA vez que está listo, con la regla de página ya adoptada", async () => {
    const reglas: string[] = [];
    const listo = vi.fn(() => reglas.push(reglaDePaginaAdoptada()));
    const { rerender } = await render(<PapelImpreso papel={papel(80, 48)} alEstarListo={listo} />);
    await vi.waitFor(() => expect(listo).toHaveBeenCalledTimes(1));
    expect(reglas[0]).toMatch(/size: 80mm/);
    await rerender(<PapelImpreso papel={papel(80, 48)} alEstarListo={listo} />);
    expect(listo).toHaveBeenCalledTimes(1);
  });

  it("al desmontarse suelta su regla de página (una @page de 58 mm no queda pegada)", async () => {
    const { unmount } = await render(<PapelImpreso papel={papel(58, 32)} />);
    await vi.waitFor(() => expect(reglaDePaginaAdoptada()).toMatch(/58mm/));
    await unmount();
    expect(reglaDePaginaAdoptada()).toBe("");
  });

  it("axe sin violaciones", async () => {
    await render(<PapelImpreso papel={papel(80, 48)} />);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});
