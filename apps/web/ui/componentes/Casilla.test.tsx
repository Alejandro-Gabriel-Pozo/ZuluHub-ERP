import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { FormularioDeDatosDelMedio } from "../plantillas/caja/FormularioDeDatosDelMedio.cliente";
import { matrizDeEstados, verificarFoco, violacionesDeAccesibilidad } from "../pruebas/ayudas";

// La casilla se prueba dentro de su único consumidor (el formulario de los datos del cobro): una casilla suelta en una prueba necesitaría un dato propio en el registro (`campos-con-dato`).
const TEXTOS = { titulo: "Datos que se piden al cobrar", guardar: "Guardar" };
const formulario = (pide: boolean, puedeGuardar = true) => (
  <FormularioDeDatosDelMedio
    casillas={[{ dato: "cupon", etiqueta: "Cupón", pide }]}
    accion={() => Promise.resolve({ error: null })}
    textos={TEXTOS}
    puedeGuardar={puedeGuardar}
  />
);

describe("Casilla", () => {
  it("es un checkbox nativo con la etiqueta visible; tocar la casilla o su etiqueta cambia su estado", async () => {
    await render(formulario(false));
    const casilla = page.getByRole("checkbox", { name: "Cupón" });
    await expect.element(casilla).not.toBeChecked();
    await userEvent.click(casilla);
    await expect.element(casilla).toBeChecked();
    await userEvent.click(page.getByText("Cupón"));
    await expect.element(casilla).not.toBeChecked();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("marcada viaja con su nombre y valor; sin marcar no viaja; apagada no viaja", async () => {
    await render(formulario(true));
    const casilla = page.getByRole("checkbox", { name: "Cupón" });
    const datos = () =>
      new FormData(casilla.element().closest("form") as HTMLFormElement).getAll("datos");
    expect(datos()).toEqual(["cupon"]);
    await userEvent.click(casilla);
    expect(datos()).toEqual([]);
  });

  it("apagada no se puede tocar y no viaja", async () => {
    await render(formulario(true, false));
    const casilla = page.getByRole("checkbox", { name: "Cupón" });
    await expect.element(casilla).toBeDisabled();
    expect(
      new FormData(casilla.element().closest("form") as HTMLFormElement).getAll("datos"),
    ).toEqual([]);
  });
});

matrizDeEstados("Casilla", {
  normal: async () => {
    await render(formulario(false));
    await expect.element(page.getByRole("checkbox", { name: "Cupón" })).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
  foco: async () => {
    await render(formulario(false));
    await verificarFoco(page.getByRole("checkbox", { name: "Cupón" }).element() as HTMLElement);
  },
  cargando: {
    noAplica: "una casilla no carga por sí misma: el envío lo maneja el formulario que la contiene",
  },
  error: {
    noAplica:
      "una casilla solo marca o desmarca: no hay valor inválido; el rechazo del servidor sale en el formulario",
  },
  deshabilitado: async () => {
    await render(formulario(false, false));
    await expect.element(page.getByRole("checkbox", { name: "Cupón" })).toBeDisabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
});
