import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { matrizDeEstados, verificarFoco, violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { BuscadorEnLista, type OpcionDeBuscador } from "./BuscadorEnLista";

const TODAS: readonly OpcionDeBuscador[] = [
  { valor: "p1", etiqueta: "Tomate", detalle: "kg" },
  { valor: "p2", etiqueta: "Tomate cherry", detalle: "kg" },
  { valor: "p3", etiqueta: "Harina", detalle: "kg", apagada: true },
];

function Probado(props: { error?: string; deshabilitado?: boolean; nombre?: string }) {
  const [consulta, setConsulta] = useState("");
  const [valor, setValor] = useState("");
  const texto = consulta.trim().toLowerCase();
  const opciones =
    valor === ""
      ? TODAS.filter((o) => texto !== "" && o.etiqueta.toLowerCase().includes(texto))
      : [];
  return (
    <>
      <BuscadorEnLista
        {...props}
        dato="producto-de-compra"
        etiqueta="Producto"
        consulta={consulta}
        alCambiarLaConsulta={setConsulta}
        valor={valor}
        alElegir={(v) => {
          setValor(v);
          const elegida = TODAS.find((o) => o.valor === v);
          if (elegida !== undefined) setConsulta(elegida.etiqueta);
        }}
        opciones={opciones}
        anuncio={opciones.length === 0 ? "Sin resultados" : `${String(opciones.length)} resultados`}
      />
      <output data-testid="elegido">{valor}</output>
    </>
  );
}

const elegido = () => page.getByTestId("elegido");

describe("BuscadorEnLista", () => {
  it("sin nada escrito no muestra la lista; al escribir aparece y anuncia la cantidad", async () => {
    await render(<Probado />);
    const campo = page.getByRole("combobox", { name: "Producto" });
    await expect.element(campo).toHaveAttribute("aria-expanded", "false");
    await userEvent.type(campo, "tom");
    await expect.element(campo).toHaveAttribute("aria-expanded", "true");
    await expect.element(page.getByRole("option", { name: /^Tomate kg$/ })).toBeVisible();
    await expect.element(page.getByText("2 resultados")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("tocar una opción la elige y cierra la lista", async () => {
    await render(<Probado />);
    const campo = page.getByRole("combobox", { name: "Producto" });
    await userEvent.type(campo, "tom");
    await userEvent.click(page.getByRole("option", { name: /Tomate cherry/ }));
    await expect.element(elegido()).toHaveTextContent("p2");
    await expect.element(campo).toHaveValue("Tomate cherry");
    await expect.element(campo).toHaveAttribute("aria-expanded", "false");
  });

  it("con teclado: flecha abajo recorre, Enter elige y Escape cierra sin elegir", async () => {
    await render(<Probado />);
    const campo = page.getByRole("combobox", { name: "Producto" });
    await userEvent.type(campo, "tom");
    await expect.element(campo).toHaveAttribute("aria-activedescendant");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    await expect.element(elegido()).toHaveTextContent("p2");
    await userEvent.clear(campo);
    await userEvent.type(campo, "tom");
    await userEvent.keyboard("{Escape}");
    await expect.element(campo).toHaveAttribute("aria-expanded", "false");
    await expect.element(elegido()).toHaveTextContent("");
  });

  it("una opción apagada no se puede elegir", async () => {
    await render(<Probado />);
    const campo = page.getByRole("combobox", { name: "Producto" });
    await userEvent.type(campo, "harina");
    await page.getByRole("option", { name: /Harina/ }).click({ force: true });
    await expect.element(elegido()).toHaveTextContent("");
    await userEvent.keyboard("{Enter}");
    await expect.element(elegido()).toHaveTextContent("");
  });

  it("con el foco en una opción, Enter la elige", async () => {
    await render(<Probado />);
    await userEvent.type(page.getByRole("combobox", { name: "Producto" }), "tom");
    (page.getByRole("option", { name: /Tomate cherry/ }).element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(elegido()).toHaveTextContent("p2");
  });

  it("escribir sobre lo elegido lo descarta", async () => {
    await render(<Probado />);
    const campo = page.getByRole("combobox", { name: "Producto" });
    await userEvent.type(campo, "tom");
    await userEvent.keyboard("{Enter}");
    await expect.element(elegido()).toHaveTextContent("p1");
    await userEvent.type(campo, "x");
    await expect.element(elegido()).toHaveTextContent("");
  });

  it("Enter con la lista cerrada no elige nada", async () => {
    await render(<Probado />);
    const campo = page.getByRole("combobox", { name: "Producto" });
    await userEvent.type(campo, "zzz{Enter}");
    await expect.element(elegido()).toHaveTextContent("");
    await expect.element(page.getByText("Sin resultados")).toBeVisible();
  });

  it("con nombre lleva la opción elegida en un campo oculto", async () => {
    await render(<Probado nombre="productoId" />);
    const campo = page.getByRole("combobox", { name: "Producto" });
    await userEvent.type(campo, "tom");
    await userEvent.keyboard("{Enter}");
    const oculto = document.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="productoId"]',
    );
    expect(oculto?.value).toBe("p1");
  });

  it("el error queda asociado al campo", async () => {
    await render(<Probado error="Elegí un producto." />);
    const campo = page.getByRole("combobox", { name: "Producto" });
    await expect.element(campo).toBeInvalid();
    await expect.element(campo).toHaveAccessibleDescription("Elegí un producto.");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});

matrizDeEstados("BuscadorEnLista", {
  normal: async () => {
    await render(<Probado />);
    await expect.element(page.getByRole("combobox", { name: "Producto" })).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
  foco: async () => {
    await render(<Probado />);
    await verificarFoco(page.getByRole("combobox", { name: "Producto" }).element() as HTMLElement);
  },
  cargando: {
    noAplica:
      "el campo no carga por sí mismo: quien lo usa le pasa las opciones y el anuncio mientras busca",
  },
  error: async () => {
    await render(<Probado error="Elegí un producto." />);
    await expect.element(page.getByRole("combobox", { name: "Producto" })).toBeInvalid();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
  deshabilitado: async () => {
    await render(<Probado deshabilitado />);
    await expect.element(page.getByRole("combobox", { name: "Producto" })).toBeDisabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
});
