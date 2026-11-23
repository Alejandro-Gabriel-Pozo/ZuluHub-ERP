import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { tocar, verificarFoco, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { PantallaDeAgregarProducto } from "./PantallaDeAgregarProducto";
import { armarLosCandidatos, type CandidatosDeLaPantalla } from "./modelo-de-secciones";

/**
 * «Agregar producto» a una sección en Chromium (maqueta `productos-secciones.html`, cuadro «Agregar producto»): el buscador «Buscar» con su botón, los candidatos con su sección al lado (el que
 * falta completar, apagado), qué producto viaja al tocar uno, el doble toque, el error debajo, sin permiso, «Página siguiente», «Cancelar», el teclado y axe, tamaños y sin desborde en 390 y
 * 1280 px.
 */
const CAFES = { id: "s-1", nombre: "Cafés", activa: true, version: 3 };
const dato = (
  siguiente: string | null = null,
  candidatos: CandidatosDeLaPantalla["candidatos"] = [
    { id: "p1", nombre: "Budín", version: 2, faltaCompletar: true, seccion: null },
    { id: "p2", nombre: "Flan", version: 6, faltaCompletar: false, seccion: "Postres" },
    { id: "p3", nombre: "Milanesa", version: 1, faltaCompletar: false, seccion: null },
  ],
): CandidatosDeLaPantalla => ({ seccion: CAFES, candidatos, siguiente });
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });

afterEach(async () => {
  await page.viewport(390, 844);
});

const pantalla = (
  d: CandidatosDeLaPantalla = dato(),
  accion: AccionDeFormulario = ok,
  puedeEditar = true,
  buscado = "",
) => (
  <PantallaDeAgregarProducto
    candidatos={armarLosCandidatos(d, buscado, puedeEditar)}
    accion={accion}
  />
);
const rechazo =
  (error: ErrorPublico): AccionDeFormulario =>
  () =>
    Promise.resolve({ error });
const candidato = (nombre: string) => page.getByRole("button", { name: new RegExp(`^${nombre}`) });

describe("PantallaDeAgregarProducto", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 1000],
      [1280, 800],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(pantalla(dato("x:y")));
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });

  it("muestra el buscador «Buscar» con su botón y una fila por candidato con dónde está hoy: «Falta completar», su sección o «Sin elegir»", async () => {
    await render(pantalla());
    await expect.element(page.getByRole("searchbox", { name: "Buscar" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Buscar", exact: true })).toBeEnabled();
    expect([...document.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "BudínFalta completar",
      "FlanPostres",
      "MilanesaSin elegir",
    ]);
  });

  it("el que falta completar sale apagado y los demás se pueden elegir", async () => {
    await render(pantalla());
    await expect.element(candidato("Budín")).toBeDisabled();
    await expect.element(candidato("Flan")).toBeEnabled();
    await expect.element(candidato("Milanesa")).toBeEnabled();
  });

  it("el buscador es un formulario GET a la pantalla de la sección y conserva lo buscado", async () => {
    await render(pantalla(dato(), ok, true, "fla"));
    const formulario = page.getByRole("search").element() as HTMLFormElement;
    expect(formulario.method).toBe("get");
    expect(new URL(formulario.action).pathname).toBe("/catalogo/secciones/s-1/agregar");
    await expect.element(page.getByRole("searchbox", { name: "Buscar" })).toHaveValue("fla");
    expect((page.getByRole("searchbox").element() as HTMLInputElement).name).toBe("texto");
  });

  it("tocar un candidato manda SU id (no el de otro); el segundo toque no manda un segundo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (_previo: unknown, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(pantalla(dato(), accion));
    tocar(candidato("Flan"));
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    tocar(candidato("Flan"));
    tocar(candidato("Milanesa"));
    expect([...(accion.mock.calls[0]?.[1] as FormData).entries()]).toEqual([["agregar", "p2"]]);
    liberar();
    await vi.waitFor(() => expect(document.querySelector("[aria-disabled=true]")).toBeNull());
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("un candidato apagado no envía", async () => {
    const accion = vi.fn(ok);
    await render(pantalla(dato(), accion));
    tocar(candidato("Budín"));
    expect(accion).not.toHaveBeenCalled();
  });

  it("un error (el genérico) sale debajo con el patrón común y la lista sigue a la vista", async () => {
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
    tocar(candidato("Flan"));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    await expect.element(candidato("Milanesa")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin permiso, todos los candidatos salen apagados, pero se ven, y no envían", async () => {
    const accion = vi.fn(ok);
    await render(pantalla(dato(), accion, false));
    for (const nombre of ["Budín", "Flan", "Milanesa"]) {
      await expect.element(candidato(nombre)).toBeDisabled();
    }
    tocar(candidato("Flan"));
    expect(accion).not.toHaveBeenCalled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Cancelar» vuelve a la sección y «Página siguiente» sale solo si hay otra página", async () => {
    const { unmount } = await render(pantalla(dato("p3:milanesa"), ok, true, "m"));
    await expect
      .element(page.getByRole("link", { name: "Cancelar" }))
      .toHaveAttribute("href", "/catalogo/secciones/s-1");
    await expect
      .element(page.getByRole("link", { name: "Página siguiente" }))
      .toHaveAttribute("href", "/catalogo/secciones/s-1/agregar?texto=m&despues=p3%3Amilanesa");
    await unmount();
    await render(pantalla());
    expect(document.body.textContent).not.toContain("Página siguiente");
  });

  it("una lista sin candidatos no dice nada: ni lista vacía ni aviso", async () => {
    await render(pantalla(dato(null, [])));
    expect(document.querySelectorAll("li")).toHaveLength(0);
    expect(document.querySelector("[role=status], [role=alert]")).toBeNull();
    expect(document.body.textContent).not.toContain("Sin resultados");
  });

  it("el teclado recorre el buscador, «Buscar», cada candidato elegible y «Cancelar», con el foco a la vista", async () => {
    await render(pantalla());
    await verificarFoco(page.getByRole("searchbox", { name: "Buscar" }).element() as HTMLElement);
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe("Buscar");
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe("FlanPostres");
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe("MilanesaSin elegir");
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe("Cancelar");
  });
});
