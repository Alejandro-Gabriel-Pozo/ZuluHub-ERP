import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { verificarFoco, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { ArmazonDeOperacion } from "../sesion/ArmazonDeOperacion";
import { armarLaListaDeRecetas, type RecetasDeLaLista } from "./modelo-de-recetas";
import type { FiltroDeRecetas } from "./filtros-de-recetas";
import { PantallaDeListaDeRecetas } from "./PantallaDeListaDeRecetas";

/**
 * La lista de recetas en Chromium (maqueta `receta.html`, 15/11/2026), en el celular (390 px) y en escritorio (1280 px): axe como página sin violaciones (contraste incluido), nada de letra por
 * debajo de 16 px, controles de 48 px o más, sin desborde lateral, foco visible por teclado, los filtros como enlaces (con el actual marcado) y una tarjeta por producto que lleva a su ficha.
 */
const recetas: RecetasDeLaLista = {
  recetas: [
    {
      productoId: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
      nombre: "Pizza muzzarella",
      version: 3,
      costoPorUnidad: "300.500000",
    },
    {
      productoId: "1c0a7b2f-3d4e-4f60-9b8c-0d1e2f3a4b5c",
      nombre:
        "Milanesa napolitana con guarnición de papas fritas y un nombre larguísimo de la casa",
      version: 1,
      costoPorUnidad: "123456789.125000",
    },
    {
      productoId: "2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d",
      nombre: "Tarta de verdura",
      version: 2,
      costoPorUnidad: null,
    },
    { productoId: "3e2c9d4b-5f60-4b82-9dae-2f3a4b5c6d7e", nombre: "Flan", version: null },
  ],
  siguiente: "k",
};

const pantalla = (lista: RecetasDeLaLista = recetas, filtro: FiltroDeRecetas = "") => (
  <ArmazonDeOperacion
    titulo={texto({}, "receta.pantalla.recetas")}
    marca="Hotel del Lago"
    empresa="Café del Puerto"
    modulos={[]}
  >
    <PantallaDeListaDeRecetas lista={armarLaListaDeRecetas(lista, filtro)} />
  </ArmazonDeOperacion>
);

const visible = (el: Element): boolean =>
  el.closest("[hidden]") === null && el.checkVisibility({ visibilityProperty: true });

/** El alto de la ventana alcanza para toda la página: la barra inferior `sticky` no tapa lo que está más abajo (axe lo contaría como control tapado). */
const ventana = (ancho: number): Promise<void> => page.viewport(ancho, ancho < 800 ? 2600 : 1600);

/** Cada texto visible llega a 16 px, cada control visible a 48 px de alto y la página no se corre hacia el costado. */
function legibleYTocable(): void {
  const chicos: string[] = [];
  for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
    const tieneTexto = [...el.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
    );
    if (!tieneTexto || !visible(el)) continue;
    const tamano = Number.parseFloat(getComputedStyle(el).fontSize);
    if (tamano < 16) chicos.push(`${el.tagName.toLowerCase()} ${tamano}px: ${el.textContent}`);
  }
  expect(chicos).toEqual([]);
  const bajos: string[] = [];
  for (const el of document.body.querySelectorAll<HTMLElement>("button, a[href]")) {
    if (!visible(el)) continue;
    const alto = el.getBoundingClientRect().height;
    if (alto < 48) bajos.push(`${el.tagName.toLowerCase()} ${alto}px: ${el.textContent}`);
  }
  expect(bajos).toEqual([]);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}

const tarjetas = (): HTMLAnchorElement[] => [
  ...document.body.querySelectorAll<HTMLAnchorElement>("ul[class*=lista] a"),
];

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("lista de recetas", () => {
  it("en el celular: accesible como página, legible y tocable, con una tarjeta por producto", async () => {
    await ventana(390);
    await render(pantalla());
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    expect(document.body.querySelectorAll("h1")).toHaveLength(1);
    expect(tarjetas()).toHaveLength(4);
  });

  it("en escritorio: accesible como página, legible y tocable", async () => {
    await ventana(1280);
    await render(pantalla());
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
  });

  it("cada tarjeta dice el nombre y el costo de la comida a 2 decimales («Sin costo» si falta, «Sin receta» si no tiene) y lleva a su ficha", async () => {
    await render(pantalla());
    const [pizza, milanesa, tarta, flan] = tarjetas();
    expect(pizza?.textContent).toBe("Pizza muzzarella$ 300,50");
    expect(pizza?.getAttribute("href")).toBe(
      "/catalogo/recetas/0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
    );
    expect(milanesa?.textContent).toContain("$ 123.456.789,13");
    expect(tarta?.textContent).toBe("Tarta de verduraSin costo");
    expect(flan?.textContent).toBe("FlanSin receta");
  });

  it("el costo no desborda y se lee con peso fuerte; el nombre largo se corta en renglones", async () => {
    await render(pantalla());
    const costo = [...document.body.querySelectorAll<HTMLElement>("span")].find(
      (el) => el.textContent === "$ 123.456.789,13",
    ) as HTMLElement;
    expect(Number(getComputedStyle(costo).fontWeight)).toBeGreaterThanOrEqual(600);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it("los filtros son enlaces (no campos) a la lista, y el actual queda marcado", async () => {
    await render(pantalla());
    const filtros = [...document.body.querySelectorAll<HTMLAnchorElement>("ul[class*=filtros] a")];
    expect(filtros.map((f) => [f.textContent, f.getAttribute("href")])).toEqual([
      ["Todas", "/catalogo/recetas"],
      ["Sin receta", "/catalogo/recetas?receta=sin"],
    ]);
    expect(filtros.map((f) => f.getAttribute("aria-current"))).toEqual(["page", null]);
    expect(document.body.querySelectorAll("input, select, textarea, form, button")).toHaveLength(0);
  });

  it("con el filtro «Sin receta» el actual es el segundo y «Página siguiente» lo conserva", async () => {
    await render(pantalla(recetas, "sin"));
    const filtros = [...document.body.querySelectorAll<HTMLAnchorElement>("ul[class*=filtros] a")];
    expect(filtros.map((f) => f.getAttribute("aria-current"))).toEqual([null, "page"]);
    const siguiente = page.getByRole("link", { name: "Página siguiente" }).element();
    expect(siguiente.getAttribute("href")).toBe("/catalogo/recetas?receta=sin&despues=k");
  });

  it("sin recetas dice «Sin resultados» y no hay lista de tarjetas", async () => {
    await render(pantalla({ recetas: [], siguiente: null }));
    await expect.element(page.getByText("Sin resultados")).toBeVisible();
    expect(tarjetas()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });

  it("con el teclado: Tab llega a los filtros y a las tarjetas, con el foco visible", async () => {
    await render(pantalla());
    page.getByRole("link", { name: "Todas" }).element().focus();
    await verificarFoco(
      page.getByRole("link", { name: "Sin receta" }).first().element() as HTMLElement,
    );
    await verificarFoco(tarjetas()[0] as HTMLElement);
    expect(document.activeElement?.textContent).toContain("Pizza muzzarella");
  });

  it("si no se pudo leer la lista, muestra solo el error que llega ya pintado", async () => {
    await render(
      <PantallaDeListaDeRecetas
        lista={null}
        error={<p role="alert">Esta acción no está permitida</p>}
      />,
    );
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(document.body.querySelectorAll("a")).toHaveLength(0);
  });
});
