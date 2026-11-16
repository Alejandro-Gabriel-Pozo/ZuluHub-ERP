import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { matrizDeEstados, verificarFoco, violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { CampoDeCasilla } from "./CampoDeCasilla";

function Probado({ deshabilitado, inicial }: { deshabilitado?: boolean; inicial?: boolean }) {
  const [marcada, setMarcada] = useState(inicial ?? false);
  return (
    <form>
      <CampoDeCasilla
        dato="pendiente"
        etiqueta="De venta"
        nombre="deVenta"
        marcada={marcada}
        alCambiar={setMarcada}
        deshabilitado={deshabilitado ?? false}
      />
    </form>
  );
}

describe("CampoDeCasilla", () => {
  it("es una casilla nativa con su etiqueta, se marca y se desmarca", async () => {
    await render(<Probado />);
    const casilla = page.getByRole("checkbox", { name: "De venta" });
    expect(casilla.element().tagName).toBe("INPUT");
    await expect.element(casilla).not.toBeChecked();
    await userEvent.click(casilla);
    await expect.element(casilla).toBeChecked();
    await userEvent.click(casilla);
    await expect.element(casilla).not.toBeChecked();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el formulario la envía solo si está marcada", async () => {
    await render(<Probado inicial />);
    const formulario = page.getByRole("checkbox", { name: "De venta" }).element().closest("form");
    expect(new FormData(formulario as HTMLFormElement).get("deVenta")).toBe("on");
    await userEvent.click(page.getByRole("checkbox", { name: "De venta" }));
    expect(new FormData(formulario as HTMLFormElement).get("deVenta")).toBeNull();
  });
});

matrizDeEstados("CampoDeCasilla", {
  normal: async () => {
    await render(<Probado />);
    await expect.element(page.getByRole("checkbox", { name: "De venta" })).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
  foco: async () => {
    await render(<Probado />);
    await verificarFoco(page.getByRole("checkbox", { name: "De venta" }).element() as HTMLElement);
  },
  cargando: {
    noAplica:
      "una casilla no carga por sí misma: si su valor tarda, lo resuelve la pantalla que la arma",
  },
  error: {
    noAplica:
      "es un sí o no: no hay un valor que pueda venir mal; lo que el servidor rechaza sale en el formulario, debajo de los campos",
  },
  deshabilitado: async () => {
    await render(<Probado deshabilitado />);
    await expect.element(page.getByRole("checkbox", { name: "De venta" })).toBeDisabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
});
