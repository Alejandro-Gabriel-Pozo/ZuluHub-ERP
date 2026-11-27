import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { errorDeCodigo } from "../../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../../patrones/FormularioDeAccion.cliente";
import { FormularioDeMovimiento } from "./FormularioDeMovimiento.cliente";
import type { TipoDeMovimiento } from "./modelo-de-formularios";

/**
 * Los formularios de movimiento de stock en Chromium (maqueta `stock.html`): cada tipo muestra solo sus campos, el costo aparece solo con el motivo «Compra», «Registrar» espera lo mínimo y el permiso,
 * el doble toque manda un solo envío y los nombres de campo son los que espera el servidor. Las reglas de cantidad, costo y permisos las prueba el servidor.
 */
const TEXTOS = {
  deposito: "Depósitos",
  origen: "Origen",
  destino: "Destino",
  articulo: "Artículo",
  sentido: "Ajustar",
  cantidad: "Cantidad",
  motivo: "Motivo",
  costo: "Costo por unidad",
  opcional: "(opcional)",
  lote: "Lote",
  vence: "Vence",
  detalle: "Detalle",
  enviar: "Registrar",
  cancelar: "Cancelar",
};
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const DEPOSITOS = [
  { valor: "d1", etiqueta: "Salón" },
  { valor: "d2", etiqueta: "Cocina" },
];
const ARTICULOS = [{ valor: "a1", etiqueta: "Harina", controlDeLote: null }];
/** Harina con control de lote y vencimiento, Sal con control de lote sin vencimiento y Azúcar sin control. */
const CON_LOTES = [
  { valor: "a1", etiqueta: "Harina", controlDeLote: "LOTE_Y_VENCIMIENTO" as const },
  { valor: "a2", etiqueta: "Sal", controlDeLote: "LOTE" as const },
  { valor: "a3", etiqueta: "Azúcar", controlDeLote: null },
];
const MOTIVOS = [
  { valor: "COMPRA", etiqueta: "Compra" },
  { valor: "OTRA_ENTRADA", etiqueta: "Otra entrada" },
];
const SENTIDOS = [
  { valor: "SUMA", etiqueta: "Sobra" },
  { valor: "RESTA", etiqueta: "Falta" },
];

const formulario = (
  tipo: TipoDeMovimiento,
  accion: AccionDeFormulario = ok,
  puedeEnviar = true,
  articulos: readonly (typeof ARTICULOS)[number][] | typeof CON_LOTES = ARTICULOS,
) => (
  <FormularioDeMovimiento
    tipo={tipo}
    accion={accion}
    textos={{ ...TEXTOS, enviar: tipo === "ANULAR" ? "Anular" : "Registrar" }}
    depositos={DEPOSITOS}
    articulos={articulos}
    motivos={MOTIVOS}
    sentidos={SENTIDOS}
    hrefDeCancelar="/stock/movimientos"
    puedeEnviar={puedeEnviar}
  />
);
const existe = (nombre: string) => page.getByLabelText(nombre).elements().length > 0;

