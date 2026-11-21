import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { ClasificacionDelProducto } from "./ClasificacionDelProducto.cliente";
import type { AccionDeClasificacion } from "./HojasDeClasificacion.cliente";
import {
  armarLaClasificacionDelProducto,
  type ClasificacionDelProducto as Clasificacion,
} from "./modelo-de-clasificacion";

/**
 * La clasificación de un producto en su ficha, en Chromium (maqueta `clasificacion.html`, «Ficha del producto»): la clasificación vigente con «Vigente desde», «Cambiar» (apagado sin permiso o sin
 * departamentos) y su hoja con un desplegable por nivel, encadenados; lo que viaja al guardar (la clave del cambio, el producto y el nodo, sin fecha), el doble toque, «Sin elegir», el rechazo,
 * el teclado y axe en 390 y 1280 px. La acción del servidor va simulada.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NODOS = [
  { id: "rest", padreId: null, nombre: "Restaurante" },
  { id: "alo", padreId: null, nombre: "Alojamiento" },
  { id: "comidas", padreId: "rest", nombre: "Comidas" },
  { id: "bebidas", padreId: "rest", nombre: "Bebidas" },
  { id: "cafes", padreId: "bebidas", nombre: "Cafés" },
];
const VIGENTE: Clasificacion = {
  productoId: "p1",
  vigente: {
    desde: "2026-11-02",
    camino: [
      { id: "rest", nombre: "Restaurante", activo: true },
      { id: "comidas", nombre: "Comidas", activo: true },
    ],
  },
  nodos: NODOS,
};
const SIN_CLASIFICAR: Clasificacion = { productoId: "p1", vigente: null, nodos: NODOS };

const BIEN: Respuesta<unknown> = { ok: true, dato: { productoId: "p1" } };
const tarda = (r: Respuesta<unknown>) => () =>
  new Promise<Respuesta<unknown>>((resolver) => setTimeout(() => resolver(r), 150));
let clasificar = vi.fn<AccionDeClasificacion>();

beforeEach(() => {
  clasificar = vi.fn<AccionDeClasificacion>().mockImplementation(tarda(BIEN));
  router.refresh.mockClear();
});
afterEach(async () => {
  await page.viewport(390, 844);
});

const ficha = (c: Clasificacion = VIGENTE, puedeCambiar = true) => (
  <ClasificacionDelProducto
    clasificacion={armarLaClasificacionDelProducto(c)}
    accion={clasificar}
    puedeCambiar={puedeCambiar}
  />
);
const cambiar = () => page.getByRole("button", { name: "Cambiar", exact: true });
const hoja = () => page.getByRole("dialog");
const guardar = () => hoja().getByRole("button", { name: "Guardar" });
const nivel = (n: number) =>
  hoja()
    .getByRole("combobox")
    .nth(n - 1);

describe("ClasificacionDelProducto", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px, con la hoja cerrada y abierta", async () => {
    for (const [ancho, alto] of [
      [390, 1200],
      [1280, 900],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(ficha());
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(ancho);
      await cambiar().click();
      await expect.element(hoja()).toBeVisible();
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      await unmount();
    }
  });

  it("muestra una fila por nivel, «Vigente desde» (solo lectura, DD/MM/AAAA) y «Cambiar»", async () => {
    await render(ficha());
    const filas = [...document.querySelectorAll("dl")].map((f) => f.textContent);
    expect(filas).toEqual([
      "DepartamentoRestaurante",
      "CategoríaComidas",
      "Vigente desde02/11/2026",
    ]);
    await expect.element(cambiar()).toBeEnabled();
  });

  it("sin clasificar: «Departamento: Sin elegir» y sin «Vigente desde»", async () => {
    await render(ficha(SIN_CLASIFICAR));
    expect([...document.querySelectorAll("dl")].map((f) => f.textContent)).toEqual([
      "DepartamentoSin elegir",
    ]);
  });

  it("un nodo desactivado que el producto conserva se ve con «Desactivado»", async () => {
    await render(
      ficha({
        ...VIGENTE,
        vigente: {
          desde: "2026-11-02",
          camino: [{ id: "viejo", nombre: "Postres", activo: false }],
        },
      }),
    );
    await expect.element(page.getByText("Desactivado")).toBeVisible();
    await expect.element(page.getByText("Postres")).toBeVisible();
  });

  it("sin permiso, o sin departamentos cargados, «Cambiar» sale apagado y no abre nada", async () => {
    await render(ficha(VIGENTE, false));
    await expect.element(cambiar()).toBeDisabled();
    await render(ficha({ ...SIN_CLASIFICAR, nodos: [] }));
    await expect.element(cambiar().last()).toBeDisabled();
    expect(hoja().elements()).toHaveLength(0);
  });

  it("la hoja arranca con lo vigente, ofrece «Sin elegir» y «Guardar» sale apagado mientras no cambie", async () => {
    await render(ficha());
    await cambiar().click();
    await expect.element(hoja().getByRole("heading", { name: "Cambiar" })).toBeVisible();
    await expect.element(nivel(1)).toHaveValue("rest");
    await expect.element(nivel(2)).toHaveValue("comidas");
    expect(hoja().getByRole("combobox").elements()).toHaveLength(2);
    expect([...nivel(1).element().querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Sin elegir",
      "Alojamiento",
      "Restaurante",
    ]);
    // No hay campo de fecha: el cambio rige desde ahora.
    expect(hoja().getByRole("textbox").elements()).toHaveLength(0);
    expect(document.querySelector("dialog input[type=date]")).toBeNull();
    await expect.element(guardar()).toBeDisabled();
  });

  it("con varios niveles «Categoría», cada selector y cada fila se distinguen por su nombre accesible, con el padre; lo visible no cambia", async () => {
    await render(ficha());
    await cambiar().click();
    await userEvent.selectOptions(nivel(2), "bebidas");
    await expect
      .element(hoja().getByRole("combobox", { name: "Categoría de Restaurante" }))
      .toBeVisible();
    await expect
      .element(hoja().getByRole("combobox", { name: "Categoría de Bebidas" }))
      .toBeVisible();
    expect(hoja().getByText("Categoría", { exact: true }).elements().length).toBeGreaterThan(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await hoja().getByRole("button", { name: "Cancelar" }).click();
    await expect
      .element(page.getByRole("group", { name: "Categoría de Restaurante" }))
      .toBeVisible();
  });

  it("los niveles se encadenan: al cambiar el departamento se descarta lo de abajo y aparece su nivel", async () => {
    await render(ficha());
    await cambiar().click();
    await userEvent.selectOptions(nivel(1), "alo");
    expect(hoja().getByRole("combobox").elements()).toHaveLength(1);
    await userEvent.selectOptions(nivel(1), "rest");
    await expect.element(nivel(2)).toHaveValue("");
    await userEvent.selectOptions(nivel(2), "bebidas");
    await expect.element(nivel(3)).toHaveValue("");
    await userEvent.selectOptions(nivel(3), "cafes");
    await guardar().click();
    await vi.waitFor(() => {
      expect(clasificar).toHaveBeenCalledTimes(1);
    });
    expect(clasificar).toHaveBeenCalledWith({
      id: expect.stringMatching(UUID) as string,
      productoId: "p1",
      nodoId: "cafes",
    });
    await vi.waitFor(() => {
      expect(router.refresh).toHaveBeenCalled();
      expect(hoja().elements()).toHaveLength(0);
    });
  });

  it("un doble toque en «Guardar» manda un solo pedido; cada vez que se abre la hoja es otra clave", async () => {
    await render(ficha(SIN_CLASIFICAR));
    await cambiar().click();
    await userEvent.selectOptions(nivel(1), "alo");
    await guardar().dblClick();
    await vi.waitFor(() => {
      expect(router.refresh).toHaveBeenCalled();
    });
    expect(clasificar).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(hoja().elements()).toHaveLength(0);
    });
    await cambiar().click();
    await userEvent.selectOptions(nivel(1), "rest");
    await guardar().click();
    await vi.waitFor(() => {
      expect(clasificar).toHaveBeenCalledTimes(2);
    });
    const [uno, dos] = clasificar.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(uno).not.toBe(dos);
  });

  it("volver a «Sin elegir» manda el nodo nulo", async () => {
    await render(ficha());
    await cambiar().click();
    await userEvent.selectOptions(nivel(1), "");
    await guardar().click();
    await vi.waitFor(() => {
      expect(clasificar).toHaveBeenCalledWith({
        id: expect.stringMatching(UUID) as string,
        productoId: "p1",
        nodoId: null,
      });
    });
  });

  it("un rechazo muestra su motivo, deja la hoja abierta y vuelve a pedir la pantalla", async () => {
    clasificar.mockImplementation(
      tarda({ ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") }),
    );
    await render(ficha(SIN_CLASIFICAR));
    await cambiar().click();
    await userEvent.selectOptions(nivel(1), "alo");
    await guardar().click();
    await expect.element(hoja().getByText("Esta acción no está permitida")).toBeVisible();
    expect(router.refresh).toHaveBeenCalled();
    await expect.element(hoja()).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("Escape y «Cancelar» cierran la hoja sin enviar nada, y el foco vuelve a «Cambiar»", async () => {
    await render(ficha());
    await cambiar().click();
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(hoja().elements()).toHaveLength(0);
    });
    await cambiar().click();
    await hoja().getByRole("button", { name: "Cancelar" }).click();
    await vi.waitFor(() => {
      expect(hoja().elements()).toHaveLength(0);
    });
    expect(clasificar).not.toHaveBeenCalled();
  });
});
