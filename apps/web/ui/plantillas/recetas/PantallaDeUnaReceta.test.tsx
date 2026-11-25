import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { verificarFoco, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { ArmazonDeOperacion } from "../sesion/ArmazonDeOperacion";
import { armarLaCocina, armarLaReceta, type RecetaDeLaFicha } from "./modelo-de-receta";
import { PantallaDeFichaDeCocina } from "./PantallaDeFichaDeCocina";
import { PantallaDeUnaReceta } from "./PantallaDeUnaReceta";

/**
 * La ficha de una receta y la ficha de cocina en Chromium (maqueta `receta.html`, 15/11/2026), en el celular (390 px) y en escritorio (1280 px): axe como página sin violaciones (contraste
 * incluido), letra de 16 px o más, enlaces de 48 px o más, sin desborde lateral, foco visible, y lo que se ve: versión, rinde, costo de la comida, ingredientes con bruto, merma y neto,
 * pasos; sin costos cuando la consulta no los trajo; la cocina sin costos.
 */
const receta = (conCostos = true): RecetaDeLaFicha => ({
  producto: { id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b", nombre: "Pizza muzzarella" },
  ficha: {
    version: 3,
    esLaVigente: true,
    rinde: "10.0000",
    pasos:
      "Amasar, dejar levar dos horas, estirar, salsear y hornear a fuego fuerte hasta que el borde dore bien.",
    componentes: [
      {
        numero: 1,
        nombre: "Harina 000",
        clase: "MATERIA_PRIMA",
        bruto: "2.5000",
        unidadId: "KILOGRAMO",
        merma: "0.0000",
        neto: "2.5000",
        ...(conCostos ? { costo: "1500.000000" } : {}),
      },
      {
        numero: 2,
        nombre: "Tomate triturado de una marca con un nombre larguísimo",
        clase: "MATERIA_PRIMA",
        bruto: "1.0000",
        unidadId: "KILOGRAMO",
        merma: "12.5000",
        neto: "0.8750",
        ...(conCostos ? { costo: null } : {}),
      },
    ],
    ...(conCostos ? { costos: { porUnidad: "300.500000", incompleto: false } } : {}),
  },
});

const armazon = (titulo: string, hijo: React.ReactNode) => (
  <ArmazonDeOperacion titulo={titulo} marca="Hotel del Lago" empresa="Café del Puerto" modulos={[]}>
    {hijo}
  </ArmazonDeOperacion>
);
const pantallaDeLaReceta = (r: RecetaDeLaFicha) =>
  armazon(r.producto.nombre, <PantallaDeUnaReceta receta={armarLaReceta(r)} />);
const pantallaDeLaCocina = () =>
  armazon(
    texto({}, "receta.ficha_de_cocina.titulo"),
    <PantallaDeFichaDeCocina
      cocina={armarLaCocina("Pizza muzzarella", {
        version: 3,
        rinde: "10.0000",
        pasos: "Amasar y hornear.",
        componentes: [
          { productoId: "p1", nombre: "Harina 000", cantidad: "2.5000", unidadId: "KILOGRAMO" },
          { productoId: "p2", nombre: "Tomate", cantidad: "1.0000", unidadId: "KILOGRAMO" },
        ],
      })}
    />,
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

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("ficha de una receta", () => {
  it("en el celular: accesible como página, legible y tocable, con un solo h1", async () => {
    await ventana(390);
    await render(pantallaDeLaReceta(receta()));
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
    expect(document.body.querySelectorAll("h1")).toHaveLength(1);
  });

  it("en escritorio: accesible como página, legible y tocable", async () => {
    await ventana(1280);
    await render(pantallaDeLaReceta(receta()));
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
  });

  it("dice la versión, el rinde, el costo de la comida, los ingredientes con su costo, la merma y el neto, y los pasos", async () => {
    await render(pantallaDeLaReceta(receta()));
    const cuerpo = document.body.textContent ?? "";
    expect(cuerpo).toContain("Versión 3 · vigente");
    expect(cuerpo).toContain("Rinde10");
    expect(cuerpo).toContain("Costo de la comida$ 300,50");
    expect(cuerpo).toContain("Harina 000$ 1.500,00");
    expect(cuerpo).toContain("Materia prima · Bruto 2,5 Kilogramo");
    expect(cuerpo).toContain("Tomate triturado de una marca con un nombre larguísimoSin costo");
    expect(cuerpo).toContain("Bruto 1 Kilogramo · Merma 12,5 % · Neto 0,875 Kilogramo");
    expect(cuerpo).toContain("Pasos");
    expect(cuerpo).toContain("Amasar, dejar levar dos horas");
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it("sin costos en la consulta (un operador) no hay costos ni huecos", async () => {
    await render(pantallaDeLaReceta(receta(false)));
    const cuerpo = document.body.textContent ?? "";
    expect(cuerpo).toContain("Harina 000");
    expect(cuerpo).not.toMatch(/\$|Costo de la comida|Sin costo/);
  });

  it("el enlace a la ficha de cocina lleva a su dirección y se alcanza con el teclado", async () => {
    await render(pantallaDeLaReceta(receta()));
    const enlace = page
      .getByRole("link", { name: "Ficha de cocina" })
      .first()
      .element() as HTMLAnchorElement;
    expect(enlace.getAttribute("href")).toBe(
      "/catalogo/recetas/0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b/cocina",
    );
    // El foco parte del control que lo precede en el orden de la página: el siguiente Tab tiene que llegar al enlace, con el foco visible.
    const controles = [...document.body.querySelectorAll<HTMLElement>("a[href], button")];
    const anterior = controles[controles.indexOf(enlace) - 1];
    anterior?.focus();
    await verificarFoco(enlace);
  });

  it("un producto sin receta dice «Este producto no tiene receta», sin ingredientes ni enlaces de la receta", async () => {
    await render(pantallaDeLaReceta({ producto: receta().producto, ficha: null }));
    await expect.element(page.getByText("Este producto no tiene receta")).toBeVisible();
    expect(document.body.textContent).not.toContain("Ingredientes");
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });
});

describe("ficha de cocina", () => {
  it("en el celular: accesible como página, legible y tocable", async () => {
    await ventana(390);
    await render(pantallaDeLaCocina());
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
  });

  it("en escritorio: accesible como página, legible y tocable", async () => {
    await ventana(1280);
    await render(pantallaDeLaCocina());
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    legibleYTocable();
  });

  it("dice el rinde, la versión, la cantidad bruta de cada ingrediente y los pasos, sin costos ni precios", async () => {
    await render(pantallaDeLaCocina());
    const cuerpo = document.body.textContent ?? "";
    expect(cuerpo).toContain("Rinde 10 · Versión 3");
    expect(cuerpo).toContain("Harina 0002,5 Kilogramo");
    expect(cuerpo).toContain("Tomate1 Kilogramo");
    expect(cuerpo).toContain("Amasar y hornear.");
    expect(cuerpo).not.toMatch(/\$|Costo|Precio|Imprimir/);
    expect(document.body.querySelectorAll("button, input, form")).toHaveLength(0);
  });
});
