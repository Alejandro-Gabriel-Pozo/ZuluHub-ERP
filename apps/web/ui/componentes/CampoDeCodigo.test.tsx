import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { matrizDeEstados, verificarFoco, violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { CampoDeCodigo } from "./CampoDeCodigo";

function Controlado(props: { error?: string; ayuda?: string; deshabilitado?: boolean }) {
  const [valor, setValor] = useState("");
  return <CampoDeCodigo etiqueta="Código" valor={valor} alCambiar={setValor} {...props} />;
}

describe("CampoDeCodigo", () => {
  it("solo deja dígitos y corta en seis", async () => {
    await render(<Controlado />);
    const campo = page.getByLabelText("Código");
    await userEvent.type(campo, "12a3 45678");
    await expect.element(campo).toHaveValue("123456");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("un código pegado entero con espacios queda en dígitos", async () => {
    await render(<Controlado />);
    const campo = page.getByLabelText("Código");
    await userEvent.fill(campo, "123 456");
    await expect.element(campo).toHaveValue("123456");
  });

  it("pide el teclado numérico y ofrece el código recibido por mensaje", async () => {
    await render(<Controlado />);
    const campo = page.getByLabelText("Código");
    await expect.element(campo).toHaveAttribute("inputmode", "numeric");
    await expect.element(campo).toHaveAttribute("autocomplete", "one-time-code");
  });

  it("alcanza el objetivo mínimo de 48 px de alto", async () => {
    await render(<Controlado />);
    expect(
      page.getByLabelText("Código").element().getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(48);
  });
});

matrizDeEstados("CampoDeCodigo", {
  normal: async () => {
    await render(<Controlado />);
    const campo = page.getByLabelText("Código");
    await expect.element(campo).toBeEnabled();
    await expect.element(campo).not.toHaveAttribute("aria-invalid");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
  foco: async () => {
    await render(<Controlado />);
    await verificarFoco(page.getByLabelText("Código").element() as HTMLElement);
  },
  cargando: {
    noAplica:
      "el campo no carga por sí mismo: mientras se verifica lo bloquea la pantalla que lo contiene",
  },
  error: async () => {
    await render(<Controlado error="No pudimos iniciar sesión." />);
    const campo = page.getByRole("textbox", { name: "Código" });
    await expect.element(campo).toBeInvalid();
    await expect.element(campo).toHaveAccessibleDescription("No pudimos iniciar sesión.");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
  deshabilitado: async () => {
    await render(<Controlado deshabilitado />);
    await expect.element(page.getByLabelText("Código")).toBeDisabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
});
