import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { CampoDeDocumento } from "./CampoDeDocumento";

function Controlado(props: { nombre?: string; alEntregar?: (valor: string) => void }) {
  const [valor, setValor] = useState("");
  return (
    <CampoDeDocumento
      dato="pendiente"
      nombre={props.nombre}
      etiqueta="Número"
      tipo="CUIT"
      valor={valor}
      alCambiar={(nuevo) => {
        setValor(nuevo);
        props.alEntregar?.(nuevo);
      }}
    />
  );
}

describe("CampoDeDocumento", () => {
  it("con nombre el input lleva ese name", async () => {
    await render(<Controlado nombre="documentoNumero" />);
    await expect.element(page.getByLabelText("Número")).toHaveAttribute("name", "documentoNumero");
  });

  it("sin nombre el input no lleva name", async () => {
    await render(<Controlado />);
    await expect.element(page.getByLabelText("Número")).not.toHaveAttribute("name");
  });

  it("al escribir un CUIT el valor visible lleva guiones y alCambiar entrega solo dígitos", async () => {
    const entregados: string[] = [];
    await render(
      <Controlado
        nombre="documentoNumero"
        alEntregar={(valor) => {
          entregados.push(valor);
        }}
      />,
    );
    const campo = page.getByLabelText("Número");
    await userEvent.type(campo, "20123456786");
    await expect.element(campo).toHaveValue("20-12345678-6");
    expect(entregados.at(-1)).toBe("20123456786");
  });
});
