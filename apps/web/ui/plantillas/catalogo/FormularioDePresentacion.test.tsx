import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDePresentacion } from "./FormularioDePresentacion.cliente";
import {
  armarElFormularioDePresentacion,
  type PresentacionDeLaLista,
} from "./modelo-de-presentaciones";

/**
 * Agregar y editar una presentación de compra en Chromium (maqueta `presentaciones.html`): los campos, el rótulo de la cantidad que pasa a «Peso aproximado», lo que viaja al guardar, el error
 * de la cantidad asociado al campo, el doble toque, sin permiso, el teclado y axe, tamaños y sin desborde en 390 y 1280 px.
 */
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const PRODUCTO = {
  id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
  nombre: "Queso",
  unidadBase: "kg",
  activo: true,
};
const CAJA: PresentacionDeLaLista = {
  id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  nombre: "Caja de 5 kg",
  cantidad: "5.0000",
  dePesoVariable: false,
  activa: true,
  version: 2,
};

afterEach(async () => {
  await page.viewport(390, 844);
});

const formulario = (
  presentacion: PresentacionDeLaLista | null = null,
  accion: AccionDeFormulario = ok,
  puedeEditar = true,
) => (
  <FormularioDePresentacion
    formulario={armarElFormularioDePresentacion(PRODUCTO, presentacion, puedeEditar)}
    accion={accion}
  />
);
const rechazo =
  (error: ErrorPublico): AccionDeFormulario =>
  () =>
    Promise.resolve({ error });
const nombre = () => page.getByLabelText("Presentación", { exact: true });
const cantidad = () => page.getByLabelText("Cantidad en la unidad base (kg)", { exact: true });
const peso = () => page.getByLabelText("Peso aproximado (kg)", { exact: true });
const casilla = () => page.getByRole("checkbox", { name: "De peso variable" });
const agregar = () => page.getByRole("button", { name: "Agregar presentación" });
const guardar = () => page.getByRole("button", { name: "Guardar" });