describe("FormularioDeMovimiento", () => {
  it("la entrada lleva depósito, artículo, cantidad, motivo y detalle; el costo aparece solo con «Compra»; es accesible", async () => {
    await render(formulario("ENTRADA"));
    for (const n of ["Depósitos", "Artículo", "Cantidad", "Motivo", "Detalle"])
      expect(existe(n), n).toBe(true);
    expect(existe("Costo por unidad")).toBe(true);
    await userEvent.selectOptions(page.getByLabelText("Motivo"), "OTRA_ENTRADA");
    expect(existe("Costo por unidad")).toBe(false);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("cada tipo muestra solo sus campos: salida sin costo, transferir con origen y destino, ajustar con sobra y falta, anular solo con el detalle", async () => {
    const { unmount } = await render(formulario("SALIDA"));
    expect(existe("Costo por unidad")).toBe(false);
    expect(existe("Motivo")).toBe(true);
    await unmount();
    const t = await render(formulario("TRANSFERIR"));
    expect(["Origen", "Destino", "Artículo", "Cantidad"].every(existe)).toBe(true);
    expect([existe("Motivo"), existe("Detalle")]).toEqual([false, false]);
    await t.unmount();
    const a = await render(formulario("AJUSTAR"));
    await expect.element(page.getByLabelText("Ajustar")).toHaveValue("SUMA");
    expect(existe("Detalle")).toBe(true);
    await a.unmount();
    await render(formulario("ANULAR"));
    expect(existe("Detalle")).toBe(true);
    expect(["Cantidad", "Artículo", "Depósitos"].some(existe)).toBe(false);
  });

  it("«Registrar» espera la cantidad (y el detalle donde es obligatorio) y el permiso", async () => {
    await render(formulario("AJUSTAR"));
    const registrar = page.getByRole("button", { name: "Registrar" });
    await expect.element(registrar).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Cantidad"), "2");
    await expect.element(registrar).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Detalle"), "Se rompió");
    await expect.element(registrar).toBeEnabled();
  });

  it("sin permiso, «Registrar» sale apagado y no envía", async () => {
    const accion = vi.fn(ok);
    await render(formulario("ENTRADA", accion, false));
    await userEvent.fill(page.getByLabelText("Cantidad"), "2");
    const registrar = page.getByRole("button", { name: "Registrar" });
    await expect.element(registrar).toBeDisabled();
    tocar(registrar);
    expect(accion).not.toHaveBeenCalled();
  });

  it("manda los campos con los nombres del servidor y el doble toque dispara un solo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (_previo: unknown, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(formulario("ENTRADA", accion));
    await userEvent.fill(page.getByLabelText("Cantidad"), "2,5");
    await userEvent.fill(page.getByLabelText("Costo por unidad"), "10.5");
    const registrar = page.getByRole("button", { name: "Registrar" });
    tocar(registrar);
    await expect.element(registrar).toHaveAttribute("aria-busy", "true");
    tocar(registrar);
    tocar(registrar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(registrar).not.toHaveAttribute("aria-busy", "true");
    expect(accion).toHaveBeenCalledTimes(1);
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(datos.entries())).toMatchObject({
      depositoId: "d1",
      articuloId: "a1",
      cantidad: "2,5",
      motivo: "COMPRA",
      costoUnitario: "10.5",
    });
  });

  it("transferir y ajustar mandan origen, destino y sentido", async () => {
    const accion = vi.fn(ok);
    await render(formulario("TRANSFERIR", accion));
    await userEvent.fill(page.getByLabelText("Cantidad"), "1");
    tocar(page.getByRole("button", { name: "Registrar" }));
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries((accion.mock.calls[0]?.[1] as FormData).entries())).toMatchObject({
      origenId: "d1",
      destinoId: "d2",
      articuloId: "a1",
      cantidad: "1",
    });
  });

  it("tras el aviso de negativo, «Registrar» reenvía confirmando; cambiar un dato descarta la confirmación", async () => {
    const aviso = { error: errorDeCodigo("STOCK_CONTROL_AVISA") };
    const accion = vi.fn((_previo: unknown, datos: FormData) => {
      void datos;
      return Promise.resolve(accion.mock.calls.length === 1 ? aviso : { error: null });
    });
    await render(formulario("SALIDA", accion));
    await userEvent.fill(page.getByLabelText("Cantidad"), "3");
    const registrar = page.getByRole("button", { name: "Registrar" });
    tocar(registrar);
    await expect.element(page.getByText("Va a quedar en negativo. ¿Confirmás?")).toBeVisible();
    expect(accion.mock.calls[0]?.[1].get("confirmar")).toBeNull();
    tocar(registrar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2));
    expect(accion.mock.calls[1]?.[1].get("confirmar")).toBe("1");
  });

  it("si después del aviso la persona cambia la cantidad, el reenvío ya no confirma", async () => {
    const aviso = { error: errorDeCodigo("STOCK_CONTROL_AVISA") };
    const accion = vi.fn((_previo: unknown, datos: FormData) => {
      void datos;
      return Promise.resolve(aviso);
    });
    await render(formulario("SALIDA", accion));
    await userEvent.fill(page.getByLabelText("Cantidad"), "3");
    const registrar = page.getByRole("button", { name: "Registrar" });
    tocar(registrar);
    await expect.element(page.getByText("Va a quedar en negativo. ¿Confirmás?")).toBeVisible();
    await userEvent.fill(page.getByLabelText("Cantidad"), "9");
    tocar(registrar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(2));
    expect(accion.mock.calls[1]?.[1].get("confirmar")).toBeNull();
  });

  it("una ENTRADA de un artículo controlado por lote pide «Lote» y «Vence»; con control sin vencimiento, solo «Lote»; sin control, nada; «Registrar» espera lo que se pide", async () => {
    await render(formulario("ENTRADA", ok, true, CON_LOTES));
    expect(existe("Lote")).toBe(true);
    expect(existe("Vence")).toBe(true);
    await userEvent.fill(page.getByLabelText("Cantidad"), "5");
    await expect.element(page.getByRole("button", { name: "Registrar" })).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Lote"), "L-1");
    await expect.element(page.getByRole("button", { name: "Registrar" })).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Vence"), "2099-06-01");
    await expect.element(page.getByRole("button", { name: "Registrar" })).toBeEnabled();
    await userEvent.selectOptions(page.getByLabelText("Artículo"), "a2");
    expect(existe("Vence")).toBe(false);
    expect(existe("Lote")).toBe(true);
    await userEvent.selectOptions(page.getByLabelText("Artículo"), "a3");
    expect(existe("Lote")).toBe(false);
    await expect.element(page.getByRole("button", { name: "Registrar" })).toBeEnabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("los campos de lote solo existen en la ENTRADA: una salida de un artículo controlado por lote no los ofrece", async () => {
    await render(formulario("SALIDA", ok, true, CON_LOTES));
    expect(existe("Lote")).toBe(false);
    expect(existe("Vence")).toBe(false);
  });

  it("envía UN solo pedido con el lote y el vencimiento como texto; si el artículo deja de pedir lote, no manda nada de lote", async () => {
    const accion = vi.fn<AccionDeFormulario>(ok);
    await render(formulario("ENTRADA", accion, true, CON_LOTES));
    await userEvent.fill(page.getByLabelText("Cantidad"), "5");
    await userEvent.fill(page.getByLabelText("Lote"), "L-1");
    await userEvent.fill(page.getByLabelText("Vence"), "2099-06-01");
    tocar(page.getByRole("button", { name: "Registrar" }));
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(accion.mock.calls[0]?.[1].entries() ?? [])).toMatchObject({
      articuloId: "a1",
      loteCodigo: "L-1",
      loteVence: "2099-06-01",
    });
  });
});
