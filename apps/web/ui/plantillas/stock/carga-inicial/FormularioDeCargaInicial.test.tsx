import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { errorDeCodigo } from "../../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../../patrones/FormularioDeAccion.cliente";
import { FormularioDeCargaInicial } from "./FormularioDeCargaInicial.cliente";

/** La grilla de «Carga inicial» en Chromium (FP-STK-08): una fila por artículo con su valor, resumen, «Registrar» apagado con una fila a medias, nombres de campo por posición, y el aviso de existencia previa con reenvío confirmado. */
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const DEPOSITOS = [
  { valor: "d1", etiqueta: "Salón" },
  { valor: "d2", etiqueta: "Cocina" },
];
const ARTICULOS = [
  { valor: "a1", etiqueta: "Harina", controlDeLote: null },
  { valor: "a2", etiqueta: "Sal", controlDeLote: null },
];
/** Harina con control de lote y vencimiento; Sal con control de lote sin vencimiento; Azúcar sin control. */
const CON_LOTES = [
  { valor: "a1", etiqueta: "Harina", controlDeLote: "LOTE_Y_VENCIMIENTO" as const },
  { valor: "a2", etiqueta: "Sal", controlDeLote: "LOTE" as const },
  { valor: "a3", etiqueta: "Azúcar", controlDeLote: null },
];
const UNIDADES = { a1: "Kilogramo", a2: "Unidad", a3: "Kilogramo" };

const grilla = (
  accion: AccionDeFormulario = ok,
  puedeEnviar = true,
  articulos: readonly (typeof ARTICULOS)[number][] | typeof CON_LOTES = ARTICULOS,
) => (
  <FormularioDeCargaInicial
    accion={accion}
    depositos={DEPOSITOS}
    articulos={articulos}
    unidades={UNIDADES}
    hrefDeCancelar="/stock/existencias"
    puedeEnviar={puedeEnviar}
  />
);
const registrar = () => page.getByRole("button", { name: "Registrar" });

