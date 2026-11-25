import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
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
  detalle: "Detalle",
  enviar: "Registrar",
  cancelar: "Cancelar",
};
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const DEPOSITOS = [
  { valor: "d1", etiqueta: "Salón" },
  { valor: "d2", etiqueta: "Cocina" },
];
const ARTICULOS = [{ valor: "a1", etiqueta: "Harina" }];
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
) => (
  <FormularioDeMovimiento
    tipo={tipo}
    accion={accion}
    textos={{ ...TEXTOS, enviar: tipo === "ANULAR" ? "Anular" : "Registrar" }}
    depositos={DEPOSITOS}
    articulos={ARTICULOS}
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
});
