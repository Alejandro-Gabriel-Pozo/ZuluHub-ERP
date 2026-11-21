import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { HojaDeCopiaDeOpciones } from "./HojaDeCopiaDeOpciones.cliente";
import { armarLaCopia, type CopiaArmada, type CopiaDeLaPantalla } from "./modelo-de-opciones";

const router = vi.hoisted(() => ({ replace: vi.fn<(destino: string) => void>() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

/**
 * «Copiar de otro producto» en Chromium (maqueta `productos.html`, función `vCopia`): una HOJA (diálogo sobre la solapa) con el selector «Producto», la vista previa de lo que se va a
 * traer, «Cancelar» y «Copiar». Lo que viaja al copiar (solo el producto de origen elegido), cambiar de producto (navega: la vista previa la arma el servidor), «Copiar» apagado sin nada
 * para traer o sin permiso, el doble toque, el error, el foco al abrir y al cerrar, Escape, el teclado y axe, en 390 y 1280 px.
 */
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const COPIA: CopiaDeLaPantalla = {
  id: ID,
  nombre: "Milanesa",
  versionDeOpciones: 4,
  candidatos: [
    { id: "a", nombre: "Hamburguesa" },
    { id: "b", nombre: "Pizza" },
  ],
  origen: "a",
  vistaPrevia: [
    {
      nombre: "Guarnición",
      clase: "INCLUIDA",
      opciones: [
        { nombre: "Papas fritas", recargo: null },
        { nombre: "Ensalada", recargo: null },
      ],
    },
    {
      nombre: "Salsas",
      clase: "ADICIONAL",
      opciones: [{ nombre: "Mayonesa", recargo: "500.00" }],
    },
  ],
  claveDeLaCopia: "clave",
};
const CIERRE = `/catalogo/productos/${ID}/opciones`;
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const rechazo =
  (error: ErrorPublico): AccionDeFormulario =>
  () =>
    Promise.resolve({ error });
const hoja = (copia: CopiaArmada = armarLaCopia(COPIA, true), accion: AccionDeFormulario = ok) => (
  <HojaDeCopiaDeOpciones copia={copia} accion={accion} />
);
const copiar = () => page.getByRole("button", { name: "Copiar", exact: true });
const selector = () => page.getByLabelText("Producto", { exact: true });

beforeEach(() => {
  router.replace.mockReset();
});
afterEach(async () => {
  await page.viewport(390, 844);
});

describe("HojaDeCopiaDeOpciones", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 800],
      [1280, 800],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(hoja());
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(ancho);
      await unmount();
    }
  });

  it("es un diálogo modal con su título, el selector con el origen elegido y la vista previa de lo que se va a traer", async () => {
    await render(hoja());
    const dialogo = page.getByRole("dialog", { name: "Copiar de otro producto" });
    await expect.element(dialogo).toBeVisible();
    await expect.element(selector()).toHaveValue("a");
    expect([...selector().element().querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Hamburguesa",
      "Pizza",
    ]);
    await expect.element(page.getByText("Grupos de opciones")).toBeVisible();
    await expect.element(page.getByText("Guarnición: Papas fritas · Ensalada")).toBeVisible();
    await expect.element(page.getByText("Salsas: Mayonesa + $ 500,00")).toBeVisible();
    expect(page.getByText("Variantes").elements()).toHaveLength(0);
  });

  it("si la copia trae la variante, su bloque «Variantes» se ve antes", async () => {
    await render(
      hoja(
        armarLaCopia(
          {
            ...COPIA,
            vistaPrevia: [
              ...COPIA.vistaPrevia,
              {
                nombre: "Tamaño",
                clase: "VARIANTE",
                opciones: [
                  { nombre: "Chica", recargo: null },
                  { nombre: "Grande", recargo: null },
                ],
              },
            ],
          },
          true,
        ),
      ),
    );
    await expect.element(page.getByText("Variantes")).toBeVisible();
    await expect.element(page.getByText("Tamaño: Chica · Grande")).toBeVisible();
    const titulos = page.getByRole("dialog").element().querySelectorAll("strong");
    expect([...titulos].map((t) => t.textContent)).toEqual(["Variantes", "Grupos de opciones"]);
  });

  it("al copiar manda solo el producto de origen elegido", async () => {
    const accion = vi.fn(ok);
    await render(hoja(armarLaCopia(COPIA, true), accion));
    tocar(copiar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries((accion.mock.calls[0]?.[1] as FormData).entries())).toEqual({
      productoOrigenId: "a",
    });
  });

  it("cambiar el producto navega a su dirección (la vista previa la arma el servidor) y «Copiar» espera esa vista previa; con la nueva, vuelve", async () => {
    const accion = vi.fn(ok);
    const { rerender } = await render(hoja(armarLaCopia(COPIA, true), accion));
    await userEvent.selectOptions(selector(), "b");
    expect(router.replace).toHaveBeenCalledWith(`${CIERRE}?copiar=b`);
    // Todavía se ve la vista previa del otro producto: no se puede copiar con ella.
    await expect.element(selector()).toHaveValue("b");
    await expect.element(copiar()).toBeDisabled();
    tocar(copiar());
    expect(accion).not.toHaveBeenCalled();
    // Llega la vista previa del producto elegido.
    await rerender(
      hoja(
        armarLaCopia(
          {
            ...COPIA,
            origen: "b",
            vistaPrevia: [
              {
                nombre: "Fugazza",
                clase: "INCLUIDA",
                opciones: [{ nombre: "Cebolla", recargo: null }],
              },
            ],
          },
          true,
        ),
        accion,
      ),
    );
    await expect.element(page.getByText("Fugazza: Cebolla")).toBeVisible();
    await expect.element(copiar()).toBeEnabled();
    tocar(copiar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries((accion.mock.calls[0]?.[1] as FormData).entries())).toEqual({
      productoOrigenId: "b",
    });
  });

  it("«Copiar» sale apagado si no hay nada para traer o si no puede editar, y no envía", async () => {
    const accion = vi.fn(ok);
    const { unmount } = await render(
      hoja(armarLaCopia({ ...COPIA, vistaPrevia: [] }, true), accion),
    );
    await expect.element(copiar()).toBeDisabled();
    tocar(copiar());
    await unmount();
    await render(hoja(armarLaCopia(COPIA, false), accion));
    await expect.element(copiar()).toBeDisabled();
    tocar(copiar());
    expect(accion).not.toHaveBeenCalled();
  });

  it("sin productos de dónde copiar la hoja se abre con el selector vacío y «Copiar» apagado", async () => {
    await render(
      hoja(armarLaCopia({ ...COPIA, candidatos: [], origen: null, vistaPrevia: [] }, true)),
    );
    await expect.element(page.getByRole("dialog")).toBeVisible();
    expect(selector().element().querySelectorAll("option")).toHaveLength(0);
    await expect.element(copiar()).toBeDisabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el segundo toque no manda un segundo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (_previo: unknown, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(hoja(armarLaCopia(COPIA, true), accion));
    tocar(copiar());
    await expect.element(copiar()).toHaveAttribute("aria-busy", "true");
    tocar(copiar());
    tocar(copiar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(copiar()).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("un error sale en la hoja con el patrón común y la hoja sigue abierta", async () => {
    await render(
      hoja(
        armarLaCopia(COPIA, true),
        rechazo({
          codigo: "CATALOGO_ACCION_NO_PERMITIDA",
          clave: "catalogo.error.accion_no_permitida",
          presentacion: "AVISO",
        }),
      ),
    );
    tocar(copiar());
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    await expect.element(page.getByRole("dialog")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Cancelar», la X y Escape vuelven a la solapa (sin `copiar`)", async () => {
    await render(hoja());
    await userEvent.click(page.getByRole("button", { name: "Cancelar" }));
    expect(router.replace).toHaveBeenLastCalledWith(CIERRE);
    await userEvent.click(page.getByRole("button", { name: "Cerrar" }));
    expect(router.replace).toHaveBeenLastCalledWith(CIERRE);
    await userEvent.keyboard("{Escape}");
    expect(router.replace).toHaveBeenCalledTimes(3);
    expect(router.replace).toHaveBeenLastCalledWith(CIERRE);
  });

  it("el foco va al primer control al abrir y vuelve a quien abrió al cerrar", async () => {
    function Escenario() {
      const [abierta, setAbierta] = useState(false);
      router.replace.mockImplementation(() => {
        setAbierta(false);
      });
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setAbierta(true);
            }}
          >
            Abrir
          </button>
          {abierta ? hoja() : null}
        </>
      );
    }
    await render(<Escenario />);
    const abrir = page.getByRole("button", { name: "Abrir" });
    abrir.element().focus();
    await userEvent.click(abrir);
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await vi.waitFor(() => expect(document.activeElement).toBe(selector().element()));
    await userEvent.click(page.getByRole("button", { name: "Cancelar" }));
    await vi.waitFor(() => expect(page.getByRole("dialog").elements()).toHaveLength(0));
    await vi.waitFor(() => expect(document.activeElement).toBe(abrir.element()));
  });

  it("el teclado va del selector a «Cancelar» y a «Copiar» sin salir de la hoja", async () => {
    await render(hoja());
    await vi.waitFor(() => expect(document.activeElement).toBe(selector().element()));
    const orden: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await userEvent.tab();
      orden.push(document.activeElement?.textContent ?? "");
    }
    expect(orden).toEqual(["Cancelar", "Copiar", ""]);
    expect(document.activeElement?.closest("dialog")).not.toBeNull();
  });
});