describe("FormularioDeCargaInicial", () => {
  it("arranca con una fila con el primer artículo y la unidad; «Registrar» espera la cantidad; es accesible", async () => {
    await render(grilla());
    await expect.element(page.getByLabelText("Depósitos")).toHaveValue("d1");
    await expect.element(page.getByLabelText("Artículo")).toHaveValue("a1");
    await expect.element(page.getByText("Kilogramo")).toBeVisible();
    await expect.element(registrar()).toBeDisabled();
    await expect.element(page.getByText("La carga queda con la fecha de hoy")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("con cantidad y costo muestra el valor de la fila y el resumen; sin costo avisa cuántas filas van sin costo", async () => {
    await render(grilla());
    await userEvent.fill(page.getByLabelText("Cantidad"), "10");
    await expect.element(registrar()).toBeEnabled();
    await expect.element(page.getByText("1 artículos por")).toBeVisible();
    await expect.element(page.getByText("1 sin costo: no entran al promedio")).toBeVisible();
    await userEvent.fill(page.getByLabelText("Costo por unidad"), "12,5");
    await expect.element(page.getByText("$ 125,00").first()).toBeVisible();
    await expect.element(page.getByText("1 artículos por $ 125,00")).toBeVisible();
    expect(page.getByText("sin costo", { exact: false }).elements()).toHaveLength(0);
  });

  it("«Agregar artículo» suma una fila con el otro artículo (el elegido no se repite) y se apaga sin más artículos; «Quitar» la saca", async () => {
    await render(grilla());
    await userEvent.fill(page.getByLabelText("Cantidad"), "1");
    await page.getByRole("button", { name: "Agregar artículo" }).click();
    expect(page.getByLabelText("Artículo").elements()).toHaveLength(2);
    await expect.element(page.getByLabelText("Artículo").nth(1)).toHaveValue("a2");
    expect(page.getByLabelText("Artículo").nth(0).getByRole("option").elements()).toHaveLength(1);
    await expect.element(page.getByRole("button", { name: "Agregar artículo" })).toBeDisabled();
    await expect.element(registrar()).toBeDisabled();
    await page.getByRole("button", { name: "Quitar" }).nth(1).click();
    expect(page.getByLabelText("Artículo").elements()).toHaveLength(1);
    await expect.element(page.getByRole("button", { name: "Quitar" })).toBeDisabled();
  });

  it("una cantidad en cero o un costo roto marcan la fila con su texto y no dejan registrar", async () => {
    await render(grilla());
    await userEvent.fill(page.getByLabelText("Cantidad"), "0");
    await expect.element(page.getByText("La cantidad tiene que ser mayor que cero")).toBeVisible();
    await expect.element(registrar()).toBeDisabled();
  });

  it("manda un solo envío con los nombres por posición y el texto decimal canónico (nunca un número)", async () => {
    const accion = vi.fn<AccionDeFormulario>(() => Promise.resolve({ error: null }));
    await render(grilla(accion));
    await userEvent.fill(page.getByLabelText("Cantidad"), "1.250,5");
    await userEvent.fill(page.getByLabelText("Costo por unidad"), "0,000001");
    tocar(registrar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = accion.mock.calls[0]?.[1];
    expect(Object.fromEntries(datos?.entries() ?? [])).toMatchObject({
      depositoId: "d1",
      "articuloId.0": "a1",
      "cantidad.0": "1250.5",
      "costoUnitario.0": "0.000001",
    });
    expect(datos?.get("confirmar")).toBeNull();
  });

  it("sin permiso «Registrar» sale apagado", async () => {
    await render(grilla(ok, false));
    await userEvent.fill(page.getByLabelText("Cantidad"), "1");
    await expect.element(registrar()).toBeDisabled();
  });

  it("con existencia previa avisa y no confirma solo; el próximo «Registrar» reenvía confirmando; cambiar un dato descarta la confirmación", async () => {
    const aviso = { error: errorDeCodigo("STOCK_YA_HAY_EXISTENCIA") };
    const accion = vi.fn<AccionDeFormulario>(() => Promise.resolve(aviso));
    await render(grilla(accion));
    await userEvent.fill(page.getByLabelText("Cantidad"), "3");
    tocar(registrar());
    await expect
      .element(page.getByText("Este depósito ya tiene existencia. ¿Registrar igual?"))
      .toBeVisible();
    expect(accion.mock.calls[0]?.[1].get("confirmar")).toBeNull();
    tocar(registrar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2));
    expect(accion.mock.calls[1]?.[1].get("confirmar")).toBe("1");
    await userEvent.fill(page.getByLabelText("Cantidad"), "4");
    tocar(registrar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(3));
    expect(accion.mock.calls[2]?.[1].get("confirmar")).toBeNull();
  });

  it("una fila de un artículo controlado por lote pide «Lote» y «Vence»; sin vencimiento en el control pide solo «Lote»; sin control no pide nada", async () => {
    await render(grilla(ok, true, CON_LOTES));
    await userEvent.fill(page.getByLabelText("Cantidad"), "4");
    await expect.element(page.getByLabelText("Lote")).toBeVisible();
    await expect.element(page.getByLabelText("Vence")).toBeVisible();
    await expect.element(registrar()).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Lote"), "L-1");
    await expect.element(registrar()).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Vence"), "2099-06-01");
    await expect.element(registrar()).toBeEnabled();
    await userEvent.selectOptions(page.getByLabelText("Artículo"), "a2");
    expect(page.getByLabelText("Vence").elements()).toHaveLength(0);
    await expect.element(page.getByLabelText("Lote")).toBeVisible();
    await userEvent.selectOptions(page.getByLabelText("Artículo"), "a3");
    expect(page.getByLabelText("Lote").elements()).toHaveLength(0);
    await expect.element(registrar()).toBeEnabled();
  });

  it("manda el lote y el vencimiento por posición, junto con la cantidad como texto decimal exacto", async () => {
    const accion = vi.fn<AccionDeFormulario>(ok);
    await render(grilla(accion, true, CON_LOTES));
    await userEvent.fill(page.getByLabelText("Cantidad"), "4,5");
    await userEvent.fill(page.getByLabelText("Lote"), "L-1");
    await userEvent.fill(page.getByLabelText("Vence"), "2099-06-01");
    tocar(registrar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = Object.fromEntries(accion.mock.calls[0]?.[1].entries() ?? []);
    expect(datos).toMatchObject({
      "articuloId.0": "a1",
      "cantidad.0": "4.5",
      "loteCodigo.0": "L-1",
      "loteVence.0": "2099-06-01",
    });
  });
});
