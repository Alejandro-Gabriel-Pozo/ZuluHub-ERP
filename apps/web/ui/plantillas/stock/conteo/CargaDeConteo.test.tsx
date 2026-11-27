import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { errorDeCodigo } from "../../../../../../src/capacidades/experiencia/respuesta";
import { violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import { CargaDeConteo, type PropsDeCargaDeConteo } from "./CargaDeConteo.cliente";

/** La carga del conteo en Chromium (FP-STK-10): una fila por artículo, guardado al salir del campo, cero válido, reintento con el MISMO id y recontar con otro. */
type Guardar = PropsDeCargaDeConteo["guardar"];
const ARTICULOS = [
  { articuloId: "a1", nombre: "Harina", unidad: "Kilogramo", contado: null },
  { articuloId: "a2", nombre: "Sal", unidad: "Unidad", contado: "18.0000" },
];
const ok: Guardar = () => Promise.resolve({ error: null });
const carga = (guardar: Guardar = ok) => <CargaDeConteo articulos={ARTICULOS} guardar={guardar} />;
const contado = (i: number) => page.getByLabelText("Contado").nth(i);

describe("CargaDeConteo", () => {
  it("muestra una fila por artículo con su unidad y lo ya guardado sin ceros de sobra; es accesible y a ciegas (sin nada del sistema)", async () => {
    await render(carga());
    await expect.element(page.getByText("Harina")).toBeVisible();
    await expect.element(page.getByText("Kilogramo")).toBeVisible();
    await expect.element(contado(0)).toHaveValue("");
    await expect.element(contado(1)).toHaveValue("18");
    expect(page.getByText("Sistema", { exact: false }).elements()).toHaveLength(0);
    expect(page.getByText("Diferencia", { exact: false }).elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("guarda al SALIR del campo, con el texto decimal canónico y la hora vacía; sin tocar nada no guarda", async () => {
    const guardar = vi.fn<Guardar>(ok);
    await render(carga(guardar));
    await userEvent.click(contado(0));
    await userEvent.tab();
    expect(guardar).not.toHaveBeenCalled();
    await userEvent.fill(contado(0), "17,5");
    expect(guardar).not.toHaveBeenCalled();
    await userEvent.tab();
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(1));
    expect(guardar.mock.calls[0]?.[0]).toMatchObject({
      articuloId: "a1",
      cantidad: "17.5",
      hora: "",
    });
  });

  it("cero es una cantidad contada y se guarda", async () => {
    const guardar = vi.fn<Guardar>(ok);
    await render(carga(guardar));
    await userEvent.fill(contado(0), "0");
    await userEvent.tab();
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(1));
    expect(guardar.mock.calls[0]?.[0].cantidad).toBe("0");
  });

  it("lo mismo ya guardado no se vuelve a guardar al salir del campo", async () => {
    const guardar = vi.fn<Guardar>(ok);
    await render(carga(guardar));
    await userEvent.click(contado(1));
    await userEvent.tab();
    expect(guardar).not.toHaveBeenCalled();
  });

  it("la hora del conteo se guarda con la cantidad", async () => {
    const guardar = vi.fn<Guardar>(ok);
    await render(carga(guardar));
    await userEvent.fill(contado(0), "4");
    await userEvent.fill(page.getByLabelText("Hora del conteo").nth(0), "10:05");
    await userEvent.click(contado(1)); // un campo de hora tiene segmentos: Tab no sale de él
    await vi.waitFor(() => expect(guardar.mock.calls.at(-1)?.[0].hora).toBe("10:05"));
    const ultima = guardar.mock.calls.at(-1)?.[0];
    expect(ultima).toMatchObject({ articuloId: "a1", cantidad: "4", hora: "10:05" });
  });

  it("si falla muestra el error en la fila y el reintento del MISMO valor reusa el id (no duplica); recontar usa otro", async () => {
    const guardar = vi
      .fn<Guardar>()
      .mockResolvedValueOnce({ error: errorDeCodigo("STOCK_ACCION_NO_PERMITIDA") })
      .mockResolvedValue({ error: null });
    await render(carga(guardar));
    await userEvent.fill(contado(0), "5");
    await userEvent.tab();
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(1));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    await userEvent.click(contado(0));
    await userEvent.tab();
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(2));
    expect(guardar.mock.calls[1]?.[0].id).toBe(guardar.mock.calls[0]?.[0].id);
    expect(page.getByText("Esta acción no está permitida").elements()).toHaveLength(0);
    await userEvent.fill(contado(0), "6");
    await userEvent.tab();
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(3));
    expect(guardar.mock.calls[2]?.[0].id).not.toBe(guardar.mock.calls[0]?.[0].id);
  });
});
