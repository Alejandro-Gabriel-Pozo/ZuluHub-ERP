import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { Boton } from "../componentes/Boton";
import { violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { ErrorConReferencia } from "./ErrorConReferencia";
import { PorQueNoPuedo } from "./PorQueNoPuedo";

describe("PorQueNoPuedo", () => {
  it("muestra el texto ya resuelto con el código al lado; sin violaciones y con su snapshot", async () => {
    await render(
      <PorQueNoPuedo
        id="porque"
        texto="Esta función no está activada para la empresa."
        codigo="MODULO_NO_ACTIVO"
        textoDeReferencia="Referencia: PD-8F3K2"
        accion={<Boton variante="secundaria">Pedirlo al gerente</Boton>}
      />,
    );
    await expect.element(page.getByText("MODULO_NO_ACTIVO")).toBeVisible();
    await expect.element(page.getByText(/Referencia: PD-8F3K2/)).toBeVisible();
    await expect.element(page.getByRole("status")).toMatchAriaInlineSnapshot(`
      - status:
        - paragraph: Esta función no está activada para la empresa.
        - paragraph:
          - code: MODULO_NO_ACTIVO
          - text: "· Referencia: PD-8F3K2"
        - button "Pedirlo al gerente"
    `);
    expect(document.getElementById("porque")).not.toBeNull();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin referencia no la inventa", async () => {
    const { container } = await render(
      <PorQueNoPuedo texto="No tiene permiso." codigo="SIN_PERMISO" />,
    );
    expect(container.textContent).toBe("No tiene permiso.SIN_PERMISO");
  });

  it("puede explicar a un control deshabilitado por aria-describedby", async () => {
    await render(
      <>
        <button type="button" disabled aria-describedby="porque">
          Anular
        </button>
        <PorQueNoPuedo id="porque" texto="No tiene permiso para hacer esto." codigo="SIN_PERMISO" />
      </>,
    );
    await expect
      .element(page.getByRole("button", { name: "Anular" }))
      .toHaveAccessibleDescription("No tiene permiso para hacer esto. SIN_PERMISO");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});

describe("ErrorConReferencia", () => {
  it("alerta con el texto, el código y la referencia PD; sin violaciones y con su snapshot", async () => {
    await render(
      <ErrorConReferencia
        texto="No se pudo completar. Podés reintentar: es seguro, no se duplica."
        codigo="INESPERADO"
        textoDeReferencia="Referencia: PD-A1B2C3"
        accion={<Boton>Reintentar</Boton>}
      />,
    );
    await expect.element(page.getByRole("alert")).toMatchAriaInlineSnapshot(`
      - alert:
        - paragraph: "No se pudo completar. Podés reintentar: es seguro, no se duplica."
        - paragraph:
          - code: INESPERADO
          - text: "· Referencia: PD-A1B2C3"
        - button "Reintentar"
    `);
    await expect.element(page.getByText(/PD-A1B2C3/)).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin código muestra solo el texto y la referencia", async () => {
    const { container } = await render(
      <ErrorConReferencia texto="No se pudo completar." textoDeReferencia="Referencia: PD-1" />,
    );
    expect(container.textContent).toBe("No se pudo completar.Referencia: PD-1");
  });
});
