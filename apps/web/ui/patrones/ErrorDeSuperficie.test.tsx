import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { bytesDeDigest } from "../../../../src/capacidades/experiencia/referencia-web";
import { referenciaDeError } from "../../../../src/plataforma/dominio/referencia";
import { violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { ErrorDeSuperficie } from "./ErrorDeSuperficie.cliente";

describe("ErrorDeSuperficie (el 500)", () => {
  it("texto genérico, referencia ZH derivada del digest y «Reintentar»; sin violaciones", async () => {
    const error = Object.assign(new Error("password authentication failed for user zuluhub_app"), {
      digest: "2581439760",
    });
    const reset = vi.fn();
    const { container } = await render(<ErrorDeSuperficie error={error} reset={reset} />);
    const referencia = referenciaDeError(bytesDeDigest("2581439760"));
    await expect.element(page.getByText(`Referencia: ${referencia}`)).toBeVisible();
    await expect.element(page.getByText(/No se pudo completar/)).toBeVisible();
    // Nada interno: ni el mensaje del error, ni su nombre, ni su pila, ni el digest crudo.
    expect(container.textContent).not.toContain("password");
    expect(container.textContent).not.toContain("zuluhub_app");
    expect(container.textContent).not.toContain("2581439760");
    expect(container.textContent).not.toContain("Error:");
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await userEvent.click(page.getByRole("button", { name: "Reintentar" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("la misma falla da siempre la misma referencia, y otra distinta", async () => {
    expect(referenciaDeError(bytesDeDigest("1"))).toBe(referenciaDeError(bytesDeDigest("1")));
    expect(referenciaDeError(bytesDeDigest("1"))).not.toBe(referenciaDeError(bytesDeDigest("2")));
    expect(referenciaDeError(bytesDeDigest("1"))).toMatch(/^ZH-[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it("sin digest no inventa una referencia", async () => {
    const { container } = await render(
      <ErrorDeSuperficie error={new Error("x")} reset={() => undefined} />,
    );
    expect(container.textContent).not.toContain("ZH-");
    expect(container.textContent).not.toContain("Referencia");
    await expect.element(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
  });
});
