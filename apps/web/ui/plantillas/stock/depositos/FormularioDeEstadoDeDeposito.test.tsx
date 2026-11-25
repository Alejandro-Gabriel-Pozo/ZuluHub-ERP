import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { tocar, violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../../patrones/FormularioDeAccion.cliente";
import { FormularioDeEstadoDeDeposito } from "./FormularioDeEstadoDeDeposito.cliente";

/**
 * «Desactivar» y «Reactivar» un depósito en Chromium (maqueta `stock-depositos-gestion.html`, 25/11/2026): un botón sin campos y sin confirmación; el doble toque manda un solo envío; el motivo del
 * rechazo del servidor (es el de venta, tiene existencia, hay un conteo abierto) sale debajo, anunciado.
 */
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });

describe("FormularioDeEstadoDeDeposito", () => {
  it("dibuja el botón con el texto que llega y es accesible", async () => {
    await render(<FormularioDeEstadoDeDeposito texto="Desactivar" accion={ok} />);
    await expect.element(page.getByRole("button", { name: "Desactivar" })).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("un toque envía una vez, sin campos; el doble toque no duplica", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (_previo: unknown, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(<FormularioDeEstadoDeDeposito texto="Reactivar" accion={accion} />);
    const boton = page.getByRole("button", { name: "Reactivar" });
    tocar(boton);
    await expect.element(boton).toHaveAttribute("aria-busy", "true");
    tocar(boton);
    tocar(boton);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(boton).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
    expect([...(accion.mock.calls[0]?.[1] as FormData).keys()]).toEqual([]);
  });

  it.each([
    [
      "STOCK_ES_EL_DE_VENTA",
      "stock.error.es_el_de_venta",
      "No se puede desactivar el depósito de venta",
    ],
    [
      "STOCK_DEPOSITO_CON_EXISTENCIA",
      "stock.error.deposito_con_existencia",
      "El depósito tiene existencia",
    ],
    [
      "STOCK_CONTEO_EN_CURSO",
      "stock.error.conteo_en_curso",
      "Ya hay un conteo abierto en este depósito",
    ],
  ])(
    "el rechazo %s sale debajo con su texto, anunciado, y es accesible",
    async (codigo, clave, texto) => {
      const rechazo: AccionDeFormulario = () =>
        Promise.resolve({ error: { codigo, clave, presentacion: "AVISO" } as never });
      await render(<FormularioDeEstadoDeDeposito texto="Desactivar" accion={rechazo} />);
      tocar(page.getByRole("button", { name: "Desactivar" }));
      await expect.element(page.getByRole("alert")).toBeVisible();
      await expect.element(page.getByText(texto)).toBeVisible();
      expect(await violacionesDeAccesibilidad()).toEqual([]);
    },
  );
});
