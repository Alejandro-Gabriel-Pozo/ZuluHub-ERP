import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { PantallaDeCuentasDeFotos } from "./PantallaDeCuentasDeFotos";
import { armarLasCuentasDeFotos } from "./modelo-de-cuentas-de-fotos";

/**
 * «Conectá tu cuenta de fotos» en Chromium: el campo de la cuenta y «Guardar», cada cuenta activa con su motivo y «Quitar»; lo que se envía al tocar, el doble toque (un solo envío), el error debajo,
 * axe, tamaños y sin desborde en 390 y 1280 px. Previene: un botón sin `"use client"` que no envía (React #441) y el doble clic que manda dos veces.
 */
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const CUENTAS = [
  { id: "c-1", cuenta: "mi-hotel", version: 1 },
  { id: "c-2", cuenta: "agencia_2", version: 4 },
];
const pantalla = (
  declarar: AccionDeFormulario = ok,
  retirar: Record<string, AccionDeFormulario> = { "c-1": ok, "c-2": ok },
  cuentas = CUENTAS,
) => (
  <PantallaDeCuentasDeFotos
    cuentas={armarLasCuentasDeFotos(cuentas)}
    accionDeDeclarar={declarar}
    accionesDeRetirar={retirar}
  />
);

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("PantallaDeCuentasDeFotos", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 900],
      [1280, 800],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(pantalla());
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });

  it("muestra el campo de la cuenta con «Guardar» y una fila por cuenta con su «Quitar»", async () => {
    await render(pantalla());
    await expect.element(page.getByLabelText("Pegá el nombre de tu cuenta")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Guardar" })).toBeEnabled();
    await expect.element(page.getByText("mi-hotel")).toBeVisible();
    await expect.element(page.getByText("agencia_2")).toBeVisible();
    expect(page.getByRole("button", { name: "Quitar" }).elements()).toHaveLength(2);
  });

  it("sin cuentas, solo queda el formulario de declarar", async () => {
    await render(pantalla(ok, {}, []));
    await expect.element(page.getByRole("button", { name: "Guardar" })).toBeVisible();
    expect(page.getByRole("button", { name: "Quitar" }).elements()).toHaveLength(0);
  });

  it("«Guardar» envía la cuenta escrita; el segundo toque no manda un segundo envío", async () => {
    let liberar: () => void = () => undefined;
    const enviados: string[] = [];
    const envio = vi.fn(async (_previo: unknown, datos: FormData) => {
      const valor = datos.get("cuenta");
      enviados.push(typeof valor === "string" ? valor : "");
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(pantalla(envio, {}, []));
    await userEvent.fill(page.getByLabelText("Pegá el nombre de tu cuenta"), "mi-hotel");
    const boton = page.getByRole("button", { name: "Guardar" });
    tocar(boton);
    await expect.element(boton).toHaveAttribute("aria-busy", "true");
    tocar(boton);
    tocar(boton);
    await vi.waitFor(() => expect(envio).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(boton).not.toHaveAttribute("aria-busy", "true");
    expect(envio).toHaveBeenCalledTimes(1);
    expect(enviados).toEqual(["mi-hotel"]);
  });

  it("«Quitar» envía el motivo de esa cuenta y no toca la otra", async () => {
    const primero = vi.fn(ok);
    const segundo = vi.fn(ok);
    await render(pantalla(ok, { "c-1": primero, "c-2": segundo }));
    const motivos = page.getByLabelText("Motivo").elements();
    expect(motivos).toHaveLength(2);
    await userEvent.fill(page.getByLabelText("Motivo").nth(1), "Cerramos la cuenta");
    await userEvent.click(page.getByRole("button", { name: "Quitar" }).nth(1));
    await vi.waitFor(() => expect(segundo).toHaveBeenCalledTimes(1));
    expect(primero).not.toHaveBeenCalled();
    expect(segundo.mock.calls[0]?.[1].get("motivo")).toBe("Cerramos la cuenta");
  });

  it("el error de la acción sale debajo del botón, con el texto genérico", async () => {
    const rechazo: AccionDeFormulario = () =>
      Promise.resolve({
        error: {
          codigo: "CATALOGO_ACCION_NO_PERMITIDA",
          clave: "catalogo.error.accion_no_permitida",
          presentacion: "AVISO",
        },
      });
    await render(pantalla(rechazo, {}, []));
    await userEvent.fill(page.getByLabelText("Pegá el nombre de tu cuenta"), "mi-hotel");
    await userEvent.click(page.getByRole("button", { name: "Guardar" }));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
  });
});
