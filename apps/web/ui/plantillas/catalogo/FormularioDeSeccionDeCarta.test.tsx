import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { tocar, verificarFoco, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeSeccionDeCarta } from "./FormularioDeSeccionDeCarta.cliente";
import { armarElFormularioDeSeccion } from "./modelo-de-secciones";

/**
 * El nombre de una sección de la carta en Chromium (maqueta `productos-secciones.html`, «Nueva sección» y renombrar): el campo, «Cancelar» y «Guardar», lo que viaja al guardar, el error
 * asociado al campo (o debajo, si no apunta a él), el doble toque, sin permiso, el teclado y axe, tamaños y sin desborde en 390 y 1280 px.
 */
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });

afterEach(async () => {
  await page.viewport(390, 844);
});

const formulario = (
  seccion: { nombre: string } | null = null,
  accion: AccionDeFormulario = ok,
  puedeEditar = true,
) => (
  <FormularioDeSeccionDeCarta
    formulario={armarElFormularioDeSeccion(seccion, puedeEditar)}
    accion={accion}
  />
);
const rechazo =
  (error: ErrorPublico): AccionDeFormulario =>
  () =>
    Promise.resolve({ error });
const nombre = () => page.getByLabelText("Nombre", { exact: true });
const guardar = () => page.getByRole("button", { name: "Guardar" });

describe("FormularioDeSeccionDeCarta", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 900],
      [1280, 800],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(formulario({ nombre: "Cafés" }));
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });

  it("una sección nueva abre con el nombre vacío y «Guardar» apagado; renombrar abre con el nombre actual y «Guardar» activo", async () => {
    const { unmount } = await render(formulario());
    await expect.element(nombre()).toHaveValue("");
    await expect.element(guardar()).toBeDisabled();
    await unmount();
    await render(formulario({ nombre: "Cafés" }));
    await expect.element(nombre()).toHaveValue("Cafés");
    await expect.element(guardar()).toBeEnabled();
  });

  it("«Guardar» se enciende al escribir un nombre y se apaga si queda vacío o con solo blancos", async () => {
    await render(formulario());
    await userEvent.fill(nombre(), "Entradas");
    await expect.element(guardar()).toBeEnabled();
    await userEvent.fill(nombre(), "   ");
    await expect.element(guardar()).toBeDisabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("hay un solo campo, el nombre, y ningún otro (ni el orden ni el estado)", async () => {
    await render(formulario());
    expect(
      [...document.querySelectorAll("input, select, textarea")].map((e) => e.getAttribute("name")),
    ).toEqual(["nombre"]);
  });

  it("el botón ‹ vuelve a la lista con su nombre accesible y «Cancelar» también, sin enviar nada", async () => {
    const accion = vi.fn(ok);
    await render(formulario(null, accion));
    const volver = page.getByRole("link", { name: "Volver a la lista" });
    await expect.element(volver).toHaveAttribute("href", "/catalogo/secciones");
    await expect
      .element(page.getByRole("link", { name: "Cancelar" }))
      .toHaveAttribute("href", "/catalogo/secciones");
    expect(accion).not.toHaveBeenCalled();
  });

  it("el teclado recorre el botón ‹, el campo, «Cancelar» y «Guardar», con el foco a la vista", async () => {
    await render(formulario({ nombre: "Cafés" }));
    const volver = page.getByRole("link", { name: "Volver a la lista" }).element() as HTMLElement;
    await verificarFoco(volver);
    await userEvent.tab();
    expect(document.activeElement?.getAttribute("name")).toBe("nombre");
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe("Cancelar");
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe("Guardar");
  });

  it("al guardar manda solo el nombre, tal como se escribió", async () => {
    const accion = vi.fn(ok);
    await render(formulario(null, accion));
    await userEvent.fill(nombre(), "Entradas");
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(datos.entries())).toEqual({ nombre: "Entradas" });
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
    await render(formulario({ nombre: "Cafés" }, accion));
    tocar(guardar());
    await expect.element(guardar()).toHaveAttribute("aria-busy", "true");
    tocar(guardar());
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(guardar()).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("«Falta el nombre» se asocia al campo (aria-invalid y aria-describedby), no se repite debajo y lo escrito se conserva", async () => {
    await render(
      formulario(
        { nombre: "Cafés" },
        rechazo({
          codigo: "CATALOGO_FALTA_EL_NOMBRE",
          clave: "catalogo.error.falta_el_nombre",
          presentacion: "AVISO",
          campo: "nombre",
        }),
      ),
    );
    tocar(guardar());
    await expect.element(page.getByText("Falta el nombre")).toBeVisible();
    expect(document.body.textContent?.match(/Falta el nombre/g)).toHaveLength(1);
    const entrada = nombre().element();
    expect(entrada.getAttribute("aria-invalid")).toBe("true");
    const descrito = entrada.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(descrito)?.textContent).toContain("Falta el nombre");
    await expect.element(nombre()).toHaveValue("Cafés");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("un error sin campo (el genérico: nombre repetido, versión vieja) sale debajo con el patrón común y el campo no queda inválido", async () => {
    await render(
      formulario(
        { nombre: "Cafés" },
        rechazo({
          codigo: "CATALOGO_ACCION_NO_PERMITIDA",
          clave: "catalogo.error.accion_no_permitida",
          presentacion: "AVISO",
        }),
      ),
    );
    tocar(guardar());
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(document.querySelector("[aria-invalid=true]")).toBeNull();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("el motivo del guard sale debajo como «por qué no puedo»", async () => {
    await render(
      formulario(
        { nombre: "Cafés" },
        rechazo({
          codigo: "SIN_PERMISO",
          clave: "motivo.sin_permiso",
          presentacion: "POR_QUE_NO_PUEDO",
        }),
      ),
    );
    tocar(guardar());
    await expect.element(page.getByText("No tenés permiso para hacer esto.")).toBeVisible();
  });

  it("sin permiso, «Guardar» sale apagado aunque haya nombre, y no envía", async () => {
    const accion = vi.fn(ok);
    await render(formulario({ nombre: "Cafés" }, accion, false));
    await expect.element(guardar()).toBeDisabled();
    tocar(guardar());
    expect(accion).not.toHaveBeenCalled();
  });
});
