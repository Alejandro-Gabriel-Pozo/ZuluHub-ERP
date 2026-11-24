import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { verificarFoco, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { PantallaDeListaDelDirectorio } from "./PantallaDeListaDelDirectorio";
import {
  armarLaLista,
  armarLosFiltros,
  type FiltrosDelDirectorio,
  type PaginaDePartes,
} from "./modelo-de-directorio";

/**
 * La lista de clientes y proveedores en Chromium (maqueta `directorio.html`): las insignias de rol y «Desactivado», el vacío, «Nuevo» solo con permiso, el formulario de filtros que
 * manda lo que se eligió (con «Aplicar filtros»), foco por teclado y axe como página en 390 y 1280 px.
 */
const TODO = { crear: true, editar: true, desactivar: true, reactivar: true };
const SIN_FILTROS: FiltrosDelDirectorio = { texto: "", rol: "", desactivados: false };

const pagina: PaginaDePartes = {
  partes: [
    {
      id: "p1",
      nombre: "Gómez Marta",
      documento: { tipo: "DNI", pais: null, numero: "28123456" },
      roles: ["CUSTOMER"],
      activa: true,
    },
    {
      id: "p2",
      nombre: "Lácteos del Sur S.A.",
      documento: { tipo: "CUIT", pais: null, numero: "30701234563" },
      roles: ["CUSTOMER", "PROVEEDOR"],
      activa: false,
    },
  ],
  siguiente: "cursor-2",
};

afterEach(async () => {
  await page.viewport(390, 844);
});

const pantalla = (filtros = SIN_FILTROS, datos: PaginaDePartes = pagina, permisos = TODO) => (
  <PantallaDeListaDelDirectorio
    filtros={armarLosFiltros(filtros)}
    lista={armarLaLista(datos, filtros, permisos)}
  />
);

describe("PantallaDeListaDelDirectorio", () => {
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

  it("cada parte es un enlace a su ficha con su nombre, documento, insignias de rol y «Desactivado»", async () => {
    await render(pantalla());
    const enlaces = [...document.querySelectorAll<HTMLAnchorElement>("ul a")];
    expect(enlaces.map((a) => a.getAttribute("href"))).toEqual(["/clientes/p1", "/clientes/p2"]);
    expect(enlaces[0]?.textContent).toContain("Gómez Marta");
    expect(enlaces[0]?.textContent).toContain("DNI 28.123.456");
    expect(enlaces[0]?.textContent).toContain("Cliente");
    expect(enlaces[0]?.textContent).not.toContain("Desactivado");
    expect(enlaces[1]?.textContent).toContain("CUIT 30-70123456-3");
    expect(enlaces[1]?.textContent).toContain("Proveedor");
    expect(enlaces[1]?.textContent).toContain("Desactivado");
  });

  it("sin partes dice «Sin resultados»", async () => {
    await render(pantalla(SIN_FILTROS, { partes: [], siguiente: null }));
    await expect.element(page.getByText("Sin resultados")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Nuevo» y «Página siguiente» aparecen solo cuando corresponden", async () => {
    const con = await render(pantalla());
    await expect
      .element(page.getByRole("link", { name: "Nuevo" }))
      .toHaveAttribute("href", "/clientes/nuevo");
    await expect
      .element(page.getByRole("link", { name: "Página siguiente" }))
      .toHaveAttribute("href", "/clientes?despuesDe=cursor-2");
    await con.unmount();
    await render(pantalla(SIN_FILTROS, { ...pagina, siguiente: null }, { ...TODO, crear: false }));
    expect(page.getByRole("link", { name: "Nuevo" }).elements()).toHaveLength(0);
    expect(page.getByRole("link", { name: "Página siguiente" }).elements()).toHaveLength(0);
  });

  it("el formulario es de búsqueda, GET, y manda lo elegido con «Aplicar filtros» (la casilla manda `on`)", async () => {
    await render(pantalla({ texto: "ana", rol: "proveedor", desactivados: true }));
    const formulario = document.querySelector<HTMLFormElement>('form[role="search"]');
    expect(formulario?.method).toBe("get");
    expect(formulario?.getAttribute("action")).toBe("/clientes");
    const datos = new FormData(formulario ?? undefined);
    expect(Object.fromEntries(datos.entries())).toEqual({
      texto: "ana",
      rol: "proveedor",
      desactivados: "on",
    });
    await expect.element(page.getByRole("button", { name: "Aplicar filtros" })).toBeVisible();
  });

  it("el selector de rol ofrece Todos, Clientes y Proveedores y la casilla desmarcada no manda nada", async () => {
    await render(pantalla());
    const rol = page.getByLabelText("Roles").element() as HTMLSelectElement;
    expect([...rol.options].map((o) => [o.value, o.textContent])).toEqual([
      ["", "Todos"],
      ["cliente", "Clientes"],
      ["proveedor", "Proveedores"],
    ]);
    await userEvent.selectOptions(page.getByLabelText("Roles"), "cliente");
    const formulario = document.querySelector<HTMLFormElement>('form[role="search"]');
    expect(Object.fromEntries(new FormData(formulario ?? undefined).entries())).toEqual({
      texto: "",
      rol: "cliente",
    });
  });

  it("el foco con teclado se ve en los controles", async () => {
    await render(pantalla());
    await verificarFoco(page.getByLabelText("Buscar").element() as HTMLElement);
  });
});
