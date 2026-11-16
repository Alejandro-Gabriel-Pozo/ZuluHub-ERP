import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { armarLasOpciones, type OpcionesDeLaPantalla } from "./modelo-de-opciones";
import { PantallaDeOpciones } from "./PantallaDeOpciones";

/**
 * Las opciones de un producto en Chromium (maqueta `productos.html`, solapa «Opciones»): las tarjetas, los enlaces de escribir (solo con permiso), el teclado y axe, y sin desborde en
 * 390 y 1280 px, también con nombres largos.
 */
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const OPCIONES: OpcionesDeLaPantalla = {
  id: ID,
  nombre: "Milanesa",
  versionDeOpciones: 4,
  claveDelCambio: "c",
  variante: null,
  grupos: [
    {
      id: "g1",
      nombre: "Salsas",
      clase: "ADICIONAL",
      esTamano: false,
      esObligatorio: false,
      admiteVarias: true,
      seMuestraEnCarta: true,
      opciones: [
        { id: "o1", nombre: "Mayonesa", recargo: "500.000000" },
        { id: "o2", nombre: "Ketchup", recargo: "0.000000" },
      ],
    },
    {
      id: "g2",
      nombre:
        "Guarnición con un nombre muy largo que tiene que cortarse en renglones sin desbordar",
      clase: "INCLUIDA",
      esTamano: false,
      esObligatorio: true,
      admiteVarias: false,
      seMuestraEnCarta: false,
      opciones: [
        { id: "o3", nombre: "Papas fritas rústicas con cáscara y hierbas", recargo: "0.00" },
      ],
    },
  ],
};

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("PantallaDeOpciones", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px, con y sin permiso de editar", async () => {
    for (const [ancho, alto] of [
      [390, 1200],
      [1280, 900],
    ] as const) {
      await page.viewport(ancho, alto);
      for (const puede of [true, false]) {
        const { unmount } = await render(
          <PantallaDeOpciones opciones={armarLasOpciones(OPCIONES, puede)} />,
        );
        expect(await violacionesDeAccesibilidad()).toEqual([]);
        legibleYTocable();
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(ancho);
        await unmount();
      }
    }
  });

  it("muestra los grupos con su clase, sus reglas y sus opciones con el recargo", async () => {
    await render(<PantallaDeOpciones opciones={armarLasOpciones(OPCIONES, true)} />);
    await expect.element(page.getByRole("heading", { name: "Grupos de opciones" })).toBeVisible();
    await expect.element(page.getByText("Mayonesa + $ 500,00 · Ketchup")).toBeVisible();
    await expect.element(page.getByText("(opcional)")).toBeVisible();
    await expect.element(page.getByText("(obligatorio) · no figura en la carta")).toBeVisible();
    await expect.element(page.getByText("Incluida")).toBeVisible();
    await expect.element(page.getByText("Adicional")).toBeVisible();
  });

  it("con permiso, los enlaces de «Copiar de otro producto», «Editar» (uno por grupo) y «Agregar grupo» llevan a su pantalla", async () => {
    await render(<PantallaDeOpciones opciones={armarLasOpciones(OPCIONES, true)} />);
    await expect
      .element(page.getByRole("link", { name: "Copiar de otro producto" }))
      .toHaveAttribute("href", `/catalogo/productos/${ID}/opciones/copiar`);
    await expect
      .element(page.getByRole("link", { name: "Agregar grupo" }))
      .toHaveAttribute("href", `/catalogo/productos/${ID}/opciones/nuevo`);
    expect(
      page
        .getByRole("link", { name: "Editar" })
        .elements()
        .map((e) => e.getAttribute("href")),
    ).toEqual([`/catalogo/productos/${ID}/opciones/g1`, `/catalogo/productos/${ID}/opciones/g2`]);
    expect(
      page
        .getByRole("link", { name: "Qué consume" })
        .elements()
        .map((e) => e.getAttribute("href")),
    ).toEqual([
      `/catalogo/productos/${ID}/opciones/g1/consumo`,
      `/catalogo/productos/${ID}/opciones/g2/consumo`,
    ]);
  });

  it("la variante: su tarjeta con «Es la medida» y «Editar»; sin variante, «Agregar variante»; sin permiso, ningún enlace", async () => {
    const variante = {
      id: "v1",
      nombre: "Tamaño del café",
      clase: "VARIANTE" as const,
      esTamano: true,
      esObligatorio: true,
      admiteVarias: false,
      seMuestraEnCarta: true,
      opciones: [
        { id: "a", nombre: "Chico", recargo: "0.000000" },
        { id: "b", nombre: "Grande", recargo: "0.000000" },
      ],
    };
    const { unmount } = await render(
      <PantallaDeOpciones opciones={armarLasOpciones({ ...OPCIONES, variante }, true)} />,
    );
    await expect.element(page.getByRole("heading", { name: "Variantes" })).toBeVisible();
    await expect.element(page.getByText("Es la medida")).toBeVisible();
    await expect.element(page.getByText("Chico · Grande")).toBeVisible();
    expect(page.getByRole("link", { name: "Agregar variante" }).elements()).toHaveLength(0);
    expect(
      page
        .getByRole("link", { name: "Editar" })
        .elements()
        .map((e) => e.getAttribute("href")),
    ).toContain(`/catalogo/productos/${ID}/opciones/variante`);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await unmount();
    await render(<PantallaDeOpciones opciones={armarLasOpciones(OPCIONES, true)} />);
    await expect
      .element(page.getByRole("link", { name: "Agregar variante" }))
      .toHaveAttribute("href", `/catalogo/productos/${ID}/opciones/variante`);
  });

  it("sin permiso no hay ningún enlace", async () => {
    await render(<PantallaDeOpciones opciones={armarLasOpciones(OPCIONES, false)} />);
    expect(document.querySelector("a")).toBeNull();
  });
});
