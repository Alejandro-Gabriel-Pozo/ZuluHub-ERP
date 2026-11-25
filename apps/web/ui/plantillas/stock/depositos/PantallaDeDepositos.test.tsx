import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../../patrones/FormularioDeAccion.cliente";
import { PantallaDeDepositos } from "./PantallaDeDepositos";
import type { FilaDeDeposito } from "./modelo-de-depositos";

/**
 * La lista de depósitos en Chromium (maquetas `stock.html` y `stock-depositos-gestion.html`): una tarjeta por depósito, los desactivados con su estado y «Reactivar», «Editar» y «Desactivar» solo
 * para quien tiene el permiso (sin él no se dibujan), y «Agregar depósito» apagado sin permiso.
 */
const TEXTOS = {
  agregar: "Agregar depósito",
  deVenta: "De venta",
  desactivado: "Desactivado",
  editar: "Editar",
  desactivar: "Desactivar",
  reactivar: "Reactivar",
};
const FILAS: readonly FilaDeDeposito[] = [
  { id: "d1", titulo: "Salón", uso: "Normal", deVenta: true, activo: true },
  { id: "d2", titulo: "Cocina", uso: "Normal", deVenta: false, activo: true },
  { id: "d3", titulo: "Depósito viejo", uso: "Normal", deVenta: false, activo: false },
];
const accion: AccionDeFormulario = () => Promise.resolve({ error: null });
const TODO = { editar: true, desactivar: true, reactivar: true };

const pantalla = (puede = TODO, puedeAgregar = true) => (
  <PantallaDeDepositos
    filas={FILAS}
    textos={TEXTOS}
    puede={puede}
    hrefDeEditar={(id) => `/stock/depositos/${id}/editar`}
    accionDeEstado={() => accion}
    puedeAgregar={puedeAgregar}
    hrefDeAgregar="/stock/depositos/nuevo"
  />
);

describe("PantallaDeDepositos", () => {
  it("con todos los permisos: «Editar» y «Desactivar» en los activos, «Reactivar» en el desactivado; es accesible", async () => {
    await render(pantalla());
    expect(page.getByRole("link", { name: "Editar" }).elements()).toHaveLength(2);
    expect(page.getByRole("button", { name: "Desactivar" }).elements()).toHaveLength(2);
    expect(page.getByRole("button", { name: "Reactivar" }).elements()).toHaveLength(1);
    await expect
      .element(page.getByRole("link", { name: "Editar" }).first())
      .toHaveAttribute("href", "/stock/depositos/d1/editar");
    await expect.element(page.getByText("Desactivado")).toBeVisible();
    await expect.element(page.getByText("De venta")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el desactivado no ofrece «Editar» ni «Desactivar»; los activos no ofrecen «Reactivar»", async () => {
    await render(pantalla({ editar: true, desactivar: true, reactivar: false }));
    expect(page.getByRole("button", { name: "Reactivar" }).elements()).toHaveLength(0);
    expect(page.getByRole("link", { name: "Editar" }).elements()).toHaveLength(2);
  });

  it("sin ningún permiso (quien opera) la lista se ve y no se dibuja ningún botón por fila", async () => {
    await render(pantalla({ editar: false, desactivar: false, reactivar: false }, false));
    await expect.element(page.getByText("Salón")).toBeVisible();
    await expect.element(page.getByText("Depósito viejo")).toBeVisible();
    expect(page.getByRole("link", { name: "Editar" }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Desactivar" }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Reactivar" }).elements()).toHaveLength(0);
    await expect.element(page.getByRole("button", { name: "Agregar depósito" })).toBeDisabled();
  });

  it("solo con «Reactivar» se ofrece en el desactivado y nada en los activos", async () => {
    await render(pantalla({ editar: false, desactivar: false, reactivar: true }));
    expect(page.getByRole("button", { name: "Reactivar" }).elements()).toHaveLength(1);
    expect(page.getByRole("button", { name: "Desactivar" }).elements()).toHaveLength(0);
  });
});
