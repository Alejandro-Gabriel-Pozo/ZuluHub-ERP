import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeClasificacion } from "./HojasDeClasificacion.cliente";
import { PantallaDeClasificacion } from "./PantallaDeClasificacion.cliente";
import { armarElArbol, type NodoDelArbol } from "./modelo-de-clasificacion";

/**
 * La clasificación comercial en Chromium (maqueta `clasificacion.html`): el árbol desplegado, plegar y desplegar, las hojas de Crear, Renombrar, Mover y las acciones de un nodo (Desactivar y
 * Reactivar al tocar), lo que viaja en cada pedido (la clave del alta, la versión que se vio), el doble toque, el motivo del rechazo, el teclado y axe en 390 y 1280 px. Las acciones del servidor van simuladas.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const nodo = (
  id: string,
  nombre: string,
  padreId: string | null,
  nivel: number,
  extra: Partial<NodoDelArbol> = {},
): NodoDelArbol => ({
  id,
  padreId,
  nombre,
  activo: true,
  version: 1,
  nivel,
  admiteHijos: true,
  destinos: [],
  ...extra,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NODOS: readonly NodoDelArbol[] = [
  nodo("rest", "Restaurante", null, 1),
  nodo("alo", "Alojamiento", null, 1),
  nodo("bebidas", "Bebidas", "rest", 2, { version: 4, destinos: ["alo", "rest"] }),
  nodo("cafes", "Cafés", "bebidas", 3, {
    version: 2,
    destinos: ["alo", "rest"],
    admiteHijos: true,
  }),
  nodo("postres", "Postres", "rest", 2, { activo: false, destinos: [] }),
  nodo("hoja", "Hoja", "cafes", 4, { admiteHijos: false }),
];

const BIEN: Respuesta<unknown> = { ok: true, dato: { nodoId: "x" } };
const GENERICO: Respuesta<unknown> = {
  ok: false,
  error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA"),
};
const HIJOS: Respuesta<unknown> = {
  ok: false,
  error: errorDeCodigo("CATALOGO_PRIMERO_DESACTIVA"),
};

/** Tarda un poco en contestar, como la red real: el doble toque llega con el primer pedido todavía en vuelo. */
const tarda = (r: Respuesta<unknown>) => () =>
  new Promise<Respuesta<unknown>>((resolver) => setTimeout(() => resolver(r), 150));
const accion = () => vi.fn<AccionDeClasificacion>().mockImplementation(tarda(BIEN));
const acciones = () => ({
  crear: accion(),
  renombrar: accion(),
  mover: accion(),
  desactivar: accion(),
  reactivar: accion(),
});
let a = acciones();

beforeEach(() => {
  a = acciones();
  router.refresh.mockClear();
});
afterEach(async () => {
  await page.viewport(390, 844);
});

const pantalla = (nodos: readonly NodoDelArbol[] = NODOS) => (
  <PantallaDeClasificacion arbol={armarElArbol(nodos)} acciones={a} />
);
// Cada fila con hijos tiene dos botones con el nombre del nodo: el que pliega (primero) y el que abre sus acciones (el último).
// Un nodo desactivado suma «Desactivado» a su nombre accesible: se busca por el principio.
const fila = (nombre: string) =>
  page.getByRole("button", { name: new RegExp(`^${nombre}`) }).last();
const hoja = () => page.getByRole("dialog");
const guardar = () => hoja().getByRole("button", { name: "Guardar" });
const nombreCampo = () => hoja().getByRole("textbox", { name: "Nombre" });

