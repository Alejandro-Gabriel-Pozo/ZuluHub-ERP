import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { RegionDeEstado } from "./RegionDeEstado";

describe("RegionDeEstado", () => {
  it("está siempre en el árbol, aunque vacía, y se anuncia de a poco (polite)", async () => {
    const { rerender } = await render(<RegionDeEstado />);
    const region = page.getByRole("status");
    await expect.element(region).toHaveAttribute("aria-live", "polite");
    await expect.element(region).toHaveAttribute("aria-atomic", "true");
    await rerender(<RegionDeEstado>Venta registrada.</RegionDeEstado>);
    await expect.element(region).toHaveTextContent("Venta registrada.");
    await expect.element(region).toMatchAriaInlineSnapshot(`- status: Venta registrada.`);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("lo asertivo es una alerta", async () => {
    await render(<RegionDeEstado urgencia="asertivo">No se pudo cobrar.</RegionDeEstado>);
    const alerta = page.getByRole("alert");
    await expect.element(alerta).toHaveAttribute("aria-live", "assertive");
    await expect.element(alerta).toMatchAriaInlineSnapshot(`- alert: No se pudo cobrar.`);
  });

  it("ocupada se anuncia como aria-busy", async () => {
    await render(<RegionDeEstado ocupada>Enviando…</RegionDeEstado>);
    await expect.element(page.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it("solo para lector: no se ve pero se lee", async () => {
    await render(<RegionDeEstado visible={false}>Guardado</RegionDeEstado>);
    const region = page.getByRole("status");
    expect(region.element().getBoundingClientRect().width).toBeLessThanOrEqual(1);
    await expect.element(region).toHaveTextContent("Guardado");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});
