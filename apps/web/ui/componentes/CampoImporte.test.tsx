import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { CampoImporte } from "./CampoImporte";

/** Registra todo lo que el campo entrega a quien lo usa: el contrato es que SIEMPRE es texto. */
function Probado({
  inicial = "",
  alEntregar,
}: {
  inicial?: string;
  alEntregar?: (v: unknown) => void;
}) {
  const [valor, setValor] = useState(inicial);
  return (
    <>
      <CampoImporte
        etiqueta="Importe"
        nombre="importe"
        valor={valor}
        alCambiar={(v) => {
          alEntregar?.(v);
          setValor(v);
        }}
      />
      <button type="button" onClick={() => setValor("")}>
        Limpiar
      </button>
      <output data-testid="valor">{valor}</output>
    </>
  );
}

describe("CampoImporte", () => {
  it("entrega TEXTO decimal canónico, nunca un number, mientras se tipea con coma", async () => {
    const entregados: unknown[] = [];
    await render(<Probado alEntregar={(v) => entregados.push(v)} />);
    await userEvent.type(page.getByLabelText("Importe"), "1234,5");
    expect(entregados.length).toBeGreaterThan(0);
    for (const v of entregados) expect(typeof v).toBe("string");
    expect(entregados.at(-1)).toBe("1234.50");
    await expect.element(page.getByTestId("valor")).toHaveTextContent("1234.50");
  });

  it("pide teclado decimal y no autocompleta", async () => {
    await render(<Probado />);
    const campo = page.getByLabelText("Importe");
    await expect.element(campo).toHaveAttribute("inputmode", "decimal");
    await expect.element(campo).toHaveAttribute("autocomplete", "off");
    await expect.element(campo).toHaveAttribute("type", "text");
  });

  it("limpia lo que no es importe y respeta los decimales de la moneda", async () => {
    const alEntregar = vi.fn();
    await render(<Probado alEntregar={alEntregar} />);
    await userEvent.type(page.getByLabelText("Importe"), "ab$-1x2,345");
    await expect.element(page.getByLabelText("Importe")).toHaveValue("12,34");
    expect(alEntregar).toHaveBeenLastCalledWith("12.34");
  });

  it("al salir muestra los miles con punto; al volver, los saca para editar", async () => {
    await render(<Probado />);
    const campo = page.getByLabelText("Importe");
    await userEvent.type(campo, "1234567,8");
    await userEvent.tab();
    await expect.element(campo).toHaveValue("1.234.567,80");
    await userEvent.click(campo);
    await expect.element(campo).toHaveValue("1234567,80");
  });

  it("un valor inicial se muestra formateado", async () => {
    await render(<Probado inicial="12000.5" />);
    await expect.element(page.getByLabelText("Importe")).toHaveValue("12.000,50");
  });

  it("si el padre limpia el valor, el campo se vacía", async () => {
    await render(<Probado inicial="50.00" />);
    await userEvent.click(page.getByRole("button", { name: "Limpiar" }));
    await expect.element(page.getByLabelText("Importe")).toHaveValue("");
  });

  it("dentro de un formulario manda el texto canónico, no el que se ve", async () => {
    await render(
      <form data-testid="formulario">
        <Probado inicial="1234.50" />
      </form>,
    );
    const datos = new FormData(page.getByTestId("formulario").element() as HTMLFormElement);
    expect(datos.get("importe")).toBe("1234.50");
  });

  it("sin violaciones de accesibilidad, con y sin error", async () => {
    const { rerender } = await render(<Probado />);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await rerender(
      <CampoImporte
        etiqueta="Importe"
        valor=""
        alCambiar={() => undefined}
        error="Ingresá un importe."
      />,
    );
    await expect.element(page.getByLabelText("Importe")).toBeInvalid();
    await expect
      .element(page.getByLabelText("Importe"))
      .toHaveAccessibleDescription("Ingresá un importe.");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el símbolo es adorno: no forma parte del nombre del campo", async () => {
    await render(<Probado />);
    await expect.element(page.getByRole("textbox", { name: "Importe" })).toBeVisible();
  });
});
