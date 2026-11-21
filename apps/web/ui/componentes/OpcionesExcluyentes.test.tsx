import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { OpcionesExcluyentes } from "./OpcionesExcluyentes";

const OPCIONES = [
  { valor: "INCLUIDA", etiqueta: "Incluida" },
  { valor: "ADICIONAL", etiqueta: "Adicional" },
] as const;

function Probado({ apagado, inicial = "INCLUIDA" }: { apagado?: boolean; inicial?: string }) {
  const [valor, setValor] = useState(inicial);
  return (
    <form data-testid="formulario">
      <OpcionesExcluyentes
        dato="clase-de-grupo-de-opciones"
        nombre="clase"
        valor={valor}
        alCambiar={setValor}
        opciones={OPCIONES}
        apagado={apagado ?? false}
      />
    </form>
  );
}

const enviado = (): string | null =>
  new FormData(document.querySelector("form") as HTMLFormElement).get("clase") as string | null;

describe("OpcionesExcluyentes", () => {
  it("son botones de opción nativos lado a lado, con su texto visible y solo uno elegido", async () => {
    await render(<Probado />);
    const incluida = page.getByRole("radio", { name: "Incluida" });
    const adicional = page.getByRole("radio", { name: "Adicional" });
    expect(incluida.element().tagName).toBe("INPUT");
    await expect.element(page.getByText("Incluida")).toBeVisible();
    await expect.element(page.getByText("Adicional")).toBeVisible();
    await expect.element(incluida).toBeChecked();
    await expect.element(adicional).not.toBeChecked();
    const a = page.getByText("Incluida").element().getBoundingClientRect();
    const b = page.getByText("Adicional").element().getBoundingClientRect();
    expect(Math.abs(a.top - b.top)).toBeLessThan(1);
    expect(b.left).toBeGreaterThan(a.right - 1);
    expect(a.height).toBeGreaterThanOrEqual(44);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("elegir una desmarca la otra y el valor elegido viaja en el formulario", async () => {
    await render(<Probado />);
    expect(enviado()).toBe("INCLUIDA");
    await userEvent.click(page.getByRole("radio", { name: "Adicional" }));
    await expect.element(page.getByRole("radio", { name: "Adicional" })).toBeChecked();
    await expect.element(page.getByRole("radio", { name: "Incluida" })).not.toBeChecked();
    expect(enviado()).toBe("ADICIONAL");
  });

  it("se maneja con el teclado: foco en el elegido y flechas para cambiar", async () => {
    await render(<Probado />);
    await userEvent.tab();
    expect(document.activeElement).toBe(page.getByRole("radio", { name: "Incluida" }).element());
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(page.getByRole("radio", { name: "Adicional" })).toBeChecked();
    expect(enviado()).toBe("ADICIONAL");
  });

  it("apagado: se ve con su valor, no se puede cambiar y el valor viaja igual", async () => {
    await render(<Probado apagado inicial="ADICIONAL" />);
    const adicional = page.getByRole("radio", { name: "Adicional" });
    const incluida = page.getByRole("radio", { name: "Incluida" });
    await expect.element(adicional).toBeChecked();
    await expect.element(adicional).toBeDisabled();
    await expect.element(incluida).toBeDisabled();
    expect(enviado()).toBe("ADICIONAL");
    expect(document.querySelectorAll('input[name="clase"]').length).toBe(1);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});
