import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { Respuesta } from "../../../../../../src/capacidades/experiencia/respuesta";
import { Campo } from "../../../componentes/Campo";
import { useLecturaDemorada } from "./useLecturaDemorada";

/**
 * La lectura que sigue a lo escrito (Compras PR 6b): espera a que se deje de escribir, pide una sola vez, y una respuesta lenta de un pedido viejo NO pisa a la nueva ni se muestra
 * para lo que ya no está escrito.
 */

function Probada({
  leer,
  espera = 20,
}: {
  leer: (a: string) => Promise<Respuesta<string>>;
  espera?: number;
}) {
  const [texto, setTexto] = useState("");
  const lectura = useLecturaDemorada(texto === "" ? null : texto, leer, espera);
  return (
    <>
      <Campo dato="producto-de-compra" etiqueta="buscar" valor={texto} alCambiar={setTexto} />
      <output aria-label="resultado">{lectura.dato ?? ""}</output>
    </>
  );
}

describe("useLecturaDemorada", () => {
  it("pide una sola vez después de dejar de escribir", async () => {
    const leer = vi.fn((a: string) =>
      Promise.resolve<Respuesta<string>>({ ok: true, dato: `r:${a}` }),
    );
    await render(<Probada leer={leer} espera={80} />);
    await userEvent.type(page.getByLabelText("buscar"), "abc");
    await expect.element(page.getByLabelText("resultado")).toHaveTextContent("r:abc");
    expect(leer).toHaveBeenCalledTimes(1);
    expect(leer).toHaveBeenCalledWith("abc");
  });

  it("una respuesta lenta de un pedido viejo no pisa a la nueva", async () => {
    const leer = vi.fn(
      (a: string) =>
        new Promise<Respuesta<string>>((resolver) => {
          setTimeout(
            () => {
              resolver({ ok: true, dato: `r:${a}` });
            },
            a === "a" ? 200 : 10,
          );
        }),
    );
    await render(<Probada leer={leer} />);
    await userEvent.type(page.getByLabelText("buscar"), "a");
    await vi.waitFor(() => expect(leer).toHaveBeenCalledWith("a"));
    await userEvent.type(page.getByLabelText("buscar"), "b");
    await expect.element(page.getByLabelText("resultado")).toHaveTextContent("r:ab");
    await new Promise((r) => setTimeout(r, 300));
    await expect.element(page.getByLabelText("resultado")).toHaveTextContent("r:ab");
  });

  it("al borrar lo escrito no queda ningún resultado", async () => {
    const leer = vi.fn((a: string) =>
      Promise.resolve<Respuesta<string>>({ ok: true, dato: `r:${a}` }),
    );
    await render(<Probada leer={leer} />);
    await userEvent.type(page.getByLabelText("buscar"), "a");
    await expect.element(page.getByLabelText("resultado")).toHaveTextContent("r:a");
    await userEvent.clear(page.getByLabelText("buscar"));
    await expect.element(page.getByLabelText("resultado")).toHaveTextContent("");
  });

  it("si la red falla no inventa un resultado ni rompe: sigue sin resultado", async () => {
    const leer = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    await render(<Probada leer={leer} />);
    await userEvent.type(page.getByLabelText("buscar"), "a");
    await vi.waitFor(() => expect(leer).toHaveBeenCalled());
    await expect.element(page.getByLabelText("resultado")).toHaveTextContent("");
  });
});
