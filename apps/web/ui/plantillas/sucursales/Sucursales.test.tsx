import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { ArmazonDeOperacion } from "../sesion/ArmazonDeOperacion";
import { FormularioDeAltaDeSucursal } from "./FormularioDeAltaDeSucursal.cliente";
import {
  armarElFormularioDeAltaDeSucursal,
  armarLaListaDeSucursales,
  type SucursalParaLaPantalla,
} from "./modelo-de-sucursales";
import { PantallaDeListaDeSucursales } from "./PantallaDeListaDeSucursales";

/**
 * «Sucursales» en Chromium real: la lista sin violaciones graves de accesibilidad, solo con el nombre de cada sucursal (sin estados) y con «Nueva sucursal» únicamente para quien puede crear; el alta manda SOLO el
 * nombre y un doble toque es un solo envío. Previene: un botón que se dibuja sin permiso y un envío doble.
 */
const S = (n: number) => `0b0b0b0b-1111-4222-8333-44444444444${n}`;
const sucursal = (n: number, nombre: string): SucursalParaLaPantalla => ({ id: S(n), nombre });

const conArmazon = (hijo: React.ReactNode) => (
  <ArmazonDeOperacion titulo="Sucursales" marca="Zulú Pan" empresa="Lácteos del Sur">
    {hijo}
  </ArmazonDeOperacion>
);

/** Una acción de servidor falsa que anota cada pedido (lo que mandó el formulario) y tarda un poco, para probar el doble toque. */
function accionQueAnota() {
  const pedidos: Record<string, string[]>[] = [];
  const accion: AccionDeFormulario = async (_previo, datos) => {
    const lectura: Record<string, string[]> = {};
    for (const [k, v] of datos.entries())
      (lectura[k] ??= []).push(typeof v === "string" ? v : "(archivo)");
    pedidos.push(lectura);
    await new Promise((r) => setTimeout(r, 150));
    return { error: null };
  };
  return { accion, pedidos };
}

describe("PantallaDeListaDeSucursales", () => {
  it("sin violaciones graves de accesibilidad; cada sucursal es solo su nombre; «Nueva sucursal» lleva al alta", async () => {
    const lista = armarLaListaDeSucursales(
      [sucursal(1, "Casa Central"), sucursal(2, "Centro")],
      {},
      true,
    );
    await render(conArmazon(<PantallaDeListaDeSucursales lista={lista} />));
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await expect.element(page.getByText("Casa Central")).toBeVisible();
    await expect.element(page.getByText("Centro")).toBeVisible();
    expect(page.getByText("Desactivada").elements()).toHaveLength(0);
    await expect
      .element(page.getByRole("link", { name: "Nueva sucursal" }))
      .toHaveAttribute("href", "/cuenta/sucursales/nueva");
  });

  it("sin permiso de crear no se dibuja «Nueva sucursal»", async () => {
    const lista = armarLaListaDeSucursales([sucursal(1, "Casa Central")], {}, false);
    await render(conArmazon(<PantallaDeListaDeSucursales lista={lista} />));
    await expect.element(page.getByText("Casa Central")).toBeVisible();
    expect(page.getByRole("link", { name: "Nueva sucursal" }).elements()).toHaveLength(0);
  });
});

describe("FormularioDeAltaDeSucursal", () => {
  it("manda solo el nombre y un doble toque es un solo envío", async () => {
    const { accion, pedidos } = accionQueAnota();
    await render(
      conArmazon(
        <FormularioDeAltaDeSucursal
          formulario={armarElFormularioDeAltaDeSucursal({})}
          accion={accion}
          rutaDeLaLista="/cuenta/sucursales"
        />,
      ),
    );
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await page.getByLabelText("Nombre").fill("Terminal");
    await page.getByRole("button", { name: "Guardar" }).dblClick();
    await expect.poll(() => pedidos.length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 400));
    expect(pedidos).toEqual([{ nombre: ["Terminal"] }]);
    await expect
      .element(page.getByRole("link", { name: "Cancelar" }))
      .toHaveAttribute("href", "/cuenta/sucursales");
  });
});
