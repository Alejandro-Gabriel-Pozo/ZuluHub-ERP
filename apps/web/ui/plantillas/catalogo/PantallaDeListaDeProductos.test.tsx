import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { verificarFoco, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { ArmazonDeOperacion } from "../sesion/ArmazonDeOperacion";
import {
  FILTROS_POR_DEFECTO,
  armarLosFiltros,
  type FiltrosDeProductos,
} from "./filtros-de-productos";
import { armarLaLista, type PaginaDeLaLista } from "./modelo-de-productos";
import { PantallaDeListaDeProductos } from "./PantallaDeListaDeProductos";

/**
 * La lista de productos en Chromium (maqueta `productos.html`, 12/11/2026), en el celular (390 px) y en escritorio (1280 px): axe como página sin violaciones (contraste incluido),
 * nada de letra por debajo de 16 px, controles de 48 px o más, sin desborde lateral, foco visible por teclado, el formulario de filtros que manda lo que se eligió, y las marcas
 * de estado y el precio de cada tarjeta.
 */
const pagina: PaginaDeLaLista = {
  productos: [
    {
      id: "a1",
      nombre: "Milanesa napolitana",
      claseDeUso: "VENDIBLE",
      estado: "ACTIVO",
      precio: { tipo: "EMPRESA", importe: "12345678901.50" },
    },
    {
      id: "a2",
      nombre: "Pizza muzzarella",
      claseDeUso: "VENDIBLE",
      estado: "ACTIVO",
      precio: { tipo: "SEGUN_TAMANO" },
    },
    {
      id: "a3",
      nombre: "Gaseosa de la casa de la esquina del puerto con un nombre larguísimo",
      claseDeUso: "REVENTA",
      estado: "FALTA_COMPLETAR",
      precio: { tipo: "SIN_PRECIO" },
    },
    {
      id: "a4",
      nombre: "Harina 000",
      claseDeUso: "MATERIA_PRIMA",
      estado: "DESACTIVADO",
      precio: null,
    },
  ],
  siguiente: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b:harina 000",
};

const pantalla = (filtros: FiltrosDeProductos = FILTROS_POR_DEFECTO, conPagina = pagina) => (
  <ArmazonDeOperacion
    titulo={texto({}, "catalogo.lista.titulo")}
    marca="Hotel del Lago"
    empresa="Café del Puerto"
    modulos={[]}
  >
    <PantallaDeListaDeProductos
      filtros={armarLosFiltros(filtros)}
      lista={armarLaLista(conPagina, filtros)}
    />
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
  for (const el of document.body.querySelectorAll<HTMLElement>(
    "button, a[href], select, input:not([type=hidden])",
  )) {
    if (!visible(el)) continue;
    const alto = el.getBoundingClientRect().height;
    if (alto < 48) bajos.push(`${el.tagName.toLowerCase()} ${alto}px: ${el.textContent}`);
  }
  expect(bajos).toEqual([]);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}

const lista = (): HTMLElement => document.body.querySelector("ul[class*=lista]") as HTMLElement;

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("lista de productos", () => {
  it("en el celular: accesible como página, legible y tocable, con una tarjeta por producto", async () => {
    await ventana(390);
    await render(pantalla());
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    expect(document.body.querySelectorAll("h1")).toHaveLength(1);
    expect(lista().querySelectorAll("li")).toHaveLength(4);
  });

  it("en escritorio: accesible como página, legible y tocable, y los filtros en una fila", async () => {
    await ventana(1280);
    await render(pantalla());
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    const buscar = page.getByLabelText("Buscar").element().getBoundingClientRect();
    const clase = page.getByLabelText("¿Qué es?").element().getBoundingClientRect();
    expect(Math.abs(buscar.top - clase.top)).toBeLessThan(2);
  });

  it("cada tarjeta dice su nombre, su marca de estado solo si corresponde, su clase y su precio", async () => {
    await render(pantalla());
    const [milanesa, pizza, gaseosa, harina] = [...lista().querySelectorAll("li")].map(
      (li) => li.textContent,
    );
    expect(milanesa).toBe("Milanesa napolitanaProducto vendible$ 12.345.678.901,50");
    expect(pizza).toBe("Pizza muzzarellaProducto vendibleSegún medida");
    expect(gaseosa).toContain("Falta completar");
    expect(gaseosa).toContain("Reventa");
    expect(gaseosa).toContain("Sin precio");
    expect(harina).toBe("Harina 000DesactivadoMateria prima");
    // «Activo» no lleva marca: la lista tiene exactamente dos.
    expect(lista().querySelectorAll("[data-tono]")).toHaveLength(2);
  });

  it("los importes no desbordan y se leen con peso fuerte", async () => {
    await render(pantalla());
    const importe = [...lista().querySelectorAll<HTMLElement>("span")].find((el) =>
      /^\$ /.test(el.textContent ?? ""),
    ) as HTMLElement;
    expect(Number(getComputedStyle(importe).fontWeight)).toBeGreaterThanOrEqual(600);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it("los filtros traen su valor de la dirección y cada campo tiene su etiqueta", async () => {
    await render(pantalla({ texto: "mila", clase: "VENDIBLE", estado: "FALTA_COMPLETAR" }));
    expect((page.getByLabelText("Buscar").element() as HTMLInputElement).value).toBe("mila");
    const clase = page.getByLabelText("¿Qué es?").element() as HTMLSelectElement;
    expect(clase.value).toBe("VENDIBLE");
    expect([...clase.options].map((o) => o.textContent)).toEqual([
      "Todos",
      "Materia prima",
      "Insumo",
      "Reventa",
      "Elaborado",
      "Producto vendible",
    ]);
    const estado = page.getByLabelText("Estado").element() as HTMLSelectElement;
    expect(estado.value).toBe("FALTA_COMPLETAR");
    expect([...estado.options].map((o) => o.textContent)).toEqual([
      "Todos",
      "Activo",
      "Falta completar",
      "Desactivado",
    ]);
  });

  it("el formulario es un GET a la lista y manda lo escrito y elegido por nombre de campo", async () => {
    await render(pantalla());
    const formulario = document.querySelector("form") as HTMLFormElement;
    expect(formulario.method).toBe("get");
    expect(new URL(formulario.action).pathname).toBe("/catalogo/productos");
    expect(formulario.getAttribute("role")).toBe("search");
    let enviado: string[][] = [];
    formulario.addEventListener("submit", (evento) => {
      evento.preventDefault();
      enviado = [...new FormData(formulario)].map(([k, v]) => [
        k,
        typeof v === "string" ? v : v.name,
      ]);
    });
    await userEvent.fill(page.getByLabelText("Buscar"), "pizza");
    await userEvent.selectOptions(page.getByLabelText("¿Qué es?"), "VENDIBLE");
    await userEvent.selectOptions(page.getByLabelText("Estado"), "DESACTIVADO");
    await userEvent.click(page.getByRole("button", { name: "Aplicar filtros" }));
    expect(enviado).toEqual([
      ["texto", "pizza"],
      ["clase", "VENDIBLE"],
      ["estado", "DESACTIVADO"],
    ]);
  });

  it("sin nada elegido manda los tres campos vacíos (todos)", async () => {
    await render(pantalla());
    const formulario = document.querySelector("form") as HTMLFormElement;
    let enviado: string[][] = [];
    formulario.addEventListener("submit", (evento) => {
      evento.preventDefault();
      enviado = [...new FormData(formulario)].map(([k, v]) => [
        k,
        typeof v === "string" ? v : v.name,
      ]);
    });
    await userEvent.click(page.getByRole("button", { name: "Aplicar filtros" }));
    expect(enviado).toEqual([
      ["texto", ""],
      ["clase", ""],
      ["estado", ""],
    ]);
  });

  it("el foco por teclado se ve en el buscador, los selectores, el botón y «Página siguiente»", async () => {
    await render(pantalla());
    const buscar = page.getByLabelText("Buscar").element() as HTMLElement;
    buscar.focus();
    for (const siguiente of [
      page.getByLabelText("¿Qué es?").element(),
      page.getByLabelText("Estado").element(),
      page.getByRole("button", { name: "Aplicar filtros" }).element(),
      page.getByRole("link", { name: "Página siguiente" }).element(),
    ]) {
      await verificarFoco(siguiente as HTMLElement);
    }
  });

  it("«Página siguiente» lleva a la página que sigue con los mismos filtros", async () => {
    await render(pantalla({ texto: "ha", clase: "", estado: "ACTIVO" }));
    const enlace = page.getByRole("link", { name: "Página siguiente" });
    const url = new URL((enlace.element() as HTMLAnchorElement).href);
    expect(url.pathname).toBe("/catalogo/productos");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      texto: "ha",
      estado: "ACTIVO",
      despues: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b:harina 000",
    });
  });

  it("en la última página no hay «Página siguiente»", async () => {
    await render(pantalla(FILTROS_POR_DEFECTO, { ...pagina, siguiente: null }));
    expect(page.getByRole("link", { name: "Página siguiente" }).elements()).toHaveLength(0);
  });

  it("una lista vacía no dice nada: sin tarjetas, sin avisos y accesible", async () => {
    await ventana(390);
    await render(pantalla(FILTROS_POR_DEFECTO, { productos: [], siguiente: null }));
    expect(document.querySelector("ul[class*=lista]")).toBeNull();
    expect(document.querySelector("[role=alert], [role=status]")).toBeNull();
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });
});
