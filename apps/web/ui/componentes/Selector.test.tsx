import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { matrizDeEstados, verificarFoco, violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { Selector } from "./Selector";

const opciones = [
  { valor: "efectivo", etiqueta: "Efectivo" },
  { valor: "tarjeta", etiqueta: "Tarjeta" },
] as const;

function Probado({ error, deshabilitado }: { error?: string; deshabilitado?: boolean }) {
  const [valor, setValor] = useState("");
  return (
    <Selector
      etiqueta="Medio de pago"
      valor={valor}
      alCambiar={setValor}
      opciones={opciones}
      textoDeElegir="Elegí un medio"
      error={error}
      deshabilitado={deshabilitado ?? false}
    />
  );
}

describe("Selector", () => {
  it("es un <select> nativo con etiqueta, opciones y la opción de elegir", async () => {
    await render(<Probado />);
    const selector = page.getByRole("combobox", { name: "Medio de pago" });
    expect(selector.element().tagName).toBe("SELECT");
    await userEvent.selectOptions(selector, "tarjeta");
    await expect.element(selector).toHaveValue("tarjeta");
    await expect.element(selector).toMatchAriaInlineSnapshot(`- combobox "Medio de pago"`);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el error queda asociado", async () => {
    await render(<Probado error="Elegí un medio de pago." />);
    const selector = page.getByRole("combobox", { name: "Medio de pago" });
    await expect.element(selector).toBeInvalid();
    await expect.element(selector).toHaveAccessibleDescription("Elegí un medio de pago.");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin texto de elegir, no ofrece una opción vacía", async () => {
    await render(
      <Selector
        etiqueta="Medio"
        valor="efectivo"
        alCambiar={() => undefined}
        opciones={opciones}
      />,
    );
    expect(page.getByRole("combobox").element().querySelectorAll("option")).toHaveLength(2);
  });
});

matrizDeEstados("Selector", {
  normal: async () => {
    await render(<Probado />);
    const selector = page.getByRole("combobox", { name: "Medio de pago" });
    await expect.element(selector).toBeEnabled();
    await expect.element(selector).not.toHaveAttribute("aria-invalid");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
  foco: async () => {
    await render(<Probado />);
    await verificarFoco(
      page.getByRole("combobox", { name: "Medio de pago" }).element() as HTMLElement,
    );
  },
  cargando: {
    noAplica:
      "un selector nativo no carga por sí mismo: si sus opciones tardan, lo resuelve la pantalla que lo arma",
  },
  error: async () => {
    await render(<Probado error="Elegí un medio de pago." />);
    const selector = page.getByRole("combobox", { name: "Medio de pago" });
    await expect.element(selector).toBeInvalid();
    await expect.element(selector).toHaveAccessibleDescription("Elegí un medio de pago.");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
  deshabilitado: async () => {
    await render(<Probado deshabilitado />);
    await expect.element(page.getByRole("combobox", { name: "Medio de pago" })).toBeDisabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
});
