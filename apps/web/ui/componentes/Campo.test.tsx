import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { Campo } from "./Campo";

function Controlado(props: { error?: string; ayuda?: string; obligatorio?: string }) {
  const [valor, setValor] = useState("");
  return <Campo etiqueta="Nombre" valor={valor} alCambiar={setValor} {...props} />;
}

describe("Campo", () => {
  it("la etiqueta es visible y nombra al campo; se puede tipear", async () => {
    await render(<Controlado />);
    await expect.element(page.getByText("Nombre")).toBeVisible();
    const campo = page.getByLabelText("Nombre");
    await userEvent.type(campo, "Ana");
    await expect.element(campo).toHaveValue("Ana");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el error se asocia por ARIA, se marca inválido y trae ícono además del color", async () => {
    await render(<Controlado error="Falta el nombre." ayuda="Como figura en el documento." />);
    const campo = page.getByRole("textbox", { name: "Nombre" });
    await expect.element(campo).toBeInvalid();
    await expect.element(campo).toHaveAttribute("aria-invalid", "true");
    await expect
      .element(campo)
      .toHaveAccessibleDescription("Como figura en el documento. Falta el nombre.");
    await expect.element(page.getByText("Falta el nombre.")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await expect.element(campo).toMatchAriaInlineSnapshot(`- textbox "Nombre"`);
  });

  it("lo obligatorio se marca con texto, no solo con un asterisco", async () => {
    await render(<Controlado obligatorio="obligatorio" />);
    const campo = page.getByRole("textbox", { name: "Nombre (obligatorio)" });
    await expect.element(campo).toHaveAttribute("aria-required", "true");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin error no se marca inválido", async () => {
    await render(<Controlado />);
    await expect.element(page.getByLabelText("Nombre")).not.toHaveAttribute("aria-invalid");
  });

  it("alcanza el objetivo mínimo de 48 px de alto", async () => {
    await render(<Controlado />);
    expect(
      page.getByLabelText("Nombre").element().getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(48);
  });
});
