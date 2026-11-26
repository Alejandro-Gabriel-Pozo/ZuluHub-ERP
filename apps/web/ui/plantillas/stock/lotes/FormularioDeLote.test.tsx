import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { errorDeCodigo } from "../../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../../patrones/FormularioDeAccion.cliente";
import { FormularioDeCorregirLote } from "./FormularioDeCorregirLote.cliente";
import { FormularioDeReasignarLote } from "./FormularioDeReasignarLote.cliente";

/** «Corregir» y «Reasignar» un lote en Chromium (FP-STK-16): botones apagados hasta tener lo obligatorio, sin permiso apagados, un solo envío con los nombres de campo y la cantidad como texto, y recarga si el servidor rechaza. */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
});
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });

const corregir = (accion = ok, puedeEnviar = true, venceActual = "2026-12-02") => (
  <FormularioDeCorregirLote
    accion={accion}
    codigo="Q-1104"
    venceActual={venceActual}
    hrefDeCancelar="/stock/lotes?articulo=a1"
    puedeEnviar={puedeEnviar}
  />
);
const guardar = () => page.getByRole("button", { name: "Guardar" });

describe("FormularioDeCorregirLote", () => {
  it("muestra el lote y su fecha actual; «Guardar» espera el motivo; es accesible", async () => {
    await render(corregir());
    await expect.element(page.getByText("Q-1104")).toBeVisible();
    await expect.element(page.getByLabelText("Fecha de vencimiento")).toHaveValue("2026-12-02");
    await expect.element(guardar()).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Detalle"), "se cargó mal");
    await expect.element(guardar()).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await expect
      .element(page.getByRole("link", { name: "Cancelar" }))
      .toHaveAttribute("href", "/stock/lotes?articulo=a1");
  });

  it("sin fecha, o sin permiso, «Guardar» sale apagado", async () => {
    await render(corregir(ok, true, ""));
    await userEvent.fill(page.getByLabelText("Detalle"), "x");
    await expect.element(guardar()).toBeDisabled();
  });

  it("sin permiso sale apagado aunque todo esté completo", async () => {
    await render(corregir(ok, false));
    await userEvent.fill(page.getByLabelText("Detalle"), "x");
    await expect.element(guardar()).toBeDisabled();
  });

  it("envía una sola vez la fecha como texto y el motivo", async () => {
    const accion = vi.fn<AccionDeFormulario>(ok);
    await render(corregir(accion));
    await userEvent.fill(page.getByLabelText("Fecha de vencimiento"), "2026-12-20");
    await userEvent.fill(page.getByLabelText("Detalle"), "se cargó mal");
    tocar(guardar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = Object.fromEntries(accion.mock.calls[0]?.[1].entries() ?? []);
    expect(datos).toMatchObject({ vence: "2026-12-20", detalle: "se cargó mal" });
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("si el servidor rechaza (otra persona lo corrigió antes) recarga para traer lo vigente", async () => {
    const accion = vi.fn<AccionDeFormulario>(() =>
      Promise.resolve({ error: errorDeCodigo("STOCK_ACCION_NO_PERMITIDA") }),
    );
    await render(corregir(accion));
    await userEvent.fill(page.getByLabelText("Detalle"), "x");
    tocar(guardar());
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
  });
});

const DEPOSITOS = [
  { valor: "d1", etiqueta: "Salón" },
  { valor: "d2", etiqueta: "Cocina" },
];
const DESTINOS = [
  { valor: "l1", etiqueta: "Q-1104" },
  { valor: "l2", etiqueta: "Q-1105" },
];
const reasignar = (accion = ok, puedeEnviar = true, destinos = DESTINOS) => (
  <FormularioDeReasignarLote
    accion={accion}
    origen="Sin asignar"
    unidad="Kilogramo"
    depositos={DEPOSITOS}
    destinos={destinos}
    hrefDeCancelar="/stock/lotes?articulo=a1"
    puedeEnviar={puedeEnviar}
  />
);
const registrar = () => page.getByRole("button", { name: "Registrar" });

describe("FormularioDeReasignarLote", () => {
  it("muestra el origen, el depósito, el destino y la unidad; «Registrar» espera la cantidad y el motivo; es accesible", async () => {
    await render(reasignar());
    await expect.element(page.getByText("Sin asignar")).toBeVisible();
    await expect.element(page.getByText("Kilogramo")).toBeVisible();
    await expect.element(page.getByLabelText("Depósitos")).toHaveValue("d1");
    await expect.element(page.getByLabelText("Lote")).toHaveValue("l1");
    await expect.element(registrar()).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Cantidad"), "2,5");
    await expect.element(registrar()).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Detalle"), "llegó el lote");
    await expect.element(registrar()).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin permiso, o sin lotes donde reasignar, «Registrar» sale apagado", async () => {
    await render(reasignar(ok, false));
    await userEvent.fill(page.getByLabelText("Cantidad"), "1");
    await userEvent.fill(page.getByLabelText("Detalle"), "x");
    await expect.element(registrar()).toBeDisabled();
  });

  it("sin destinos que ya existan no se puede registrar (nunca se crea un lote desde acá)", async () => {
    await render(reasignar(ok, true, []));
    await userEvent.fill(page.getByLabelText("Cantidad"), "1");
    await userEvent.fill(page.getByLabelText("Detalle"), "x");
    await expect.element(registrar()).toBeDisabled();
  });

  it("envía UN solo pedido con el depósito, el destino, la cantidad como texto decimal exacto y el motivo", async () => {
    const accion = vi.fn<AccionDeFormulario>(ok);
    await render(reasignar(accion));
    await userEvent.selectOptions(page.getByLabelText("Lote"), "l2");
    await userEvent.fill(page.getByLabelText("Cantidad"), "1.250,5");
    await userEvent.fill(page.getByLabelText("Detalle"), "llegó el lote");
    tocar(registrar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = Object.fromEntries(accion.mock.calls[0]?.[1].entries() ?? []);
    expect(datos).toMatchObject({
      depositoId: "d1",
      loteDestinoId: "l2",
      cantidad: "1250.5",
      detalle: "llegó el lote",
    });
  });

  it("si el servidor rechaza (por ejemplo el lote no tiene tanta existencia) muestra el error y recarga", async () => {
    const accion = vi.fn<AccionDeFormulario>(() =>
      Promise.resolve({ error: errorDeCodigo("STOCK_SALDO_DE_LOTE_INSUFICIENTE") }),
    );
    await render(reasignar(accion));
    await userEvent.fill(page.getByLabelText("Cantidad"), "99");
    await userEvent.fill(page.getByLabelText("Detalle"), "x");
    tocar(registrar());
    await expect.element(page.getByText("El lote no tiene tanta existencia")).toBeVisible();
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  });
});
