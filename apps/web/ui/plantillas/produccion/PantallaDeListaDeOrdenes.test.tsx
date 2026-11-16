import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { verificarFoco, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { ArmazonDeOperacion } from "../sesion/ArmazonDeOperacion";
import { armarLaLista, type OrdenesDeLaLista } from "./modelo-de-ordenes";
import { PantallaDeListaDeOrdenes } from "./PantallaDeListaDeOrdenes";

/**
 * La lista de órdenes de producción en Chromium (maqueta `produccion.html`, 09/11/2026), en el celular (390 px) y en escritorio (1280 px): axe como página sin violaciones (contraste
 * incluido), nada de letra por debajo de 16 px, controles de 48 px o más, sin desborde lateral, foco visible por teclado, los filtros como enlaces (con el actual marcado) y una tarjeta por
 * orden que lleva a su ficha.
 */
const ordenes: OrdenesDeLaLista = {
  ordenes: [
    {
      id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
      numero: 14,
      estado: "ABIERTA",
      nombre: "Masa de medialuna",
      cantidad: "10.0000",
      unidadId: "KILOGRAMO",
    },
    {
      id: "1c0a7b2f-3d4e-4f60-9b8c-0d1e2f3a4b5c",
      numero: 13,
      estado: "CERRADA",
      nombre: "Medialuna rellena de dulce de leche con un nombre larguísimo de la casa",
      cantidad: "123456789.5000",
      unidadId: "UNIDAD",
    },
    {
      id: "2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d",
      numero: 12,
      estado: "CANCELADA",
      nombre: "Masa",
      cantidad: "5.0000",
      unidadId: "KILOGRAMO",
    },
    {
      id: "3e2c9d4b-5f60-4b82-9dae-2f3a4b5c6d7e",
      numero: 11,
      estado: "ANULADA",
      nombre: "Pan",
      cantidad: "1.0000",
      unidadId: "UNIDAD",
    },
  ],
};

const pantalla = (lista: OrdenesDeLaLista = ordenes, estado: "" | "ABIERTA" = "") => (
  <ArmazonDeOperacion
    titulo={texto({}, "produccion.pantalla.produccion")}
    marca="Hotel del Lago"
    empresa="Café del Puerto"
    modulos={[]}
  >
    <PantallaDeListaDeOrdenes lista={armarLaLista(lista, estado)} />
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

describe("lista de órdenes de producción", () => {
  it("en el celular: accesible como página, legible y tocable, con una tarjeta por orden", async () => {
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

  it("cada tarjeta dice «Orden N · producto», su cantidad con unidad y su estado en texto, y lleva a su ficha", async () => {
    await render(pantalla());
    const [masa, medialuna, cancelada, anulada] = tarjetas();
    expect(masa?.textContent).toBe("Orden 14 · Masa de medialuna10 KilogramoAbierta");
    expect(masa?.getAttribute("href")).toBe(
      "/catalogo/produccion/0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
    );
    expect(medialuna?.textContent).toContain("123.456.789,5 Unidad");
    expect(medialuna?.textContent).toContain("Cerrada");
    expect(cancelada?.textContent).toContain("Cancelada");
    expect(anulada?.textContent).toContain("Anulada");
    // El estado nunca se dice solo con color: cada marca lleva su texto y su ícono.
    expect(document.body.querySelectorAll("ul[class*=lista] [data-tono]")).toHaveLength(4);
  });

  it("las cantidades no desbordan y se leen con peso fuerte; el nombre largo se corta en renglones", async () => {
    await render(pantalla());
    const cantidad = [...document.body.querySelectorAll<HTMLElement>("span")].find(
      (el) => el.textContent === "123.456.789,5 Unidad",
    ) as HTMLElement;
    expect(Number(getComputedStyle(cantidad).fontWeight)).toBeGreaterThanOrEqual(600);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it("los filtros son enlaces (no campos) a la lista, y el actual queda marcado", async () => {
    await render(pantalla());
    const filtros = [...document.body.querySelectorAll<HTMLAnchorElement>("ul[class*=filtros] a")];
    expect(filtros.map((f) => [f.textContent, f.getAttribute("href")])).toEqual([
      ["Todas", "/catalogo/produccion"],
      ["Abierta", "/catalogo/produccion?estado=ABIERTA"],
    ]);
    expect(filtros.map((f) => f.getAttribute("aria-current"))).toEqual(["page", null]);
    expect(document.body.querySelectorAll("input, select, textarea, form")).toHaveLength(0);
  });

  it("con el filtro «Abiertas» el actual es el segundo", async () => {
    await render(pantalla(ordenes, "ABIERTA"));
    const filtros = [...document.body.querySelectorAll<HTMLAnchorElement>("ul[class*=filtros] a")];
    expect(filtros.map((f) => f.getAttribute("aria-current"))).toEqual([null, "page"]);
  });

  it("sin órdenes dice «Sin resultados» y no hay lista de tarjetas", async () => {
    await render(pantalla({ ordenes: [] }));
    await expect.element(page.getByText("Sin resultados")).toBeVisible();
    expect(tarjetas()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });

  it("con el teclado: Tab llega a los filtros y a las tarjetas, con el foco visible", async () => {
    await render(pantalla());
    page.getByRole("link", { name: "Todas" }).element().focus();
    await verificarFoco(page.getByRole("link", { name: "Abierta" }).element());
    await verificarFoco(tarjetas()[0] as HTMLElement);
    expect(document.activeElement?.textContent).toContain("Orden 14");
  });

  it("si no se pudo leer la lista, muestra solo el error que llega ya pintado", async () => {
    await render(
      <PantallaDeListaDeOrdenes
        lista={null}
        error={<p role="alert">Esta acción no está permitida</p>}
      />,
    );
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(document.body.querySelectorAll("a")).toHaveLength(0);
  });
});
