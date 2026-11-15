import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { matrizDeEstados, verificarFoco, violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { GrupoDeOpciones, type OpcionDelGrupo } from "./GrupoDeOpciones";

const opciones: readonly OpcionDelGrupo[] = [
  { id: "a", etiqueta: "Papas fritas", nota: undefined },
  { id: "b", etiqueta: "Huevo frito", nota: "+ $ 600,00" },
  { id: "c", etiqueta: "Panceta", nota: "+ $ 600,00", deshabilitada: true },
];

function Probado(props: {
  varias: boolean;
  etiquetaSinElegir?: string;
  deshabilitado?: boolean;
  ocultarNombre?: boolean;
  inicial?: readonly string[];
  alCambiarFuera?: (v: readonly string[]) => void;
}) {
  const [valor, setValor] = useState<readonly string[]>(props.inicial ?? []);
  return (
    <GrupoDeOpciones
      dato="eleccion-de-opcion-de-venta"
      nombre="Guarnición"
      opciones={opciones}
      valor={valor}
      alCambiar={(v) => {
        setValor(v);
        props.alCambiarFuera?.(v);
      }}
      varias={props.varias}
      etiquetaSinElegir={props.etiquetaSinElegir}
      deshabilitado={props.deshabilitado ?? false}
      ocultarNombre={props.ocultarNombre ?? false}
    />
  );
}

describe("GrupoDeOpciones", () => {
  it("una sola elección: botones de opción dentro de un grupo con nombre; elegir otra reemplaza", async () => {
    await render(<Probado varias={false} />);
    await expect.element(page.getByRole("group", { name: "Guarnición" })).toBeVisible();
    const papas = page.getByRole("radio", { name: "Papas fritas" });
    const huevo = page.getByRole("radio", { name: /Huevo frito/ });
    await userEvent.click(papas);
    await expect.element(papas).toBeChecked();
    await userEvent.click(huevo);
    await expect.element(huevo).toBeChecked();
    await expect.element(papas).not.toBeChecked();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("varias a la vez: casillas que se tildan y destildan sin tocar las demás", async () => {
    const cambios: (readonly string[])[] = [];
    await render(<Probado varias alCambiarFuera={(v) => cambios.push(v)} />);
    await userEvent.click(page.getByRole("checkbox", { name: "Papas fritas" }));
    await userEvent.click(page.getByRole("checkbox", { name: /Huevo frito/ }));
    await userEvent.click(page.getByRole("checkbox", { name: "Papas fritas" }));
    expect(cambios).toEqual([["a"], ["a", "b"], ["b"]]);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("la nota de cada opción (el recargo) se lee junto a su nombre", async () => {
    await render(<Probado varias={false} />);
    await expect.element(page.getByRole("radio", { name: "Huevo frito + $ 600,00" })).toBeVisible();
  });

  it("una opción deshabilitada se ve y se lee como tal y no se puede elegir", async () => {
    const cambios: (readonly string[])[] = [];
    await render(<Probado varias={false} alCambiarFuera={(v) => cambios.push(v)} />);
    const panceta = page.getByRole("radio", { name: /Panceta/ });
    await expect.element(panceta).toBeDisabled();
    await userEvent.click(page.getByText("Panceta"), { force: true });
    expect(cambios).toEqual([]);
  });

  it("con «sin elegir» el grupo puede volver a quedar vacío", async () => {
    await render(<Probado varias={false} etiquetaSinElegir="Sin elegir" inicial={["a"]} />);
    await expect.element(page.getByRole("radio", { name: "Papas fritas" })).toBeChecked();
    await userEvent.click(page.getByRole("radio", { name: "Sin elegir" }));
    await expect.element(page.getByRole("radio", { name: "Sin elegir" })).toBeChecked();
    await expect.element(page.getByRole("radio", { name: "Papas fritas" })).not.toBeChecked();
  });

  it("sin «sin elegir» no se ofrece esa opción, y con varias nunca se ofrece", async () => {
    await render(<Probado varias={false} />);
    expect(page.getByRole("radio").elements()).toHaveLength(3);
    await render(<Probado varias etiquetaSinElegir="Sin elegir" />);
    expect(page.getByRole("radio", { name: "Sin elegir" }).elements()).toHaveLength(0);
  });

  it("el nombre oculto lo lee el lector de pantalla pero no se ve", async () => {
    await render(<Probado varias={false} ocultarNombre />);
    const grupo = page.getByRole("group", { name: "Guarnición" });
    expect(grupo.element()).not.toBeNull();
    const leyenda = grupo.element().querySelector("legend");
    expect(leyenda).not.toBeNull();
    expect(leyenda?.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });

  it("el objetivo táctil de cada opción es de 3 rem como mínimo", async () => {
    await render(<Probado varias={false} />);
    const fila = page.getByRole("radio", { name: "Papas fritas" }).element().closest("label");
    expect(fila?.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
  });
});

matrizDeEstados("GrupoDeOpciones", {
  normal: async () => {
    await render(<Probado varias={false} />);
    await expect.element(page.getByRole("radio", { name: "Papas fritas" })).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
  foco: async () => {
    await render(<Probado varias={false} />);
    await verificarFoco(page.getByRole("radio", { name: "Papas fritas" }).element() as HTMLElement);
  },
  cargando: {
    noAplica:
      "el grupo no carga por sí mismo: las opciones llegan ya resueltas de la pantalla que lo arma",
  },
  error: {
    noAplica:
      "no tiene error propio: la pantalla apaga «Agregar» mientras falte una opción obligatoria",
  },
  deshabilitado: async () => {
    await render(<Probado varias={false} deshabilitado />);
    await expect.element(page.getByRole("radio", { name: "Papas fritas" })).toBeDisabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  },
});
