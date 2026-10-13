import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { tocar, violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { Boton } from "./Boton";

describe("Boton", () => {
  it.each(["primaria", "secundaria", "peligro"] as const)(
    "la variante %s no tiene violaciones de accesibilidad (contraste incluido)",
    async (variante) => {
      await render(<Boton variante={variante}>Cobrar $ 12.345,00</Boton>);
      expect(await violacionesDeAccesibilidad()).toEqual([]);
    },
  );

  it("deshabilitado con motivo: el motivo se ve, describe al botón y no se puede tocar", async () => {
    const alTocar = vi.fn();
    await render(
      <Boton deshabilitado motivo="No se puede enviar sin conexión." alTocar={alTocar}>
        Cobrar
      </Boton>,
    );
    const boton = page.getByRole("button", { name: "Cobrar" });
    await expect.element(boton).toBeDisabled();
    await expect.element(boton).toHaveAccessibleDescription("No se puede enviar sin conexión.");
    await expect.element(page.getByText("No se puede enviar sin conexión.")).toBeVisible();
    expect(alTocar).not.toHaveBeenCalled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("enviando: dice el texto de envío, se anuncia ocupado, conserva el foco y no repite el toque", async () => {
    const alTocar = vi.fn();
    const { rerender } = await render(
      <Boton alTocar={alTocar} textoEnviando="Enviando…">
        Cobrar
      </Boton>,
    );
    const boton = page.getByRole("button", { name: "Cobrar" });
    await userEvent.click(boton);
    expect(alTocar).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(boton.element());

    await rerender(
      <Boton alTocar={alTocar} enviando textoEnviando="Enviando…">
        Cobrar
      </Boton>,
    );
    const enviando = page.getByRole("button", { name: "Enviando…" });
    await expect.element(enviando).toHaveAttribute("aria-busy", "true");
    await expect.element(enviando).toHaveAttribute("aria-disabled", "true");
    // No es `disabled`: un botón deshabilitado pierde el foco y el lector deja de anunciarlo.
    expect(enviando.element().hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(enviando.element());
    // Playwright no actúa sobre lo `aria-disabled`; el click del DOM es el de un dedo que llega tarde.
    tocar(enviando);
    expect(alTocar).toHaveBeenCalledTimes(1);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el toque por teclado funciona (Enter y espacio)", async () => {
    const alTocar = vi.fn();
    await render(<Boton alTocar={alTocar}>Aceptar</Boton>);
    page.getByRole("button", { name: "Aceptar" }).element().focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(alTocar).toHaveBeenCalledTimes(2);
  });

  it("el área táctil de operación llega al mínimo de 48 px", async () => {
    await render(<Boton>OK</Boton>);
    const caja = page.getByRole("button", { name: "OK" }).element().getBoundingClientRect();
    expect(caja.height).toBeGreaterThanOrEqual(48);
    expect(caja.width).toBeGreaterThanOrEqual(48);
  });

  it("aria snapshot", async () => {
    await render(<Boton motivo="Porque sí">Cobrar</Boton>);
    await expect.element(page.getByRole("button")).toMatchAriaInlineSnapshot(`- button "Cobrar"`);
  });
});
