import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { ArmazonDeOperacion } from "../sesion/ArmazonDeOperacion";
import { armarLaOrden, type OrdenDeLaFicha } from "./modelo-de-orden";
import { PantallaDeLaOrden } from "./PantallaDeLaOrden";

/**
 * La ficha de una orden de producción y su hoja de motivo en Chromium (maqueta `produccion.html`, 09/11/2026), en el celular (390 px) y en escritorio (1280 px): axe como página sin
 * violaciones, letra de 16 px o más, controles de 48 px o más, sin desborde lateral; la abierta ofrece «Cancelar la orden» y la cerrada «Anular la orden» (solo si el modelo las ofrece);
 * la hoja pide el motivo, la confirmación espera a que haya uno, manda el motivo a la acción (el segundo toque no manda un segundo envío), el error del servidor sale dentro de la hoja,
 * y al cerrar el foco vuelve al botón que la abrió.
 */
const abierta: OrdenDeLaFicha = {
  id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
  numero: 14,
  estado: "ABIERTA",
  nombre: "Masa de medialuna",
  unidadId: "KILOGRAMO",
  cantidadEsperada: "10.0000",
  cantidadObtenida: null,
  mermaDeLote: null,
  recetaCambiada: true,
  vence: null,
  lote: null,
  renglones: [
    { nombre: "Harina 000", esperado: "6.0000", real: null, unidadId: "KILOGRAMO" },
    { nombre: "Manteca", esperado: "2.0000", real: null, unidadId: "KILOGRAMO" },
  ],
};
const cerrada: OrdenDeLaFicha = {
  ...abierta,
  estado: "CERRADA",
  cantidadObtenida: "9.5000",
  mermaDeLote: "0.5000",
  recetaCambiada: false,
  vence: "2026-12-01",
  lote: "OP-14",
  renglones: [
    { nombre: "Harina 000", esperado: "6.0000", real: "6.2000", unidadId: "KILOGRAMO" },
    { nombre: "Manteca", esperado: "2.0000", real: "2.0000", unidadId: "KILOGRAMO" },
  ],
  costo: { costoUnitario: "2833.333333", costoEstado: "DEFINITIVO" },
};
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const PUEDE = { cancelar: true, anular: true };

const pantalla = (
  orden: OrdenDeLaFicha,
  acciones = PUEDE,
  cancelar: AccionDeFormulario = ok,
  anular: AccionDeFormulario = ok,
) => {
  const armada = armarLaOrden(orden, acciones);
  return (
    <ArmazonDeOperacion
      titulo={armada.titulo}
      marca="Hotel del Lago"
      empresa="Café del Puerto"
      modulos={[]}
    >
      <PantallaDeLaOrden orden={armada} cancelar={cancelar} anular={anular} />
    </ArmazonDeOperacion>
  );
};

const visible = (el: Element): boolean =>
  el.closest("[hidden]") === null && el.checkVisibility({ visibilityProperty: true });
const ventana = (ancho: number): Promise<void> => page.viewport(ancho, ancho < 800 ? 2600 : 1600);

function legibleYTocable(): void {
  const chicos: string[] = [];
  for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
    const tieneTexto = [...el.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
    );
    if (!tieneTexto || !visible(el)) continue;
    const tamano = Number.parseFloat(getComputedStyle(el).fontSize);
    if (tamano < 16) chicos.push(`${el.tagName.toLowerCase()} ${tamano}px: ${el.textContent}`);
  }
  expect(chicos).toEqual([]);
  const bajos: string[] = [];
  for (const el of document.body.querySelectorAll<HTMLElement>("button, a[href], input")) {
    if (!visible(el)) continue;
    const alto = el.getBoundingClientRect().height;
    if (alto < 48) bajos.push(`${el.tagName.toLowerCase()} ${alto}px: ${el.textContent}`);
  }
  expect(bajos).toEqual([]);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}

afterEach(async () => {
  await page.viewport(390, 844);
});

