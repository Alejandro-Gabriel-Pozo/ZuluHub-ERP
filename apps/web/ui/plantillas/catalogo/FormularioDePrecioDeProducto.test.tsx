import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDePrecioDeProducto } from "./FormularioDePrecioDeProducto.cliente";
import {
  armarLosPrecios,
  type PreciosArmados,
  type PreciosDeLaPantalla,
} from "./modelo-de-precios-de-producto";

/**
 * Los precios de un producto en Chromium (maqueta `productos.html`, solapa «Precios»): el campo con el precio vigente, la vigencia y el historial, lo que viaja al guardar (el importe
 * como texto decimal canónico), el error asociado al campo (con el importe vigente cuando otra persona cambió antes), el doble toque, sin permiso, «Según medida» sin campo, el teclado
 * y axe, tamaños y sin desborde en 390 y 1280 px.
 */
const PANTALLA: PreciosDeLaPantalla = {
  id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
  nombre: "Hamburguesa Funghi",
  tipo: "DE_LA_EMPRESA",
  vigente: { precioId: "p2", importe: "13000.000000", desde: "2026-11-02" },
  historial: [
    { importe: "12000.000000", desde: "2026-10-20" },
    { importe: "11500.000000", desde: "2026-10-15" },
  ],
  claveDelCambio: "clave",
};
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });

afterEach(async () => {
  await page.viewport(390, 844);
});

const formulario = (
  precios: PreciosArmados = armarLosPrecios(PANTALLA),
  accion: AccionDeFormulario = ok,
  puedeGuardar = true,
) => <FormularioDePrecioDeProducto precios={precios} accion={accion} puedeGuardar={puedeGuardar} />;
const rechazo =
  (error: ErrorPublico): AccionDeFormulario =>
  () =>
    Promise.resolve({ error });
const campo = () => page.getByLabelText("Precio (IVA incluido)", { exact: true });
const guardar = () => page.getByRole("button", { name: "Guardar" });
const INVALIDO: ErrorPublico = {
  codigo: "CATALOGO_PRECIO_INVALIDO",
  clave: "catalogo.error.precio_invalido",
  presentacion: "AVISO",
  campo: "precio",
};
const DESACTUALIZADO: ErrorPublico = {
  codigo: "CATALOGO_PRECIO_DESACTUALIZADO",
  clave: "catalogo.precio.vigente_ahora",
  presentacion: "AVISO",
  campo: "precio",
  parametros: { importe: "15000.000000" },
};

describe("FormularioDePrecioDeProducto", () => {
  it("axe, tamaños y sin desborde en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 1200],
      [1280, 900],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(formulario());
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(ancho);
      await unmount();
    }
  });

  it("trae el precio vigente en el campo, desde cuándo rige y el historial", async () => {
    await render(formulario());
    await expect.element(campo()).toHaveValue("13.000,00");
    await expect.element(page.getByText("Vigente desde 02/11/2026")).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Historial" })).toBeVisible();
    const filas = [...document.querySelectorAll("li")].map((li) => li.textContent);
    expect(filas).toEqual(["$ 12.000,00" + "20/10/2026", "$ 11.500,00" + "15/10/2026"]);
  });

  it("sin precio: «Precio abierto», el campo vacío y sin historial", async () => {
    await render(formulario(armarLosPrecios({ ...PANTALLA, vigente: null, historial: [] })));
    await expect.element(campo()).toHaveValue("");
    await expect.element(page.getByText("Precio abierto")).toBeVisible();
    expect(document.querySelector("h2")).toBeNull();
  });

  it("el teclado va del precio a «Guardar»", async () => {
    await render(formulario());
    await userEvent.click(campo());
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe("Guardar");
  });

  it("al guardar manda el precio por su nombre como texto decimal canónico (nunca el texto con coma)", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarLosPrecios(PANTALLA), accion));
    await userEvent.fill(campo(), "14500,5");
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(datos.entries())).toEqual({ precio: "14500.50" });
  });

  it("guardar sin tocar el campo manda el precio vigente tal cual (el servidor lo reconoce como «sin cambio»)", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarLosPrecios(PANTALLA), accion));
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries((accion.mock.calls[0]?.[1] as FormData).entries())).toEqual({
      precio: "13000.00",
    });
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
    await render(formulario(armarLosPrecios(PANTALLA), accion));
    tocar(guardar());
    await expect.element(guardar()).toHaveAttribute("aria-busy", "true");
    tocar(guardar());
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(guardar()).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it("«Escribí un precio válido» se asocia al campo (aria-invalid y aria-describedby) y no se repite debajo", async () => {
    await render(formulario(armarLosPrecios(PANTALLA), rechazo(INVALIDO)));
    tocar(guardar());
    await expect.element(page.getByText("Escribí un precio válido")).toBeVisible();
    expect(document.body.textContent?.match(/Escribí un precio válido/g)).toHaveLength(1);
    const entrada = campo().element();
    expect(entrada.getAttribute("aria-invalid")).toBe("true");
    const descrito = entrada.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(descrito)?.textContent).toContain("Escribí un precio válido");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("si otra persona cambió el precio, la frase aprobada con el importe vigente, en el campo; lo que se escribió se conserva para revisarlo", async () => {
    await render(formulario(armarLosPrecios(PANTALLA), rechazo(DESACTUALIZADO)));
    await userEvent.fill(campo(), "14000");
    tocar(guardar());
    await expect
      .element(
        page.getByText("El precio vigente ahora es $ 15.000,00. Revisalo y volvé a intentar."),
      )
      .toBeVisible();
    await expect.element(campo()).toHaveAttribute("aria-invalid", "true");
    await expect.element(campo()).toHaveValue("14.000");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("un error sin campo (el genérico) sale debajo con el patrón común y el campo no queda inválido", async () => {
    await render(
      formulario(
        armarLosPrecios(PANTALLA),
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
        armarLosPrecios(PANTALLA),
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

  it("sin permiso, «Guardar» sale apagado y no envía", async () => {
    const accion = vi.fn(ok);
    await render(formulario(armarLosPrecios(PANTALLA), accion, false));
    await expect.element(guardar()).toBeDisabled();
    tocar(guardar());
    expect(accion).not.toHaveBeenCalled();
  });

  it("«Según medida»: solo el texto, sin campo ni botón", async () => {
    await render(
      formulario(
        armarLosPrecios({ ...PANTALLA, tipo: "SEGUN_MEDIDA", vigente: null, historial: [] }),
      ),
    );
    await expect.element(page.getByText("Según medida")).toBeVisible();
    expect(document.querySelector("input, button, form")).toBeNull();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});
