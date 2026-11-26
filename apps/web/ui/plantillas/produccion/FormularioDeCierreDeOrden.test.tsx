import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { errorDeCodigo } from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeCierreDeOrden } from "./FormularioDeCierreDeOrden.cliente";
import { armarElCierre } from "./modelo-de-cierre-de-orden";

/**
 * «Cerrar con lo real» en Chromium (maqueta `produccion.html`): un campo por ingrediente con lo esperado de valor inicial, la cantidad obtenida, el vencimiento, «Cerrar la orden» que espera lo necesario y el permiso,
 * el doble toque manda un solo envío, los nombres de campo son los que espera el servidor (y no hay otros: ni producto, ni unidad, ni orden), y tras el aviso de faltante el botón pasa a «Producir igual» y reenvía
 * confirmando; cambiar un dato descarta la confirmación. Las reglas de las cantidades, el vencimiento, el permiso y el stock las prueba el servidor.
 */
const CIERRE = armarElCierre({
  id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
  numero: 14,
  nombre: "Masa de medialuna",
  unidadId: "KILOGRAMO",
  cantidadEsperada: "16.0000",
  renglones: [
    { nombre: "Harina 000", esperado: "12.0000", unidadId: "KILOGRAMO" },
    { nombre: "Manteca", esperado: "4.0000", unidadId: "KILOGRAMO" },
  ],
});
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const formulario = (accion: AccionDeFormulario = ok, puedeEnviar = true) => (
  <FormularioDeCierreDeOrden accion={accion} cierre={CIERRE} puedeEnviar={puedeEnviar} />
);

describe("FormularioDeCierreDeOrden", () => {
  it("lleva un campo por ingrediente con lo esperado, la cantidad obtenida (con lo esperado), el vencimiento y «Cancelar» a la ficha; es accesible", async () => {
    await render(formulario());
    await expect.element(page.getByLabelText("Harina 000 (Kilogramo)")).toHaveValue("12");
    await expect.element(page.getByLabelText("Manteca (Kilogramo)")).toHaveValue("4");
    await expect.element(page.getByLabelText("Cantidad obtenida (Kilogramo)")).toHaveValue("16");
    await expect.element(page.getByLabelText("Vence")).toBeVisible();
    await expect.element(page.getByText("Masa de medialuna")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Cancelar" }))
      .toHaveAttribute("href", "/catalogo/produccion/0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Cerrar la orden» espera la cantidad obtenida y el permiso; un consumo en blanco es válido (cero)", async () => {
    await render(formulario());
    await userEvent.clear(page.getByLabelText("Manteca (Kilogramo)"));
    await expect.element(page.getByRole("button", { name: "Cerrar la orden" })).toBeEnabled();
    await userEvent.clear(page.getByLabelText("Cantidad obtenida (Kilogramo)"));
    await expect.element(page.getByRole("button", { name: "Cerrar la orden" })).toBeDisabled();
  });

  it("sin permiso, «Cerrar la orden» sale apagado y no envía", async () => {
    const accion = vi.fn(ok);
    await render(formulario(accion, false));
    const cerrar = page.getByRole("button", { name: "Cerrar la orden" });
    await expect.element(cerrar).toBeDisabled();
    tocar(cerrar);
    expect(accion).not.toHaveBeenCalled();
  });

  it("manda lo real por posición, lo obtenido y el vencimiento con los nombres del servidor (y nada más), y el doble toque dispara un solo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (_previo: unknown, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(formulario(accion));
    await userEvent.fill(page.getByLabelText("Harina 000 (Kilogramo)"), "11,5");
    await userEvent.clear(page.getByLabelText("Manteca (Kilogramo)"));
    await userEvent.fill(page.getByLabelText("Cantidad obtenida (Kilogramo)"), "15");
    await userEvent.fill(page.getByLabelText("Vence"), "2026-12-31");
    const cerrar = page.getByRole("button", { name: "Cerrar la orden" });
    tocar(cerrar);
    await expect.element(cerrar).toHaveAttribute("aria-busy", "true");
    tocar(cerrar);
    tocar(cerrar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(cerrar).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(datos.getAll("consumos")).toEqual(["11.5", ""]);
    expect([...datos.keys()].sort()).toEqual(["consumos", "consumos", "obtenido", "vence"]);
    expect(datos.get("obtenido")).toBe("15");
    expect(datos.get("vence")).toBe("2026-12-31");
  });

  it("tras el aviso de faltante el botón pasa a «Producir igual» y reenvía confirmando", async () => {
    const aviso = { error: errorDeCodigo("STOCK_CONTROL_AVISA") };
    const accion = vi.fn((_previo: unknown, datos: FormData) => {
      void datos;
      return Promise.resolve(accion.mock.calls.length === 1 ? aviso : { error: null });
    });
    await render(formulario(accion));
    tocar(page.getByRole("button", { name: "Cerrar la orden" }));
    await expect.element(page.getByText("Va a quedar en negativo. ¿Confirmás?")).toBeVisible();
    expect(accion.mock.calls[0]?.[1].get("confirmar")).toBeNull();
    const igual = page.getByRole("button", { name: "Producir igual" });
    await expect.element(igual).toBeVisible();
    tocar(igual);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2));
    expect(accion.mock.calls[1]?.[1].get("confirmar")).toBe("1");
  });

  it("si después del aviso cambia un consumo, lo obtenido o el vencimiento, vuelve «Cerrar la orden» y el reenvío ya no confirma", async () => {
    const aviso = { error: errorDeCodigo("STOCK_CONTROL_AVISA") };
    const accion = vi.fn((_previo: unknown, datos: FormData) => {
      void datos;
      return Promise.resolve(aviso);
    });
    await render(formulario(accion));
    tocar(page.getByRole("button", { name: "Cerrar la orden" }));
    await expect.element(page.getByRole("button", { name: "Producir igual" })).toBeVisible();
    for (const [campo, valor] of [
      ["Harina 000 (Kilogramo)", "13"],
      ["Cantidad obtenida (Kilogramo)", "14"],
      ["Vence", "2026-12-31"],
    ] as const) {
      await userEvent.fill(page.getByLabelText(campo), valor);
      await expect.element(page.getByRole("button", { name: "Cerrar la orden" })).toBeVisible();
      tocar(page.getByRole("button", { name: "Cerrar la orden" }));
      await expect.element(page.getByRole("button", { name: "Producir igual" })).toBeVisible();
    }
    for (const llamada of accion.mock.calls) expect(llamada[1].get("confirmar")).toBeNull();
  });

  it("el vencimiento que falta sale con su texto aprobado y el botón sigue «Cerrar la orden»", async () => {
    const accion = vi.fn((_previo: unknown, datos: FormData) => {
      void datos;
      return Promise.resolve({ error: errorDeCodigo("PRODUCCION_VENCIMIENTO_REQUERIDO") });
    });
    await render(formulario(accion));
    tocar(page.getByRole("button", { name: "Cerrar la orden" }));
    await expect.element(page.getByText("Falta la fecha de vencimiento")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Cerrar la orden" })).toBeVisible();
    expect(page.getByRole("button", { name: "Producir igual" }).elements()).toHaveLength(0);
  });
});
