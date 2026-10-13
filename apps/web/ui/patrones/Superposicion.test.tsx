import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { Boton } from "../componentes/Boton";
import { Campo } from "../componentes/Campo";
import { violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { Superposicion, type PropositoDeSuperposicion } from "./Superposicion";

function Ejemplo({
  proposito,
  cerrable = true,
  alCerrar,
  abiertaAlInicio = false,
}: {
  proposito: PropositoDeSuperposicion;
  cerrable?: boolean;
  alCerrar?: () => void;
  abiertaAlInicio?: boolean;
}) {
  const [abierta, setAbierta] = useState(abiertaAlInicio);
  const [nombre, setNombre] = useState("");
  return (
    <>
      <button type="button" onClick={() => setAbierta(true)}>
        Abrir
      </button>
      <button type="button" id="cierra-desde-afuera" onClick={() => setAbierta(false)}>
        Cerrar desde afuera
      </button>
      <Superposicion
        abierta={abierta}
        titulo="Medio de pago"
        proposito={proposito}
        cerrable={cerrable}
        etiquetaDeCerrar="Cerrar"
        alCerrar={() => {
          alCerrar?.();
          setAbierta(false);
        }}
      >
        <Campo etiqueta="Nombre" valor={nombre} alCambiar={setNombre} />
        <Boton>Cobrar $ 100,00</Boton>
        <Boton variante="secundaria">Volver</Boton>
      </Superposicion>
    </>
  );
}

const PROPOSITOS: PropositoDeSuperposicion[] = ["elegir", "confirmar", "editar", "detalle"];

async function abrir() {
  await userEvent.click(page.getByRole("button", { name: "Abrir" }));
  await expect.element(page.getByRole("dialog")).toBeVisible();
}

const dentro = (): boolean =>
  document.querySelector("dialog")?.contains(document.activeElement) ?? false;

describe("Superposicion", () => {
  it.each(PROPOSITOS)(
    "%s: sin violaciones de accesibilidad en el celular (contraste incluido)",
    async (proposito) => {
      await render(<Ejemplo proposito={proposito} />);
      await abrir();
      expect(await violacionesDeAccesibilidad()).toEqual([]);
    },
  );

  it("aria snapshot: un diálogo modal con nombre", async () => {
    await render(<Ejemplo proposito="elegir" />);
    await abrir();
    await expect.element(page.getByRole("dialog")).toMatchAriaInlineSnapshot(`
      - dialog "Medio de pago":
        - heading "Medio de pago" [level=2]
        - button "Cerrar"
        - text: Nombre
        - textbox "Nombre"
        - button "Cobrar $ 100,00"
        - button "Volver"
    `);
  });

  it("es un <dialog> modal: el fondo queda inerte", async () => {
    await render(<Ejemplo proposito="elegir" />);
    await abrir();
    const dialogo = document.querySelector("dialog");
    expect(dialogo?.matches(":modal")).toBe(true);
    expect(dialogo?.open).toBe(true);
  });

  it("cerrada no tiene contenido ni se ve", async () => {
    await render(<Ejemplo proposito="elegir" />);
    expect(document.querySelector("dialog")?.open).toBe(false);
    expect(document.querySelector("dialog")?.children).toHaveLength(0);
  });

  it.each(["elegir", "editar", "detalle"] as const)(
    "%s: el foco inicial cae en el primer control",
    async (proposito) => {
      await render(<Ejemplo proposito={proposito} />);
      await abrir();
      expect(document.activeElement).toBe(page.getByLabelText("Nombre").element());
    },
  );

  it("confirmar: el foco inicial va al título, nunca al botón que mueve dinero", async () => {
    await render(<Ejemplo proposito="confirmar" />);
    await abrir();
    const activo = document.activeElement;
    expect(activo?.tagName).toBe("H2");
    expect(activo?.textContent).toBe("Medio de pago");
    expect(activo).not.toBe(page.getByRole("button", { name: "Cobrar $ 100,00" }).element());
  });

  it("el foco queda atrapado: Tab y Mayús+Tab dan la vuelta sin salir", async () => {
    await render(<Ejemplo proposito="confirmar" />);
    await abrir();
    for (let i = 0; i < 12; i++) {
      await userEvent.keyboard("{Tab}");
      expect(dentro(), `Tab ${i + 1}`).toBe(true);
    }
    for (let i = 0; i < 12; i++) {
      await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
      expect(dentro(), `Mayús+Tab ${i + 1}`).toBe(true);
    }
  });

  it("Tab desde el último control vuelve al primero, y Mayús+Tab desde el primero va al último", async () => {
    await render(<Ejemplo proposito="elegir" />);
    await abrir();
    page.getByRole("button", { name: "Volver" }).element().focus();
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(page.getByRole("button", { name: "Cerrar" }).element());
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(page.getByRole("button", { name: "Volver" }).element());
  });

  it("Escape cierra si es cerrable y el foco vuelve a quien la abrió", async () => {
    const alCerrar = vi.fn();
    await render(<Ejemplo proposito="elegir" alCerrar={alCerrar} />);
    await abrir();
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(document.querySelector("dialog")?.open).toBe(false);
    });
    expect(alCerrar).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(page.getByRole("button", { name: "Abrir" }).element());
  });

  it("el botón de cerrar también cierra y devuelve el foco", async () => {
    await render(<Ejemplo proposito="editar" />);
    await abrir();
    await userEvent.click(page.getByRole("button", { name: "Cerrar" }));
    await vi.waitFor(() => {
      expect(document.querySelector("dialog")?.open).toBe(false);
    });
    expect(document.activeElement).toBe(page.getByRole("button", { name: "Abrir" }).element());
  });

  it("no cerrable (mientras envía): Escape no hace nada, ni dos veces, y no hay botón de cerrar", async () => {
    const alCerrar = vi.fn();
    await render(<Ejemplo proposito="confirmar" cerrable={false} alCerrar={alCerrar} />);
    await abrir();
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");
    expect(alCerrar).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")?.open).toBe(true);
    expect(page.getByRole("button", { name: "Cerrar" }).query()).toBeNull();
    expect(dentro()).toBe(true);
  });

  it("tocar el fondo no cierra: un toque de más no pierde lo cargado", async () => {
    const alCerrar = vi.fn();
    await render(<Ejemplo proposito="elegir" alCerrar={alCerrar} />);
    await abrir();
    const dialogo = document.querySelector("dialog");
    dialogo?.click();
    await userEvent.click(page.getByRole("dialog"), { position: { x: 1, y: 1 } });
    expect(alCerrar).not.toHaveBeenCalled();
    expect(dialogo?.open).toBe(true);
  });

  it("si el padre la cierra, el foco también vuelve a quien la abrió", async () => {
    await render(<Ejemplo proposito="elegir" cerrable={false} />);
    await abrir();
    document.querySelector<HTMLButtonElement>("#cierra-desde-afuera")?.click();
    await vi.waitFor(() => {
      expect(document.querySelector("dialog")?.open).toBe(false);
    });
    expect(document.activeElement).toBe(page.getByRole("button", { name: "Abrir" }).element());
  });

  it("la hoja inferior en el celular (elegir y confirmar) y pantalla completa (editar y detalle)", async () => {
    for (const proposito of ["elegir", "confirmar"] as const) {
      const { unmount } = await render(<Ejemplo proposito={proposito} />);
      await abrir();
      const caja = document.querySelector("dialog")?.getBoundingClientRect();
      expect(caja?.bottom, proposito).toBe(window.innerHeight);
      expect(caja?.width, proposito).toBe(window.innerWidth);
      expect(caja?.height ?? 0, proposito).toBeLessThan(window.innerHeight);
      await unmount();
    }
    for (const proposito of ["editar", "detalle"] as const) {
      const { unmount } = await render(<Ejemplo proposito={proposito} />);
      await abrir();
      const caja = document.querySelector("dialog")?.getBoundingClientRect();
      expect(caja?.height, proposito).toBe(window.innerHeight);
      expect(caja?.width, proposito).toBe(window.innerWidth);
      await unmount();
    }
  });
});
