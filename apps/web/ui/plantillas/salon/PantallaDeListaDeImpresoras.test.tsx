import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { PantallaDeListaDeImpresoras } from "./PantallaDeListaDeImpresoras";
import { armarLaListaDeImpresoras, type ImpresoraDeLaLista } from "./modelo-de-impresoras";

/**
 * La lista de impresoras en Chromium (maqueta `imprimir.html`): cada una con nombre, papel y uso, «Imprimir prueba» y «Quitar»; sin permiso el mensaje genérico y todo lo que cambia algo apagado (el operador ve la
 * lista y nada de administración); el doble toque en «Quitar» es un solo envío; axe y tamaños en 390 y 1280 px.
 */
const cocina: ImpresoraDeLaLista = {
  id: "11111111-1111-4111-8111-111111111111",
  nombre: "Cocina",
  uso: "COMANDA",
  papelMm: 80,
  activa: true,
  version: 1,
};
const caja: ImpresoraDeLaLista = {
  ...cocina,
  id: "22222222-2222-4222-8222-222222222222",
  nombre: "Caja",
  uso: "TICKET",
  papelMm: 58,
};
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });

afterEach(async () => {
  await page.viewport(390, 844);
});

const pantalla = (puede: boolean, accion: (id: string) => AccionDeFormulario = () => ok) => (
  <PantallaDeListaDeImpresoras
    lista={armarLaListaDeImpresoras([cocina, caja], puede)}
    accionDeQuitar={accion}
  />
);

describe("PantallaDeListaDeImpresoras", () => {
  it("quien administra ve cada impresora con su papel y su uso, y «Agregar impresora»; axe y tamaños en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 900],
      [1280, 800],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(pantalla(true));
      await expect
        .element(page.getByRole("link", { name: "Cocina" }))
        .toHaveAttribute("href", `/salon/impresoras/${cocina.id}`);
      await expect.element(page.getByText("80 mm")).toBeVisible();
      await expect.element(page.getByText("Ticket del cliente")).toBeVisible();
      await expect
        .element(page.getByRole("link", { name: "Agregar impresora" }))
        .toHaveAttribute("href", "/salon/impresoras/nueva");
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });

  it("SIN PERMISO: ve la lista y el mensaje genérico; no hay «Agregar impresora», el nombre no lleva a editar y «Quitar» está apagado", async () => {
    await render(pantalla(false));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    await expect.element(page.getByText("Cocina")).toBeVisible();
    expect(page.getByRole("link", { name: "Agregar impresora" }).elements()).toHaveLength(0);
    expect(page.getByRole("link", { name: "Cocina" }).elements()).toHaveLength(0);
    for (const quitar of page.getByRole("button", { name: "Quitar" }).elements())
      expect(quitar).toBeDisabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("DOBLE TOQUE en «Quitar»: un solo envío, y manda la acción ligada a ESA impresora", async () => {
    let liberar: () => void = () => undefined;
    const acciones: string[] = [];
    const accion =
      (id: string): AccionDeFormulario =>
      async () => {
        acciones.push(id);
        await new Promise<void>((r) => {
          liberar = r;
        });
        return { error: null };
      };
    await render(pantalla(true, accion));
    const quitar = page.getByRole("button", { name: "Quitar" }).first();
    tocar(quitar);
    await expect.element(quitar).toHaveAttribute("aria-busy", "true");
    tocar(quitar);
    tocar(quitar);
    await vi.waitFor(() => expect(acciones).toEqual([cocina.id]));
    liberar();
    await expect.element(quitar).not.toHaveAttribute("aria-busy", "true");
    expect(acciones).toEqual([cocina.id]);
  });

  it("sin impresoras dice «No hay impresoras» y ofrece «Agregar impresora» a quien administra", async () => {
    await render(
      <PantallaDeListaDeImpresoras
        lista={armarLaListaDeImpresoras([], true)}
        accionDeQuitar={() => ok}
      />,
    );
    await expect.element(page.getByText("No hay impresoras")).toBeVisible();
    await expect.element(page.getByRole("link", { name: "Agregar impresora" })).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("una lista que no se pudo cargar muestra solo el error", async () => {
    await render(
      <PantallaDeListaDeImpresoras lista={null} accionDeQuitar={() => ok} error={<p>falló</p>} />,
    );
    await expect.element(page.getByText("falló")).toBeVisible();
    expect(page.getByRole("button", { name: "Quitar" }).elements()).toHaveLength(0);
  });
});
