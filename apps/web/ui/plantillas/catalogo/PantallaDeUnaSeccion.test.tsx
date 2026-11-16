import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { tocar, verificarFoco, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { PantallaDeUnaSeccion } from "./PantallaDeUnaSeccion";
import { armarUnaSeccion, type UnaSeccionDeLaPantalla } from "./modelo-de-secciones";

/**
 * Una sección de la carta en Chromium (maqueta `productos-secciones.html`): «Nombre», «Desactivar» / «Reactivar» y sus productos solo lectura; el botón ‹, la marca «Desactivado», lo que pasa al
 * tocar, el doble toque, el error debajo, sin permiso, «Página siguiente», el teclado y axe, tamaños y sin desborde en 390 y 1280 px.
 */
const CAFES = { id: "s-1", nombre: "Cafés", activa: true, version: 3 };
const dato = (
  seccion = CAFES,
  siguiente: string | null = null,
  productos = [
    { id: "p1", nombre: "Cortado" },
    { id: "p2", nombre: "Espresso" },
  ],
): UnaSeccionDeLaPantalla => ({ seccion, productos, siguiente });
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });

afterEach(async () => {
  await page.viewport(390, 844);
});

const pantalla = (
  d: UnaSeccionDeLaPantalla = dato(),
  accion: AccionDeFormulario = ok,
  puedeEditar = true,
) => <PantallaDeUnaSeccion seccion={armarUnaSeccion(d, puedeEditar)} accionDeEstado={accion} />;
const rechazo =
  (error: ErrorPublico): AccionDeFormulario =>
  () =>
    Promise.resolve({ error });

describe("PantallaDeUnaSeccion", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 900],
      [1280, 800],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(pantalla(dato(CAFES, "x:y")));
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });

  it("muestra «Nombre», «Desactivar» y los productos en el orden que llegan, sin «Agregar producto» ni «Quitar»", async () => {
    await render(pantalla());
    await expect
      .element(page.getByRole("link", { name: "Nombre" }))
      .toHaveAttribute("href", "/catalogo/secciones/s-1/nombre");
    await expect.element(page.getByRole("button", { name: "Desactivar" })).toBeEnabled();
    expect([...document.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Cortado",
      "Espresso",
    ]);
    expect(document.body.textContent).not.toContain("Agregar producto");
    expect(document.body.textContent).not.toContain("Quitar");
  });

  it("el botón ‹ vuelve a la lista con su nombre accesible", async () => {
    await render(pantalla());
    await expect
      .element(page.getByRole("link", { name: "Volver a la lista" }))
      .toHaveAttribute("href", "/catalogo/secciones");
  });

  it("una sección desactivada lleva la marca «Desactivado» y ofrece «Reactivar»", async () => {
    await render(pantalla(dato({ ...CAFES, activa: false })));
    await expect.element(page.getByText("Desactivado")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Reactivar" })).toBeEnabled();
    expect(document.body.textContent).not.toContain("Desactivar");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("una sección activa no lleva la marca", async () => {
    await render(pantalla());
    expect(document.body.textContent).not.toContain("Desactivado");
  });

  it("una sección sin productos no dice nada: ni lista vacía ni aviso", async () => {
    await render(pantalla(dato(CAFES, null, [])));
    expect(document.querySelectorAll("li")).toHaveLength(0);
    expect(document.querySelector("[role=status], [role=alert]")).toBeNull();
  });

  it("«Página siguiente» sale solo si hay otra página y lleva a la dirección con la clave", async () => {
    const { unmount } = await render(pantalla(dato(CAFES, "p2:espresso")));
    await expect
      .element(page.getByRole("link", { name: "Página siguiente" }))
      .toHaveAttribute("href", "/catalogo/secciones/s-1?despues=p2%3Aespresso");
    await unmount();
    await render(pantalla());
    expect(document.body.textContent).not.toContain("Página siguiente");
  });

  it("«Desactivar» manda el envío sin campos; el segundo toque no manda un segundo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (_previo: unknown, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(pantalla(dato(), accion));
    const boton = page.getByRole("button", { name: "Desactivar" });
    tocar(boton);
    await expect.element(boton).toHaveAttribute("aria-busy", "true");
    tocar(boton);
    tocar(boton);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect([...(accion.mock.calls[0]?.[1] as FormData).entries()]).toEqual([]);
    liberar();
    await expect.element(boton).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("un error (el genérico) sale debajo con el patrón común", async () => {
    await render(
      pantalla(
        dato(),
        rechazo({
          codigo: "CATALOGO_ACCION_NO_PERMITIDA",
          clave: "catalogo.error.accion_no_permitida",
          presentacion: "AVISO",
        }),
      ),
    );
    tocar(page.getByRole("button", { name: "Desactivar" }));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin permiso, «Nombre» y «Desactivar» salen apagados (no hay enlace) y no envían; los productos se ven", async () => {
    const accion = vi.fn(ok);
    await render(pantalla(dato(), accion, false));
    await expect.element(page.getByRole("button", { name: "Nombre" })).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Desactivar" })).toBeDisabled();
    expect(document.querySelector('a[href$="/nombre"]')).toBeNull();
    tocar(page.getByRole("button", { name: "Desactivar" }));
    expect(accion).not.toHaveBeenCalled();
    await expect.element(page.getByText("Espresso")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el teclado recorre ‹, «Nombre» y «Desactivar», con el foco a la vista", async () => {
    await render(pantalla());
    await verificarFoco(
      page.getByRole("link", { name: "Volver a la lista" }).element() as HTMLElement,
    );
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe("Nombre");
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe("Desactivar");
  });
});
