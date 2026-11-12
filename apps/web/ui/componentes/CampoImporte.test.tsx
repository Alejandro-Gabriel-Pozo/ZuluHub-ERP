import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent, type Locator } from "vitest/browser";
import { matrizDeEstados, verificarFoco, violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { CampoImporte } from "./CampoImporte";

/**
 * Pega `texto` en el campo sin tocar el portapapeles real (el Chromium del CI no da permiso de escritura): lanza el evento `paste`
 * con su `clipboardData` y, si el campo no lo cancela, el navegador inserta el texto (`fill`), como en un pegado de verdad.
 */
async function pegar(campo: Locator, texto: string): Promise<void> {
  const datos = new DataTransfer();
  datos.setData("text/plain", texto);
  const evento = new ClipboardEvent("paste", {
    clipboardData: datos,
    bubbles: true,
    cancelable: true,
  });
  campo.element().dispatchEvent(evento);
  if (!evento.defaultPrevented) await userEvent.fill(campo, texto);
}

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
        dato="pendiente"
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

  it("los miles con punto los pone el sistema mientras se escribe; la tecla «.» no escribe nada", async () => {
    const alEntregar = vi.fn();
    await render(<Probado alEntregar={alEntregar} />);
    const campo = page.getByLabelText("Importe");
    await userEvent.type(campo, "8500");
    await expect.element(campo).toHaveValue("8.500");
    expect(alEntregar).toHaveBeenLastCalledWith("8500.00");
    await userEvent.clear(campo);
    await userEvent.type(campo, "1234,5");
    await expect.element(campo).toHaveValue("1.234,5");
    await userEvent.clear(campo);
    await userEvent.type(campo, ".");
    await expect.element(campo).toHaveValue("");
    await userEvent.type(campo, "1.5");
    await expect.element(campo).toHaveValue("15");
    expect(alEntregar).toHaveBeenLastCalledWith("15.00");
  });

  it("el cursor no salta al reformatear y borrar un punto de miles no rompe el valor", async () => {
    const alEntregar = vi.fn();
    await render(<Probado alEntregar={alEntregar} />);
    const campo = page.getByLabelText("Importe");
    const el = campo.element() as HTMLInputElement;
    await userEvent.type(campo, "8500");
    // Se escribe un 1 al principio: el cursor queda detrás del 1, no al final.
    el.setSelectionRange(0, 0);
    await userEvent.keyboard("1");
    await expect.element(campo).toHaveValue("18.500");
    expect(el.selectionStart).toBe(1);
    // Retroceso con el cursor detrás del punto de miles: el valor no cambia.
    el.setSelectionRange(3, 3);
    await userEvent.keyboard("{Backspace}");
    await expect.element(campo).toHaveValue("18.500");
    expect(alEntregar).toHaveBeenLastCalledWith("18500.00");
  });

  it("pegar: «1.234,56» y «1234,56» entran como 1.234,56; «1234.56», «1.5» y «1.2.3» se rechazan y el campo no cambia", async () => {
    const alEntregar = vi.fn();
    await render(<Probado alEntregar={alEntregar} />);
    const campo = page.getByLabelText("Importe");
    await userEvent.click(campo);
    for (const pegado of ["1.234,56", "1234,56"]) {
      await userEvent.clear(campo);
      await pegar(campo, pegado);
      await expect.element(campo).toHaveValue("1.234,56");
      expect(alEntregar).toHaveBeenLastCalledWith("1234.56");
    }
    await userEvent.clear(campo);
    alEntregar.mockClear();
    for (const rechazado of ["1234.56", "1.5", "1.2.3", "12,345", "abc"]) {
      await pegar(campo, rechazado);
      await expect.element(campo).toHaveValue("");
    }
    expect(alEntregar).not.toHaveBeenCalled();
  });

  it("al salir completa los dos decimales y conserva los miles; al volver, no cambia lo que se ve", async () => {
    await render(<Probado />);
    const campo = page.getByLabelText("Importe");
    await userEvent.type(campo, "1234567,8");
    await expect.element(campo).toHaveValue("1.234.567,8");
    await userEvent.tab();
    await expect.element(campo).toHaveValue("1.234.567,80");
    await userEvent.click(campo);
    await expect.element(campo).toHaveValue("1.234.567,80");
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
        dato="pendiente"
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

matrizDeEstados("CampoImporte", {
  normal: async () => {
    await render(<Probado />);
    const campo = page.getByLabelText("Importe");
    await expect.element(campo).toBeEnabled();
    await expect.element(campo).not.toHaveAttribute("aria-invalid");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
  foco: async () => {
    await render(<Probado />);
    const campo = page.getByLabelText("Importe").element() as HTMLElement;
    // El anillo lo dibuja la fila que envuelve al campo (el símbolo y el importe se ven como una sola caja).
    await verificarFoco(campo, campo.parentElement ?? campo);
  },
  cargando: {
    noAplica:
      "un campo de importe no carga por sí mismo: mientras se envía lo bloquea el formulario que lo contiene",
  },
  error: async () => {
    await render(
      <CampoImporte
        dato="pendiente"
        etiqueta="Importe"
        valor=""
        alCambiar={() => undefined}
        error="Ingresá un importe."
      />,
    );
    const campo = page.getByLabelText("Importe");
    await expect.element(campo).toBeInvalid();
    await expect.element(campo).toHaveAccessibleDescription("Ingresá un importe.");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
  deshabilitado: async () => {
    await render(
      <CampoImporte
        dato="pendiente"
        etiqueta="Importe"
        valor=""
        alCambiar={() => undefined}
        deshabilitado
      />,
    );
    await expect.element(page.getByLabelText("Importe")).toBeDisabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
});
