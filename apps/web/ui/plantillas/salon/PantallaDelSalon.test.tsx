import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { PantallaDelSalon } from "./PantallaDelSalon";
import { armarElMapa, type MesaDelMapaDeLaPantalla } from "./modelo-del-mapa";

/**
 * El mapa del salón en Chromium (SAL-A; maqueta `salon.html`): cada mesa con su estado dicho con ícono y texto (nunca solo color), su total en «$» con coma decimal, «Unida a la mesa N» y las cuentas de una mesa
 * dividida; los filtros son enlaces (el activo marcado, tocarlo de nuevo vuelve a todas); ninguna mesa es un enlace todavía; error sin lista; axe y tamaños en 390 y 1280 px.
 */
const ARS = (monto: string) => ({ moneda: "ARS", monto });
const MESAS: readonly MesaDelMapaDeLaPantalla[] = [
  { mesaId: "m1", numero: 1, estado: "LIBRE" },
  { mesaId: "m2", numero: 2, estado: "EN_PEDIDO", total: ARS("1500.00") },
  { mesaId: "m3", numero: 3, estado: "OCUPADA", total: ARS("32000.50") },
  { mesaId: "m4", numero: 4, estado: "UNIDA", unidaAMesa: 3 },
  {
    mesaId: "m5",
    numero: 5,
    estado: "OCUPADA",
    cuentasHijas: [
      { cuentaId: "c1", numero: 1, total: ARS("100.00") },
      { cuentaId: "c2", numero: 2, total: ARS("250.25") },
    ],
  },
];

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("PantallaDelSalon", () => {
  it("cada mesa dice su estado con texto y su total; la unida dice a cuál; la dividida lista sus cuentas; axe y tamaños en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 900],
      [1280, 800],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(<PantallaDelSalon mapa={armarElMapa({}, MESAS, null)} />);
      await expect.element(page.getByRole("list", { name: "Mesas" })).toBeVisible();
      await expect.element(page.getByText("Mesa 1")).toBeVisible();
      await expect.element(page.getByText("Libre", { exact: true })).toBeVisible();
      await expect.element(page.getByText("En pedido", { exact: true }).nth(1)).toBeVisible();
      await expect.element(page.getByText("$ 1.500,00")).toBeVisible();
      await expect.element(page.getByText("$ 32.000,50")).toBeVisible();
      await expect.element(page.getByText("Unida a la mesa 3")).toBeVisible();
      await expect.element(page.getByText("Cuenta 1 · $ 100,00")).toBeVisible();
      await expect.element(page.getByText("Cuenta 2 · $ 250,25")).toBeVisible();
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });

  it("los filtros son enlaces: sin filtro apuntan a su dirección; el activo está marcado y apunta a «todas»", async () => {
    const { unmount } = await render(<PantallaDelSalon mapa={armarElMapa({}, MESAS, null)} />);
    await expect
      .element(page.getByRole("link", { name: "Libres" }))
      .toHaveAttribute("href", "/salon?filtro=LIBRES");
    await expect
      .element(page.getByRole("link", { name: "Ocupadas" }))
      .toHaveAttribute("href", "/salon?filtro=OCUPADAS");
    await expect
      .element(page.getByRole("link", { name: "Libres" }))
      .not.toHaveAttribute("aria-current");
    await unmount();
    const conFiltro = await render(<PantallaDelSalon mapa={armarElMapa({}, [], "OCUPADAS")} />);
    const activo = page.getByRole("link", { name: "Ocupadas" });
    await expect.element(activo).toHaveAttribute("aria-current", "true");
    await expect.element(activo).toHaveAttribute("href", "/salon");
    await conFiltro.unmount();
  });

  it("ninguna mesa es un enlace todavía (su ficha es SAL-B): solo los tres filtros lo son", async () => {
    const { unmount } = await render(<PantallaDelSalon mapa={armarElMapa({}, MESAS, null)} />);
    expect(page.getByRole("link").elements()).toHaveLength(3);
    await unmount();
  });

  it("sin mesas (filtro sin resultados o sin ninguna cargada) queda la lista vacía sin texto nuevo", async () => {
    const { unmount } = await render(<PantallaDelSalon mapa={armarElMapa({}, [], "LIBRES")} />);
    expect(page.getByRole("listitem").elements()).toHaveLength(3); // solo los tres filtros
    await unmount();
  });

  it("si no se pudo leer, muestra el error y ni filtros ni mesas", async () => {
    const { unmount } = await render(
      <PantallaDelSalon mapa={null} error={<p role="alert">Esta acción no está permitida</p>} />,
    );
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Esta acción no está permitida");
    expect(page.getByRole("link").elements()).toHaveLength(0);
    await unmount();
  });
});
