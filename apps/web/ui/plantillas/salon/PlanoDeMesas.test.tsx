import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { MEDIDAS_DE_PRUEBA } from "../../pruebas/ayudas-de-mesas";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { PlanoDeMesas } from "./PlanoDeMesas.cliente";
import { armarElPlano, conElBorrador } from "./modelo-del-plano";

/**
 * El mapa chico en Chromium (S-1b): rotulado «Plano», una mesa por casilla con su nombre para el lector de pantalla, enlaces que se alcanzan con el teclado, borrador distinguible sin color, y axe
 * en 390 y 1280 px.
 */
const mesa = (
  id: string,
  numero: number,
  columna: number,
  forma = "REDONDA",
  href: string | null = null,
) => ({
  id,
  numero,
  forma,
  tamano: "CHICA",
  columna,
  fila: 1,
  href,
});

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("PlanoDeMesas", () => {
  it("axe y tamaños en 390 y 1280 px, con una mesa de cada forma y el borrador", async () => {
    const base = armarElPlano({
      medidas: MEDIDAS_DE_PRUEBA,
      mesas: [
        mesa("a", 1, 1, "REDONDA", "/salon/mesas/a"),
        mesa("b", 2, 4, "CUADRADA", "/salon/mesas/b"),
        mesa("c", 3, 7, "LARGA"),
      ],
    });
    const plano = conElBorrador(
      base,
      MEDIDAS_DE_PRUEBA,
      { numero: "4", forma: "REDONDA", tamano: "MEDIANA", columna: "11", fila: "5" },
      "Agregar mesa",
    );
    for (const [ancho, alto] of [
      [390, 900],
      [1280, 800],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(<PlanoDeMesas plano={plano} />);
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });

  it("es una lista rotulada «Plano»; cada mesa dice su nombre y el borrador se distingue por el trazo", async () => {
    const plano = conElBorrador(
      armarElPlano({
        medidas: MEDIDAS_DE_PRUEBA,
        mesas: [mesa("a", 1, 1), mesa("c", 3, 7, "LARGA")],
      }),
      MEDIDAS_DE_PRUEBA,
      { numero: "", forma: "LARGA", tamano: "GRANDE", columna: "12", fila: "9" },
      "Agregar mesa",
    );
    await render(<PlanoDeMesas plano={plano} />);
    await expect.element(page.getByRole("list", { name: "Plano" })).toBeVisible();
    await expect.element(page.getByText("Mesa 1")).toBeInTheDocument();
    await expect.element(page.getByText("Mesa 3")).toBeInTheDocument();
    await expect.element(page.getByText("Agregar mesa")).toBeInTheDocument();
    const borrador = document.querySelector('[data-borrador="si"] > *');
    expect(borrador).not.toBeNull();
    expect(getComputedStyle(borrador as Element).borderTopStyle).toBe("dashed");
    const guardada = document.querySelector('[data-forma="LARGA"][data-borrador="no"] > *');
    expect(getComputedStyle(guardada as Element).borderTopStyle).toBe("solid");
  });

  it("la mesa redonda se dibuja como elipse y su borrador con trazo punteado", async () => {
    const plano = conElBorrador(
      armarElPlano({ medidas: MEDIDAS_DE_PRUEBA, mesas: [mesa("a", 1, 1)] }),
      MEDIDAS_DE_PRUEBA,
      { numero: "2", forma: "REDONDA", tamano: "CHICA", columna: "5", fila: "1" },
      "Agregar mesa",
    );
    await render(<PlanoDeMesas plano={plano} />);
    const trazo = (borrador: string) =>
      getComputedStyle(
        document.querySelector(
          `[data-forma="REDONDA"][data-borrador="${borrador}"] svg`,
        ) as Element,
      ).strokeDasharray;
    expect(trazo("no")).toBe("none");
    expect(trazo("si")).not.toBe("none");
  });

  it("teclado: Tab llega a cada mesa que es enlace, en orden, y no a las que no lo son", async () => {
    const plano = armarElPlano({
      medidas: MEDIDAS_DE_PRUEBA,
      mesas: [
        mesa("a", 1, 1, "REDONDA", "/salon/mesas/a"),
        mesa("b", 2, 4),
        mesa("c", 3, 7, "LARGA", "/salon/mesas/c"),
      ],
    });
    await render(<PlanoDeMesas plano={plano} />);
    const enlaces = page.getByRole("link");
    await expect.element(enlaces.first()).toHaveAttribute("href", "/salon/mesas/a");
    await userEvent.tab();
    expect(document.activeElement?.getAttribute("href")).toBe("/salon/mesas/a");
    await userEvent.tab();
    expect(document.activeElement?.getAttribute("href")).toBe("/salon/mesas/c");
  });

  it("las medidas llegan por CSSOM, sin atributo style en el HTML", async () => {
    const plano = armarElPlano({ medidas: MEDIDAS_DE_PRUEBA, mesas: [mesa("a", 1, 3)] });
    await render(<PlanoDeMesas plano={plano} />);
    const li = document.querySelector("li") as HTMLElement;
    expect(li.style.getPropertyValue("--izquierda")).toBe(`${String((2 / 14) * 100)}%`);
    expect((document.querySelector("ul") as HTMLElement).style.getPropertyValue("--columnas")).toBe(
      "14",
    );
  });
});
