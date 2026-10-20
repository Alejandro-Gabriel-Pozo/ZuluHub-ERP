import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { matrizDeEstados, verificarFoco, violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { BotonIcono } from "./BotonIcono";

describe("BotonIcono", () => {
  it("su nombre accesible es la etiqueta y el ícono es adorno", async () => {
    await render(<BotonIcono etiqueta="Cerrar" icono="cerrar" />);
    const boton = page.getByRole("button", { name: "Cerrar" });
    await expect.element(boton).toHaveAccessibleName("Cerrar");
    await expect.element(boton).toMatchAriaInlineSnapshot(`- button "Cerrar"`);
    expect(boton.element().querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin etiqueta no compila (P-8)", () => {
    // @ts-expect-error la etiqueta accesible es obligatoria: sin ella el botón no tiene nombre
    const sinEtiqueta = <BotonIcono icono="cerrar" />;
    expect(sinEtiqueta).toBeDefined();
    // @ts-expect-error una clave de ícono que no está en el catálogo tampoco compila
    const inventado = <BotonIcono etiqueta="X" icono="no-existe" />;
    expect(inventado).toBeDefined();
  });

  it("se toca y su área llega a 48 x 48 px", async () => {
    const alTocar = vi.fn();
    await render(<BotonIcono etiqueta="Cerrar" icono="cerrar" alTocar={alTocar} />);
    const boton = page.getByRole("button", { name: "Cerrar" });
    await userEvent.click(boton);
    expect(alTocar).toHaveBeenCalledTimes(1);
    const caja = boton.element().getBoundingClientRect();
    expect(caja.width).toBeGreaterThanOrEqual(48);
    expect(caja.height).toBeGreaterThanOrEqual(48);
  });

  it("deshabilitado no se toca", async () => {
    const alTocar = vi.fn();
    await render(<BotonIcono etiqueta="Cerrar" icono="cerrar" alTocar={alTocar} deshabilitado />);
    await expect.element(page.getByRole("button", { name: "Cerrar" })).toBeDisabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});

matrizDeEstados("BotonIcono", {
  normal: async () => {
    await render(<BotonIcono etiqueta="Cerrar" icono="cerrar" />);
    await expect.element(page.getByRole("button", { name: "Cerrar" })).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
  foco: async () => {
    await render(<BotonIcono etiqueta="Cerrar" icono="cerrar" />);
    await verificarFoco(page.getByRole("button", { name: "Cerrar" }).element() as HTMLElement);
  },
  cargando: {
    noAplica:
      "un botón de solo ícono no envía nada: quien envía usa Boton, que sí tiene estado de carga",
  },
  error: {
    noAplica: "un botón de solo ícono no tiene error propio: el error lo muestra quien lo contiene",
  },
  deshabilitado: async () => {
    await render(<BotonIcono etiqueta="Cerrar" icono="cerrar" deshabilitado />);
    await expect.element(page.getByRole("button", { name: "Cerrar" })).toBeDisabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
});
