import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { tocar, verificarFoco, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { PantallaDeListaDeSecciones } from "./PantallaDeListaDeSecciones";
import { armarLaListaDeSecciones, type SeccionDeLaLista } from "./modelo-de-secciones";

/**
 * La lista de secciones de la carta en Chromium (maqueta `productos-secciones.html`): una fila por sección con su enlace, «Desactivado» y las flechas de las activas con su nombre accesible, lo
 * que viaja al tocar una flecha, el doble toque, el error debajo, sin permiso, el teclado y axe, tamaños y sin desborde en 390 y 1280 px.
 */
const SECCIONES: readonly SeccionDeLaLista[] = [
  { id: "s-1", nombre: "Cafés", activa: true, version: 3 },
  { id: "s-2", nombre: "Postres", activa: false, version: 1 },
  { id: "s-3", nombre: "Para comer", activa: true, version: 2 },
  { id: "s-4", nombre: "Bebidas", activa: true, version: 5 },
];
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });

afterEach(async () => {
  await page.viewport(390, 844);
});

const pantalla = (
  accion: AccionDeFormulario = ok,
  puedeEditar = true,
  secciones: readonly SeccionDeLaLista[] = SECCIONES,
) => (
  <PantallaDeListaDeSecciones
    lista={armarLaListaDeSecciones(secciones, puedeEditar)}
    accion={accion}
  />
);
const rechazo =
  (error: ErrorPublico): AccionDeFormulario =>
  () =>
    Promise.resolve({ error });
const flecha = (nombre: string) => page.getByRole("button", { name: nombre, exact: true });

describe("PantallaDeListaDeSecciones", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 1000],
      [1280, 800],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(pantalla());
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });

  it("una fila por sección en el orden de la carta: las activas primero y «Postres» al final, con «Desactivado» y sin flechas", async () => {
    await render(pantalla());
    const filas = [...document.querySelectorAll("li")].map((li) => li.textContent?.trim());
    expect(filas).toEqual(
      ["Cafés↑↓", "Para comer↑↓", "Bebidas↑↓", "Postres Desactivado"].map((t) =>
        t.replace(" Desactivado", "Desactivado"),
      ),
    );
    expect(document.querySelector("li:last-child button")).toBeNull();
    await expect
      .element(page.getByRole("link", { name: "Cafés" }))
      .toHaveAttribute("href", "/catalogo/secciones/s-1");
  });

  it("cada flecha tiene el nombre accesible con su sección; la primera no sube y la última no baja", async () => {
    await render(pantalla());
    const nombres = [...document.querySelectorAll("button")].map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(nombres).toEqual([
      "Subir Cafés",
      "Bajar Cafés",
      "Subir Para comer",
      "Bajar Para comer",
      "Subir Bebidas",
      "Bajar Bebidas",
    ]);
    await expect.element(flecha("Subir Cafés")).toBeDisabled();
    await expect.element(flecha("Bajar Cafés")).toBeEnabled();
    await expect.element(flecha("Subir Bebidas")).toBeEnabled();
    await expect.element(flecha("Bajar Bebidas")).toBeDisabled();
  });

  it("tocar una flecha manda la sección tocada con el nombre «subir» o «bajar», y nada más", async () => {
    const accion = vi.fn(ok);
    await render(pantalla(accion));
    tocar(flecha("Subir Para comer"));
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries((accion.mock.calls[0]?.[1] as FormData).entries())).toEqual({
      subir: "s-3",
    });
    await expect.element(flecha("Bajar Cafés")).not.toHaveAttribute("aria-disabled", "true");
    tocar(flecha("Bajar Cafés"));
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2));
    expect(Object.fromEntries((accion.mock.calls[1]?.[1] as FormData).entries())).toEqual({
      bajar: "s-1",
    });
  });

  it("una flecha apagada no envía", async () => {
    const accion = vi.fn(ok);
    await render(pantalla(accion));
    tocar(flecha("Subir Cafés"));
    expect(accion).not.toHaveBeenCalled();
  });

  it("el segundo toque mientras envía no manda un segundo movimiento", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (_previo: unknown, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(pantalla(accion));
    tocar(flecha("Bajar Cafés"));
    await expect.element(flecha("Bajar Cafés")).toHaveAttribute("aria-disabled", "true");
    tocar(flecha("Bajar Cafés"));
    tocar(flecha("Subir Bebidas"));
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(flecha("Bajar Cafés")).not.toHaveAttribute("aria-disabled", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("un error (el genérico: otra persona cambió la lista) sale debajo con el patrón común", async () => {
    await render(
      pantalla(
        rechazo({
          codigo: "CATALOGO_ACCION_NO_PERMITIDA",
          clave: "catalogo.error.accion_no_permitida",
          presentacion: "AVISO",
        }),
      ),
    );
    tocar(flecha("Bajar Cafés"));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el motivo del guard sale debajo como «por qué no puedo»", async () => {
    await render(
      pantalla(
        rechazo({
          codigo: "SIN_PERMISO",
          clave: "motivo.sin_permiso",
          presentacion: "POR_QUE_NO_PUEDO",
        }),
      ),
    );
    tocar(flecha("Bajar Cafés"));
    await expect.element(page.getByText("No tenés permiso para hacer esto.")).toBeVisible();
  });

  it("«Nueva sección» sale con permiso y lleva al alta; sin permiso no sale, y todas las flechas salen apagadas", async () => {
    const { unmount } = await render(pantalla());
    await expect
      .element(page.getByRole("link", { name: "Nueva sección" }))
      .toHaveAttribute("href", "/catalogo/secciones/nueva");
    await unmount();
    await render(pantalla(ok, false));
    expect(document.body.textContent).not.toContain("Nueva sección");
    for (const b of document.querySelectorAll("button")) expect(b.disabled).toBe(true);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("con el error del servidor en lugar de la lista, no hay lista ni «Nueva sección»", async () => {
    await render(
      <PantallaDeListaDeSecciones
        lista={null}
        accion={ok}
        error={<p>Esta función todavía está en desarrollo.</p>}
      />,
    );
    await expect.element(page.getByText("Esta función todavía está en desarrollo.")).toBeVisible();
    expect(document.querySelector("ul")).toBeNull();
    expect(document.body.textContent).not.toContain("Nueva sección");
  });

  it("el teclado llega a cada enlace y a cada flecha habilitada, en el orden de la lista, con el foco a la vista", async () => {
    await render(pantalla());
    await verificarFoco(page.getByRole("link", { name: "Cafés" }).element() as HTMLElement);
    const recorrido: string[] = [];
    for (let i = 0; i < 6; i++) {
      await userEvent.tab();
      recorrido.push(
        document.activeElement?.getAttribute("aria-label") ??
          document.activeElement?.textContent ??
          "?",
      );
    }
    // La flecha apagada (Subir Cafés) no recibe el foco; las desactivadas, ninguna flecha.
    expect(recorrido).toEqual([
      "Bajar Cafés",
      "Para comer",
      "Subir Para comer",
      "Bajar Para comer",
      "Bebidas",
      "Subir Bebidas",
    ]);
  });

  it("una carta sin secciones muestra solo «Nueva sección»", async () => {
    await render(pantalla(ok, true, []));
    expect(document.querySelectorAll("li")).toHaveLength(0);
    await expect.element(page.getByRole("link", { name: "Nueva sección" })).toBeVisible();
  });
});