describe("FormularioDePresentacion: agregar", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 900],
      [1280, 800],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(formulario());
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });

  it("abre con todo vacío y «Agregar presentación» apagado; se enciende con nombre y cantidad", async () => {
    await render(formulario());
    await expect.element(nombre()).toHaveValue("");
    await expect.element(agregar()).toBeDisabled();
    await userEvent.fill(nombre(), "Bolsa");
    await expect.element(agregar()).toBeDisabled();
    await userEvent.fill(cantidad(), "10");
    await expect.element(agregar()).toBeEnabled();
    await userEvent.fill(nombre(), "   ");
    await expect.element(agregar()).toBeDisabled();
  });

  it("hay tres campos: el nombre, la cantidad y «De peso variable»; nada más (ni el estado ni la versión)", async () => {
    await render(formulario());
    expect(
      [...document.querySelectorAll("input, select, textarea")].map((e) => e.getAttribute("name")),
    ).toEqual(["nombre", null, "cantidad", "pesoVariable"]);
  });

  it("con «De peso variable» el mismo campo pasa a llamarse «Peso aproximado» y conserva lo escrito", async () => {
    await render(formulario());
    await userEvent.fill(cantidad(), "4");
    await expect.element(peso()).not.toBeInTheDocument();
    tocar(casilla());
    await expect.element(peso()).toBeVisible();
    await expect.element(peso()).toHaveValue("4");
    await expect.element(cantidad()).not.toBeInTheDocument();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("al guardar manda el nombre, la cantidad en texto decimal y la casilla marcada como «on»", async () => {
    const accion = vi.fn(ok);
    await render(formulario(null, accion));
    await userEvent.fill(nombre(), "Horma");
    await userEvent.fill(cantidad(), "4,5");
    tocar(casilla());
    tocar(agregar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(datos.entries())).toEqual({
      nombre: "Horma",
      cantidad: "4.5",
      pesoVariable: "on",
    });
  });

  it("sin marcar la casilla no viaja", async () => {
    const accion = vi.fn(ok);
    await render(formulario(null, accion));
    await userEvent.fill(nombre(), "Bolsa");
    await userEvent.fill(cantidad(), "10");
    tocar(agregar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(datos.entries())).toEqual({ nombre: "Bolsa", cantidad: "10" });
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
    await render(formulario(null, accion));
    await userEvent.fill(nombre(), "Bolsa");
    await userEvent.fill(cantidad(), "10");
    tocar(agregar());
    await expect.element(agregar()).toHaveAttribute("aria-busy", "true");
    tocar(agregar());
    tocar(agregar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(agregar()).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("«La cantidad tiene que ser mayor que cero» se asocia al campo, no se repite debajo y lo escrito se conserva", async () => {
    await render(
      formulario(
        null,
        rechazo({
          codigo: "CATALOGO_CANTIDAD_INVALIDA",
          clave: "catalogo.error.cantidad_mayor_que_cero",
          presentacion: "AVISO",
          campo: "cantidad",
        }),
      ),
    );
    await userEvent.fill(nombre(), "Bolsa");
    await userEvent.fill(cantidad(), "0");
    tocar(agregar());
    await expect.element(page.getByText("La cantidad tiene que ser mayor que cero")).toBeVisible();
    expect(
      document.body.textContent?.match(/La cantidad tiene que ser mayor que cero/g),
    ).toHaveLength(1);
    const entrada = cantidad().element();
    expect(entrada.getAttribute("aria-invalid")).toBe("true");
    const descrito = entrada.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(descrito)?.textContent).toContain(
      "La cantidad tiene que ser mayor que cero",
    );
    await expect.element(nombre()).toHaveValue("Bolsa");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("un error sin campo (el genérico: nombre repetido o versión vieja) sale debajo y ningún campo queda inválido", async () => {
    await render(
      formulario(
        null,
        rechazo({
          codigo: "CATALOGO_ACCION_NO_PERMITIDA",
          clave: "catalogo.error.accion_no_permitida",
          presentacion: "AVISO",
        }),
      ),
    );
    await userEvent.fill(nombre(), "Bolsa");
    await userEvent.fill(cantidad(), "10");
    tocar(agregar());
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(document.querySelector("[aria-invalid=true]")).toBeNull();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin permiso, «Agregar presentación» sale apagado aunque haya datos, y no envía", async () => {
    const accion = vi.fn(ok);
    await render(formulario(null, accion, false));
    await userEvent.fill(nombre(), "Bolsa");
    await userEvent.fill(cantidad(), "10");
    await expect.element(agregar()).toBeDisabled();
    tocar(agregar());
    expect(accion).not.toHaveBeenCalled();
  });

  it("«Cancelar» vuelve a la lista sin enviar nada", async () => {
    const accion = vi.fn(ok);
    await render(formulario(null, accion));
    await expect
      .element(page.getByRole("link", { name: "Cancelar" }))
      .toHaveAttribute("href", `/catalogo/productos/${PRODUCTO.id}/compra`);
    expect(accion).not.toHaveBeenCalled();
  });
});

describe("FormularioDePresentacion: editar", () => {
  it("abre con el nombre actual, la cantidad se ve sin campo y «Guardar» está activo", async () => {
    await render(formulario(CAJA));
    await expect.element(nombre()).toHaveValue("Caja de 5 kg");
    expect(document.querySelector('[name="cantidad"]')).toBeNull();
    expect(document.querySelector('[name="pesoVariable"]')).toBeNull();
    await expect.element(page.getByText("5", { exact: true })).toBeVisible();
    await expect.element(guardar()).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("al guardar manda solo el nombre", async () => {
    const accion = vi.fn(ok);
    await render(formulario(CAJA, accion));
    await userEvent.fill(nombre(), "Caja grande");
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(datos.entries())).toEqual({ nombre: "Caja grande" });
  });

  it("una presentación de peso variable dice «Peso aproximado» y muestra «De peso variable»", async () => {
    await render(
      formulario({ ...CAJA, nombre: "Horma", cantidad: "4.0000", dePesoVariable: true }),
    );
    await expect.element(page.getByText("Peso aproximado (kg)")).toBeVisible();
    await expect.element(page.getByText("De peso variable")).toBeVisible();
    await expect.element(page.getByText("≈ 4")).toBeVisible();
  });

  it("sin permiso, «Guardar» sale apagado", async () => {
    await render(formulario(CAJA, ok, false));
    await expect.element(guardar()).toBeDisabled();
  });
});