describe("ficha de una orden de producción", () => {
  it("en el celular y en escritorio: accesible como página, legible y tocable (abierta)", async () => {
    for (const ancho of [390, 1280]) {
      await ventana(ancho);
      const pantallaMontada = await render(pantalla(abierta));
      expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
      legibleYTocable();
      expect(document.body.querySelectorAll("h1")).toHaveLength(1);
      await pantallaMontada.unmount();
    }
  });

  it("en el celular y en escritorio: accesible como página, legible y tocable (cerrada)", async () => {
    for (const ancho of [390, 1280]) {
      await ventana(ancho);
      const pantallaMontada = await render(pantalla(cerrada));
      expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
      legibleYTocable();
      await pantallaMontada.unmount();
    }
  });

  it("una abierta dice el producto, su cantidad, su estado, el aviso de receta, «Consume» con sus renglones y «Cancelar la orden»", async () => {
    await render(pantalla(abierta));
    await expect.element(page.getByRole("heading", { level: 1, name: "Orden 14" })).toBeVisible();
    const t = document.body.textContent ?? "";
    for (const esperado of [
      "Masa de medialuna",
      "10 Kilogramo",
      "Abierta",
      "La receta cambió desde que abriste la orden",
      "Consume",
      "Harina 000",
      "6 Kilogramo",
      "Manteca",
      "2 Kilogramo",
    ]) {
      expect(t).toContain(esperado);
    }
    await expect.element(page.getByRole("button", { name: "Cancelar la orden" })).toBeVisible();
    expect(page.getByRole("button", { name: "Anular la orden" }).elements()).toHaveLength(0);
  });

  it("una cerrada dice lo obtenido, el lote, el vencimiento y el costo por unidad, lo real de cada insumo y «Anular la orden»", async () => {
    await render(pantalla(cerrada));
    const t = document.body.textContent ?? "";
    for (const esperado of [
      "9,5 Kilogramo",
      "Cerrada",
      "Lote",
      "OP-14",
      "Vence",
      "01/12/2026",
      "Costo por unidad",
      "$ 2.833,33",
      "6,2 Kilogramo",
      "Consumió",
      "Esperado 10 · obtenido 9,5",
      "− 0,5 Kilogramo",
    ]) {
      expect(t).toContain(esperado);
    }
    expect(t).not.toContain("La receta cambió");
    await expect.element(page.getByRole("button", { name: "Anular la orden" })).toBeVisible();
    expect(page.getByRole("button", { name: "Cancelar la orden" }).elements()).toHaveLength(0);
  });

  it("sin permiso (el modelo no ofrece la acción) no hay botón", async () => {
    await render(pantalla(abierta, { cancelar: false, anular: false }));
    expect(document.body.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("la hoja de motivo", () => {
  it("el botón la abre: título con el número, campo «Motivo», confirmación apagada hasta que haya motivo, «Cancelar» y cerrar", async () => {
    await render(pantalla(cerrada));
    tocar(page.getByRole("button", { name: "Anular la orden" }));
    const hoja = page.getByRole("dialog", { name: "Anular la orden 14" });
    await expect.element(hoja).toBeVisible();
    await expect.element(page.getByLabelText("Motivo")).toBeVisible();
    const confirmar = hoja.getByRole("button", { name: "Anular la orden" });
    await expect.element(confirmar).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Motivo"), "   ");
    await expect.element(confirmar).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Motivo"), "Error de carga");
    await expect.element(confirmar).toBeEnabled();
    await expect.element(hoja.getByRole("button", { name: "Cancelar" })).toBeVisible();
    await expect.element(hoja.getByRole("button", { name: "Cerrar" })).toBeVisible();
    expect(await violacionesDeAccesibilidad(hoja.element())).toEqual([]);
  });

  it("cancelar una abierta usa la misma hoja y manda el motivo a la acción de cancelar (no a la de anular)", async () => {
    const cancelar = vi.fn<AccionDeFormulario>(() => Promise.resolve({ error: null }));
    const anular = vi.fn<AccionDeFormulario>(() => Promise.resolve({ error: null }));
    await render(pantalla(abierta, PUEDE, cancelar, anular));
    tocar(page.getByRole("button", { name: "Cancelar la orden" }));
    const hoja = page.getByRole("dialog", { name: "Cancelar la orden 14" });
    await userEvent.fill(page.getByLabelText("Motivo"), "Se rompió el horno");
    tocar(hoja.getByRole("button", { name: "Cancelar la orden" }));
    await vi.waitFor(() => expect(cancelar).toHaveBeenCalledTimes(1));
    expect((cancelar.mock.calls[0]?.[1] as FormData).get("motivo")).toBe("Se rompió el horno");
    expect(anular).not.toHaveBeenCalled();
  });

  it("anular manda el motivo a la acción de anular, y el segundo toque no manda un segundo envío", async () => {
    let liberar: () => void = () => undefined;
    const anular = vi.fn(async (_previo: unknown, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(pantalla(cerrada, PUEDE, ok, anular));
    tocar(page.getByRole("button", { name: "Anular la orden" }));
    const hoja = page.getByRole("dialog", { name: "Anular la orden 14" });
    await userEvent.fill(page.getByLabelText("Motivo"), "Error de carga");
    const confirmar = hoja.getByRole("button", { name: "Anular la orden" });
    tocar(confirmar);
    await expect.element(confirmar).toHaveAttribute("aria-busy", "true");
    tocar(confirmar);
    tocar(confirmar);
    await vi.waitFor(() => expect(anular).toHaveBeenCalledTimes(1));
    liberar();
    expect((anular.mock.calls[0]?.[1] as FormData).get("motivo")).toBe("Error de carga");
  });

  it("el error del servidor sale dentro de la hoja con su texto y la hoja sigue abierta", async () => {
    const rechazo: AccionDeFormulario = () =>
      Promise.resolve({
        error: {
          codigo: "PRODUCCION_ACCION_NO_PERMITIDA",
          clave: "lotes.error.sin_permiso",
          presentacion: "AVISO",
        },
      });
    await render(pantalla(cerrada, PUEDE, ok, rechazo));
    tocar(page.getByRole("button", { name: "Anular la orden" }));
    const hoja = page.getByRole("dialog", { name: "Anular la orden 14" });
    await userEvent.fill(page.getByLabelText("Motivo"), "x");
    tocar(hoja.getByRole("button", { name: "Anular la orden" }));
    await expect.element(hoja.getByText("Esta acción no está permitida")).toBeVisible();
    await expect.element(hoja).toBeVisible();
    expect(await violacionesDeAccesibilidad(hoja.element())).toEqual([]);
  });

  it("«Cancelar» y Escape cierran la hoja, borran lo escrito y el foco vuelve al botón que la abrió", async () => {
    await render(pantalla(cerrada));
    const abrir = page.getByRole("button", { name: "Anular la orden" });
    tocar(abrir);
    await userEvent.fill(page.getByLabelText("Motivo"), "Algo");
    tocar(
      page
        .getByRole("dialog", { name: "Anular la orden 14" })
        .getByRole("button", { name: "Cancelar" }),
    );
    await vi.waitFor(() => expect(page.getByRole("dialog").elements()).toHaveLength(0));
    await vi.waitFor(() => expect(document.activeElement).toBe(abrir.element()));
    tocar(abrir);
    await expect.element(page.getByLabelText("Motivo")).toHaveValue("");
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(page.getByRole("dialog").elements()).toHaveLength(0));
    await vi.waitFor(() => expect(document.activeElement).toBe(abrir.element()));
  });

  it("el foco inicial de la hoja va al título (nunca al botón que anula) y Tab no sale de la hoja", async () => {
    await render(pantalla(cerrada));
    tocar(page.getByRole("button", { name: "Anular la orden" }));
    const hoja = page.getByRole("dialog", { name: "Anular la orden 14" });
    await expect.element(hoja).toBeVisible();
    expect(document.activeElement?.tagName).toBe("H2");
    await userEvent.tab();
    expect(document.activeElement).toBe(hoja.getByRole("button", { name: "Cerrar" }).element());
    await userEvent.tab();
    expect(document.activeElement).toBe(page.getByLabelText("Motivo").element());
    for (let i = 0; i < 6; i += 1) {
      await userEvent.tab();
      expect(hoja.element().contains(document.activeElement)).toBe(true);
    }
  });
});

describe("anulada y sin conexión", () => {
  it("una anulada dice «Orden anulada» y no ofrece botones", async () => {
    await render(pantalla({ ...cerrada, estado: "ANULADA" }));
    await expect.element(page.getByText("Orden anulada")).toBeVisible();
    expect(document.body.querySelectorAll("button")).toHaveLength(0);
  });

  it("anular explica qué pasa; cancelar no lleva explicación", async () => {
    const { unmount } = await render(pantalla(cerrada));
    tocar(page.getByRole("button", { name: "Anular la orden" }));
    await expect
      .element(
        page.getByText(
          "Se devuelve lo consumido y se saca lo producido. Queda el registro de la orden.",
        ),
      )
      .toBeVisible();
    await unmount();
    await render(pantalla(abierta));
    tocar(page.getByRole("button", { name: "Cancelar la orden" }));
    await expect.element(page.getByRole("dialog", { name: "Cancelar la orden 14" })).toBeVisible();
    expect(document.body.textContent).not.toContain("Se devuelve lo consumido");
  });

  it("sin conexión la confirmación sale apagada y lo dice; al volver, se habilita", async () => {
    await render(pantalla(cerrada));
    tocar(page.getByRole("button", { name: "Anular la orden" }));
    const hoja = page.getByRole("dialog", { name: "Anular la orden 14" });
    await userEvent.fill(page.getByLabelText("Motivo"), "Error de carga");
    const confirmar = hoja.getByRole("button", { name: "Anular la orden" });
    await expect.element(confirmar).toBeEnabled();
    const enLinea = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
    await expect.element(confirmar).toBeDisabled();
    await expect.element(hoja.getByText("No se puede enviar sin conexión.")).toBeVisible();
    enLinea.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    await expect.element(confirmar).toBeEnabled();
    expect(document.body.textContent).not.toContain("No se puede enviar sin conexión.");
    enLinea.mockRestore();
  });
});

describe("textos", () => {
  it("el verbo del botón es el aprobado del catálogo", () => {
    expect(texto({}, "produccion.accion.cancelar_la_orden")).toBe("Cancelar la orden");
    expect(texto({}, "produccion.accion.anular_la_orden")).toBe("Anular la orden");
  });
});
