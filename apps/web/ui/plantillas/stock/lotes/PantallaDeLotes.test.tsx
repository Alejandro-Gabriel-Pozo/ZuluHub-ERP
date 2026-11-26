import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import { texto } from "../../../../../../src/capacidades/vocabulario/vocabulario";
import {
  armarLosLotes,
  armarLosVencimientos,
  type LotesDeLaComposicion,
  type VencimientosDeLaComposicion,
} from "./modelo-de-lotes";
import { PantallaDeLotes, PantallaDeVencimientos } from "./PantallaDeLotes";

/** La pestaña «Lotes» en Chromium (maqueta `stock-lotes.html`): el selector de artículos como enlaces, una tarjeta por lote con vencimiento (dd/mm/aaaa), existencia y disponible, «Sin asignar» sin fecha, y Vencimientos con su estado. */
const textoDe = (clave: Parameters<typeof texto>[1], valores?: Record<string, string>) =>
  texto({}, clave, valores);
const TEXTOS = {
  articulo: "Artículo",
  vencimientos: "Vencimientos",
  vence: "Vence",
  existencia: "Existencia",
  disponible: "Disponible",
};
const LOTES: LotesDeLaComposicion = {
  articulos: [
    { id: "a1", nombre: "Queso cremoso" },
    { id: "a2", nombre: "Pollo" },
  ],
  articuloId: "a1",
  unidadId: "KILOGRAMO",
  lotes: [
    {
      loteId: "l1",
      codigo: "Q-1104",
      vence: "2026-12-02",
      existencia: "3.0000",
      disponible: "3.0000",
      sinAsignar: false,
    },
    {
      loteId: "l2",
      codigo: "SIN_ASIGNAR",
      vence: null,
      existencia: "1.5000",
      disponible: "0.0000",
      sinAsignar: true,
    },
  ],
};
const VENCEN: VencimientosDeLaComposicion = {
  dias: 7,
  vencimientos: [
    {
      loteId: "l3",
      nombre: "Crema",
      codigo: "C-554",
      vence: "2026-11-24",
      existencia: "2.0000",
      unidadId: "KILOGRAMO",
      estado: "VENCIDO",
    },
    {
      loteId: "l1",
      nombre: "Queso cremoso",
      codigo: "Q-1104",
      vence: "2026-11-25",
      existencia: "3.0000",
      unidadId: "KILOGRAMO",
      estado: "VENCE_HOY",
    },
    {
      loteId: "l4",
      nombre: "Pollo entero",
      codigo: "P-88",
      vence: "2026-11-29",
      existencia: "8.0000",
      unidadId: "KILOGRAMO",
      estado: null,
    },
  ],
};

describe("PantallaDeLotes", () => {
  it("una tarjeta por lote con vencimiento, existencia y disponible; el «Sin asignar» sin fecha; accesible", async () => {
    await render(<PantallaDeLotes vista={armarLosLotes(LOTES, textoDe)} textos={TEXTOS} />);
    await expect.element(page.getByText("Q-1104")).toBeVisible();
    await expect.element(page.getByText("Vence 02/12/2026")).toBeVisible();
    await expect.element(page.getByText("Sin asignar")).toBeVisible();
    expect(page.getByText("Vence", { exact: false }).elements()).toHaveLength(1);
    expect(page.getByRole("listitem").elements().length).toBeGreaterThanOrEqual(4);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el selector lista los artículos como enlaces, marca el elegido y hay un enlace a Vencimientos", async () => {
    await render(<PantallaDeLotes vista={armarLosLotes(LOTES, textoDe)} textos={TEXTOS} />);
    await expect
      .element(page.getByRole("link", { name: "Pollo" }))
      .toHaveAttribute("href", "/stock/lotes?articulo=a2");
    await expect
      .element(page.getByRole("link", { name: "Queso cremoso" }))
      .toHaveAttribute("aria-current", "page");
    await expect
      .element(page.getByRole("link", { name: "Vencimientos" }))
      .toHaveAttribute("href", "/stock/lotes?vista=vencimientos");
  });
});

describe("PantallaDeLotes sin artículos controlados", () => {
  it("no deja un selector vacío: solo el enlace a Vencimientos", async () => {
    await render(
      <PantallaDeLotes
        vista={armarLosLotes(
          { articulos: [], articuloId: null, unidadId: null, lotes: [] },
          textoDe,
        )}
        textos={TEXTOS}
      />,
    );
    expect(page.getByRole("navigation").elements()).toHaveLength(0);
    await expect.element(page.getByRole("link", { name: "Vencimientos" })).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});

describe("PantallaDeVencimientos", () => {
  it("«Vencido» y «Vence hoy» con su estado; lo que vence después, sin estado; el horizonte aplicado marcado; accesible", async () => {
    await render(
      <PantallaDeVencimientos
        vista={armarLosVencimientos(VENCEN, textoDe)}
        titulo="Vencimientos"
        textos={TEXTOS}
      />,
    );
    await expect.element(page.getByText("Vencido")).toBeVisible();
    await expect.element(page.getByText("Vence hoy")).toBeVisible();
    expect(page.getByText("Pollo entero").elements()).toHaveLength(1);
    await expect
      .element(page.getByRole("link", { name: "Vence en los próximos 7 días" }))
      .toHaveAttribute("aria-current", "page");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});