describe("PantallaDeClasificacion", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px, con el árbol y con una hoja abierta", async () => {
    for (const [ancho, alto] of [
      [390, 1200],
      [1280, 900],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(pantalla());
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(ancho);
      await fila("Restaurante").click();
      await expect.element(hoja()).toBeVisible();
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      await unmount();
    }
  });

  it("el árbol arranca desplegado, los hermanos van por nombre y lo desactivado se marca", async () => {
    await render(pantalla());
    const nombres = page.getByRole("list").getByRole("listitem");
    await expect.element(nombres.first()).toHaveTextContent("Alojamiento");
    expect(
      nombres.elements().map((e) => e.textContent?.replace("▾", "").replace("▸", "").trim()),
    ).toEqual(["Alojamiento", "Restaurante", "Bebidas", "Cafés", "Hoja", "PostresDesactivado"]);
    await expect.element(fila("Restaurante")).toBeVisible();
  });

  it("sin departamentos solo ofrece «Crear», sin lista ni texto de estado vacío", async () => {
    await render(pantalla([]));
    await expect.element(page.getByRole("button", { name: "Crear" })).toBeVisible();
    expect(page.getByRole("list").elements()).toHaveLength(0);
    expect(document.body.textContent?.trim()).toBe("Crear");
  });

  it("plegar un nodo esconde lo que tiene adentro y desplegarlo lo vuelve a mostrar", async () => {
    await render(pantalla());
    const plegar = page.getByRole("button", { name: "Restaurante", expanded: true });
    await plegar.click();
    expect(page.getByRole("button", { name: "Bebidas", exact: true }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Cafés", exact: true }).elements()).toHaveLength(0);
    await expect.element(fila("Alojamiento")).toBeVisible();
    await page.getByRole("button", { name: "Restaurante", expanded: false }).click();
    await expect.element(fila("Cafés")).toBeVisible();
  });

  describe("crear", () => {
    it("el «Crear» de arriba agrega un departamento: lleva la clave del alta, ningún padre y el nombre", async () => {
      await render(pantalla());
      await page.getByRole("button", { name: "Crear", exact: true }).click();
      await expect.element(hoja()).toBeVisible();
      await expect.element(hoja().getByRole("heading", { name: "Crear" })).toBeVisible();
      await expect.element(hoja().getByText("Departamento")).toBeVisible();
      await expect.element(guardar()).toBeDisabled();
      await userEvent.fill(nombreCampo(), "  Eventos ");
      await guardar().click();
      await vi.waitFor(() => {
        expect(a.crear).toHaveBeenCalledTimes(1);
      });
      const pedido = a.crear.mock.calls[0]?.[0] as { id: string; padreId: null; nombre: string };
      expect(pedido).toEqual({
        id: expect.stringMatching(UUID) as string,
        padreId: null,
        nombre: "  Eventos ",
      });
      await vi.waitFor(() => {
        expect(router.refresh).toHaveBeenCalled();
        expect(hoja().elements()).toHaveLength(0);
      });
    });

    it("un doble toque en «Guardar» manda un solo pedido", async () => {
      await render(pantalla());
      await page.getByRole("button", { name: "Crear", exact: true }).click();
      await userEvent.fill(nombreCampo(), "Eventos");
      await guardar().dblClick();
      await vi.waitFor(() => {
        expect(router.refresh).toHaveBeenCalled();
      });
      expect(a.crear).toHaveBeenCalledTimes(1);
    });

    it("cada vez que se abre la hoja es una clave nueva; dentro de un nodo lleva su padre y el camino", async () => {
      await render(pantalla());
      await page.getByRole("button", { name: "Crear", exact: true }).click();
      await userEvent.fill(nombreCampo(), "Uno");
      await guardar().click();
      await vi.waitFor(() => {
        expect(hoja().elements()).toHaveLength(0);
      });
      await fila("Bebidas").click();
      await hoja().getByRole("button", { name: "Crear" }).click();
      await expect.element(hoja().getByText("Categoría")).toBeVisible();
      await expect.element(hoja().getByText("Restaurante › Bebidas")).toBeVisible();
      await userEvent.fill(nombreCampo(), "Dos");
      await guardar().click();
      await vi.waitFor(() => {
        expect(a.crear).toHaveBeenCalledTimes(2);
      });
      const [uno, dos] = a.crear.mock.calls.map(
        (c) => c[0] as { id: string; padreId: string | null },
      );
      expect(uno?.id).not.toBe(dos?.id);
      expect(dos).toMatchObject({ padreId: "bebidas", nombre: "Dos" });
    });

    it("«Crear» sale apagado en un nodo que no admite hijos y la acción de un nodo desactivado dice «Reactivar»", async () => {
      await render(pantalla());
      await fila("Hoja").click();
      await expect.element(hoja().getByRole("button", { name: "Crear" })).toBeDisabled();
      await hoja().getByRole("button", { name: "Cancelar" }).click();
      await fila("Postres").click();
      await expect.element(hoja().getByRole("button", { name: "Reactivar" })).toBeVisible();
      expect(hoja().getByRole("button", { name: "Desactivar" }).elements()).toHaveLength(0);
    });

    it("un rechazo muestra su motivo, deja la hoja abierta y vuelve a pedir la pantalla", async () => {
      a.crear.mockImplementation(tarda(GENERICO));
      await render(pantalla());
      await page.getByRole("button", { name: "Crear", exact: true }).click();
      await userEvent.fill(nombreCampo(), "Eventos");
      await guardar().click();
      await expect.element(hoja().getByText("Esta acción no está permitida")).toBeVisible();
      expect(router.refresh).toHaveBeenCalled();
      await expect.element(hoja()).toBeVisible();
      expect(await violacionesDeAccesibilidad()).toEqual([]);
    });

    it("Escape y «Cancelar» cierran la hoja sin enviar nada", async () => {
      await render(pantalla());
      await page.getByRole("button", { name: "Crear", exact: true }).click();
      await userEvent.keyboard("{Escape}");
      await vi.waitFor(() => {
        expect(hoja().elements()).toHaveLength(0);
      });
      await page.getByRole("button", { name: "Crear", exact: true }).click();
      await hoja().getByRole("button", { name: "Cancelar" }).click();
      await vi.waitFor(() => {
        expect(hoja().elements()).toHaveLength(0);
      });
      expect(a.crear).not.toHaveBeenCalled();
    });
  });

  describe("renombrar", () => {
    it("arranca con el nombre, «Guardar» sale apagado mientras no cambie y manda la versión que se vio", async () => {
      await render(pantalla());
      await fila("Bebidas").click();
      await hoja().getByRole("button", { name: "Renombrar" }).click();
      await expect.element(hoja().getByRole("heading", { name: "Renombrar" })).toBeVisible();
      await expect.element(nombreCampo()).toHaveValue("Bebidas");
      await expect.element(guardar()).toBeDisabled();
      await userEvent.fill(nombreCampo(), "   ");
      await expect.element(guardar()).toBeDisabled();
      await userEvent.fill(nombreCampo(), "Tragos");
      await guardar().click();
      await vi.waitFor(() => {
        expect(a.renombrar).toHaveBeenCalledTimes(1);
      });
      expect(a.renombrar).toHaveBeenCalledWith({
        nodoId: "bebidas",
        versionEsperada: 4,
        nombre: "Tragos",
      });
    });
  });

  describe("mover", () => {
    it("lista todo el árbol con su camino, apaga lo que no es destino y no deja guardar el mismo padre", async () => {
      await render(pantalla());
      await fila("Bebidas").click();
      await hoja().getByRole("button", { name: "Mover" }).click();
      const lista = hoja().getByRole("combobox", { name: "Categoría" });
      await expect.element(lista).toHaveValue("rest");
      const opciones = lista.element().querySelectorAll("option");
      expect([...opciones].map((o) => [o.textContent, o.disabled])).toEqual([
        ["Alojamiento", false],
        ["Restaurante", false],
        ["Restaurante › Bebidas", true],
        ["Restaurante › Bebidas › Cafés", true],
        ["Restaurante › Bebidas › Cafés › Hoja", true],
        ["Restaurante › Postres", true],
      ]);
      await expect.element(guardar()).toBeDisabled();
      await userEvent.selectOptions(lista, "alo");
      await guardar().click();
      await vi.waitFor(() => {
        expect(a.mover).toHaveBeenCalledTimes(1);
      });
      expect(a.mover).toHaveBeenCalledWith({
        nodoId: "bebidas",
        versionEsperada: 4,
        nuevoPadreId: "alo",
      });
    });

    it("un departamento no ofrece «Mover»", async () => {
      await render(pantalla());
      await fila("Restaurante").click();
      await expect.element(hoja().getByRole("button", { name: "Renombrar" })).toBeVisible();
      expect(hoja().getByRole("button", { name: "Mover" }).elements()).toHaveLength(0);
    });
  });

  describe("desactivar y reactivar", () => {
    it("se ejecutan al tocar, sin confirmación, con el nodo; un doble toque manda un solo pedido", async () => {
      await render(pantalla());
      await fila("Cafés").click();
      await hoja().getByRole("button", { name: "Desactivar" }).dblClick();
      await vi.waitFor(() => {
        expect(router.refresh).toHaveBeenCalled();
      });
      expect(a.desactivar).toHaveBeenCalledTimes(1);
      expect(a.desactivar).toHaveBeenCalledWith({ nodoId: "cafes" });
      await fila("Postres").click();
      await hoja().getByRole("button", { name: "Reactivar" }).click();
      await vi.waitFor(() => {
        expect(a.reactivar).toHaveBeenCalledWith({ nodoId: "postres" });
      });
    });

    it("con hijos activos sale el aviso aprobado y la hoja sigue abierta", async () => {
      a.desactivar.mockImplementation(tarda(HIJOS));
      await render(pantalla());
      await fila("Restaurante").click();
      await hoja().getByRole("button", { name: "Desactivar" }).click();
      await expect
        .element(hoja().getByText("Primero desactivá lo que tiene adentro."))
        .toBeVisible();
      await expect.element(hoja()).toBeVisible();
      expect(await violacionesDeAccesibilidad()).toEqual([]);
    });
  });

  it("el teclado recorre el árbol: Tab llega a la fila y Enter abre sus acciones", async () => {
    await render(pantalla());
    await userEvent.tab();
    await userEvent.tab();
    expect(document.activeElement?.textContent).toContain("Alojamiento");
    await userEvent.keyboard("{Enter}");
    await expect.element(hoja()).toBeVisible();
  });
});
