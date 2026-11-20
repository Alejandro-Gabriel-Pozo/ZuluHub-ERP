import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { errorDeCodigo } from "../../../../../src/capacidades/experiencia/respuesta";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { armarLaVisibilidad } from "./modelo-de-visibilidad-de-producto";
import { VisibilidadDeLaFichaDeProducto } from "./VisibilidadDeLaFichaDeProducto.cliente";

/**
 * La tarjeta de visibilidad de la ficha de un producto en Chromium (maqueta `productos.html`, `vVisib`): los avisos y los botones de cada alcance, que cada botón manda SU acción, el doble
 * toque, el botón apagado sin permiso, el motivo del servidor debajo, el teclado y axe en 390 y 1280 px.
 */
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const TODO = { local: true, empresa: true };

const tarjeta = (
  v: { local: boolean | null; empresa: boolean },
  permisos = TODO,
  acciones: Partial<Record<"LOCAL" | "EMPRESA", AccionDeFormulario>> = {},
) => (
  <VisibilidadDeLaFichaDeProducto
    filas={armarLaVisibilidad(v, permisos)}
    acciones={{ LOCAL: acciones.LOCAL ?? ok, EMPRESA: acciones.EMPRESA ?? ok }}
  />
);
const boton = (nombre: string) => page.getByRole("button", { name: nombre, exact: true });

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("VisibilidadDeLaFichaDeProducto", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 900],
      [1280, 700],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(tarjeta({ local: true, empresa: true }));
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });

  it("visible: «Ocultar» y «Ocultar en toda la empresa», sin avisos", async () => {
    await render(tarjeta({ local: false, empresa: false }));
    await expect.element(boton("Ocultar")).toBeVisible();
    await expect.element(boton("Ocultar en toda la empresa")).toBeVisible();
    expect(document.body.textContent).not.toContain("Oculto");
  });

  it("oculto en el local y en la empresa: cada uno con su aviso y «Volver a mostrar»", async () => {
    await render(tarjeta({ local: true, empresa: true }));
    await expect.element(page.getByText("Oculto", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Oculto en toda la empresa", { exact: true }))
      .toBeVisible();
    expect(page.getByRole("button", { name: "Volver a mostrar" }).elements()).toHaveLength(2);
  });

  it("sin local con el que trabajar no hay «Ocultar» del local: solo el de toda la empresa", async () => {
    await render(tarjeta({ local: null, empresa: false }));
    await expect.element(boton("Ocultar en toda la empresa")).toBeVisible();
    expect(page.getByRole("button", { name: "Ocultar", exact: true }).elements()).toHaveLength(0);
  });

  it("cada botón manda SU acción: el del local la del local, el de la empresa la de la empresa", async () => {
    const local = vi.fn(ok);
    const empresa = vi.fn(ok);
    await render(
      tarjeta({ local: false, empresa: false }, TODO, { LOCAL: local, EMPRESA: empresa }),
    );
    tocar(boton("Ocultar"));
    await vi.waitFor(() => expect(local).toHaveBeenCalledTimes(1));
    expect(empresa).not.toHaveBeenCalled();
    tocar(boton("Ocultar en toda la empresa"));
    await vi.waitFor(() => expect(empresa).toHaveBeenCalledTimes(1));
    expect(local).toHaveBeenCalledTimes(1);
  });

  it("el segundo toque no manda un segundo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async () => {
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(tarjeta({ local: false, empresa: false }, TODO, { LOCAL: accion }));
    tocar(boton("Ocultar"));
    await expect.element(boton("Ocultar")).toHaveAttribute("aria-busy", "true");
    tocar(boton("Ocultar"));
    tocar(boton("Ocultar"));
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(boton("Ocultar")).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("sin permiso para toda la empresa su botón sale apagado y no manda nada; el del local sigue activo", async () => {
    const empresa = vi.fn(ok);
    await render(
      tarjeta(
        { local: false, empresa: true },
        { local: true, empresa: false },
        { EMPRESA: empresa },
      ),
    );
    await expect.element(page.getByRole("button", { name: "Volver a mostrar" })).toBeDisabled();
    await expect.element(boton("Ocultar")).toBeEnabled();
    expect(empresa).not.toHaveBeenCalled();
  });

  it("el motivo del servidor sale debajo del botón de su fila, con el texto aprobado", async () => {
    const rechazo: AccionDeFormulario = () =>
      Promise.resolve({ error: errorDeCodigo("CATALOGO_PRODUCTO_CON_EXISTENCIA") });
    await render(tarjeta({ local: false, empresa: false }, TODO, { LOCAL: rechazo }));
    tocar(boton("Ocultar"));
    await expect.element(page.getByText("Primero dejá la existencia en 0.")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el teclado llega a cada botón en orden", async () => {
    await render(tarjeta({ local: false, empresa: false }));
    const recorrido: string[] = [];
    for (let i = 0; i < 2; i++) {
      await userEvent.tab();
      recorrido.push(document.activeElement?.textContent ?? "?");
    }
    expect(recorrido).toEqual(["Ocultar", "Ocultar en toda la empresa"]);
  });
});
