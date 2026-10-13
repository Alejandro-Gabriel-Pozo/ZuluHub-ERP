import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../pruebas/ayudas";
import { AvisoDeSesion, type TextosDeSesion } from "./AvisoDeSesion";
import { leerBorrador } from "./borrador";

afterEach(() => {
  sessionStorage.clear();
});

const textos: TextosDeSesion = {
  avisoTitulo: "¿Seguís ahí?",
  avisoDetalle: "Por seguridad, la sesión se cierra si no se usa. Tocá «Seguir» para mantenerla.",
  seguir: "Seguir",
  vencidaTitulo: "Tu sesión venció",
  vencidaDetalle:
    "Lo que tipeaste quedó guardado en esta pestaña. Volvé a ingresar y lo recuperás.",
  ingresarDeNuevo: "Ingresar de nuevo",
  cerrar: "Cerrar",
};

describe("AvisoDeSesion", () => {
  it("activa: no muestra nada", async () => {
    await render(
      <AvisoDeSesion estado="activa" textos={textos} alSeguir={vi.fn()} alIngresar={vi.fn()} />,
    );
    expect(page.getByRole("dialog").query()).toBeNull();
  });

  it("por vencer: «¿Seguís ahí?» con «Seguir»; sin violaciones y con su snapshot", async () => {
    const alSeguir = vi.fn();
    await render(
      <AvisoDeSesion
        estado="por-vencer"
        textos={textos}
        alSeguir={alSeguir}
        alIngresar={vi.fn()}
      />,
    );
    const dialogo = page.getByRole("dialog", { name: "¿Seguís ahí?" });
    await expect.element(dialogo).toBeVisible();
    await expect.element(dialogo).toMatchAriaInlineSnapshot(`
      - dialog "¿Seguís ahí?":
        - heading "¿Seguís ahí?" [level=2]
        - button "Cerrar"
        - paragraph: Por seguridad, la sesión se cierra si no se usa. Tocá «Seguir» para mantenerla.
        - button "Seguir"
    `);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await userEvent.click(page.getByRole("button", { name: "Seguir" }));
    expect(alSeguir).toHaveBeenCalledTimes(1);
  });

  it("por vencer: Escape también sigue (es usar la pantalla)", async () => {
    const alSeguir = vi.fn();
    await render(
      <AvisoDeSesion
        estado="por-vencer"
        textos={textos}
        alSeguir={alSeguir}
        alIngresar={vi.fn()}
      />,
    );
    await userEvent.keyboard("{Escape}");
    expect(alSeguir).toHaveBeenCalledTimes(1);
  });

  it("vencida: no se puede cerrar, solo volver a ingresar", async () => {
    const alSeguir = vi.fn();
    const alIngresar = vi.fn();
    await render(
      <AvisoDeSesion
        estado="vencida"
        textos={textos}
        alSeguir={alSeguir}
        alIngresar={alIngresar}
      />,
    );
    const dialogo = page.getByRole("dialog", { name: "Tu sesión venció" });
    await expect.element(dialogo).toMatchAriaInlineSnapshot(`
      - dialog "Tu sesión venció":
        - heading "Tu sesión venció" [level=2]
        - paragraph: Lo que tipeaste quedó guardado en esta pestaña. Volvé a ingresar y lo recuperás.
        - button "Ingresar de nuevo"
    `);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await userEvent.keyboard("{Escape}");
    expect(alSeguir).not.toHaveBeenCalled();
    expect(page.getByRole("button", { name: "Cerrar" }).query()).toBeNull();
    expect(page.getByRole("button", { name: "Seguir" }).query()).toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Ingresar de nuevo" }));
    expect(alIngresar).toHaveBeenCalledTimes(1);
  });

  it("al vencer guarda lo tipeado en sessionStorage, sin claves ni tokens", async () => {
    const { rerender } = await render(
      <AvisoDeSesion
        estado="por-vencer"
        textos={textos}
        alSeguir={vi.fn()}
        alIngresar={vi.fn()}
        borrador={{ nombre: "venta", campos: { busqueda: "medialunas", clave: "no", token: "no" } }}
      />,
    );
    expect(leerBorrador("venta")).toBeNull();
    await rerender(
      <AvisoDeSesion
        estado="vencida"
        textos={textos}
        alSeguir={vi.fn()}
        alIngresar={vi.fn()}
        borrador={{ nombre: "venta", campos: { busqueda: "medialunas", clave: "no", token: "no" } }}
      />,
    );
    expect(leerBorrador("venta")).toEqual({ busqueda: "medialunas" });
    expect(sessionStorage.getItem("zh:borrador:venta")).not.toContain('no"');
  });

  it("sin borrador no guarda nada", async () => {
    await render(
      <AvisoDeSesion estado="vencida" textos={textos} alSeguir={vi.fn()} alIngresar={vi.fn()} />,
    );
    expect(sessionStorage.length).toBe(0);
  });
});
