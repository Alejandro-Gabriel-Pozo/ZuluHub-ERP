import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { matrizDeEstados, verificarFoco, violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { AreaDeTexto } from "./AreaDeTexto";

// Dato de prueba provisorio: el textarea real usa el dato «nota» que registra Compras PR-2b; al llegar, este test pasa a ese dato y se quita este consumidor.
function Controlado(props: { error?: string; deshabilitado?: boolean; nombre?: string }) {
  const [valor, setValor] = useState("");
  return (
    <AreaDeTexto
      etiqueta="Nota"
      valor={valor}
      alCambiar={setValor}
      {...props}
      dato="domicilio-libre"
    />
  );
}

describe("AreaDeTexto", () => {
  it("la etiqueta es visible y nombra al campo; admite más de una línea", async () => {
    await render(<Controlado />);
    await expect.element(page.getByText("Nota")).toBeVisible();
    const campo = page.getByLabelText("Nota");
    await userEvent.type(campo, "Una{Enter}Dos");
    await expect.element(campo).toHaveValue("Una\nDos");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el error se asocia por ARIA, se marca inválido y se ve", async () => {
    await render(<Controlado error="La nota es demasiado larga." />);
    const campo = page.getByRole("textbox", { name: "Nota" });
    await expect.element(campo).toHaveAttribute("aria-invalid", "true");
    await expect.element(campo).toHaveAccessibleDescription("La nota es demasiado larga.");
    await expect.element(page.getByText("La nota es demasiado larga.")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("deshabilitado no deja escribir", async () => {
    await render(<Controlado deshabilitado />);
    const campo = page.getByLabelText("Nota");
    await expect.element(campo).toBeDisabled();
    await expect.element(campo).toHaveValue("");
  });

  it("con nombre el textarea lleva ese name; sin nombre, ninguno", async () => {
    await render(<Controlado nombre="nota" />);
    await expect.element(page.getByLabelText("Nota")).toHaveAttribute("name", "nota");
  });

  it("sin nombre no lleva name", async () => {
    await render(<Controlado />);
    await expect.element(page.getByLabelText("Nota")).not.toHaveAttribute("name");
  });
});

matrizDeEstados("AreaDeTexto", {
  normal: async () => {
    await render(<Controlado />);
    const campo = page.getByLabelText("Nota");
    await expect.element(campo).toBeEnabled();
    await expect.element(campo).not.toHaveAttribute("aria-invalid");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
  foco: async () => {
    await render(<Controlado />);
    await verificarFoco(page.getByLabelText("Nota").element() as HTMLElement);
  },
  cargando: {
    noAplica:
      "un campo no carga por sí mismo: mientras se envía lo bloquea el formulario que lo contiene",
  },
  error: async () => {
    await render(<Controlado error="Falta la nota." />);
    const campo = page.getByRole("textbox", { name: "Nota" });
    await expect.element(campo).toBeInvalid();
    await expect.element(campo).toHaveAccessibleDescription("Falta la nota.");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
  deshabilitado: async () => {
    await render(<Controlado deshabilitado />);
    await expect.element(page.getByLabelText("Nota")).toBeDisabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
});
