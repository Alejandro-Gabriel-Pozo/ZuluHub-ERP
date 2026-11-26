import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { errorDeCodigo } from "../../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../../patrones/FormularioDeAccion.cliente";
import { FormularioDeAplicarConteo } from "./FormularioDeAplicarConteo.cliente";
import { FormularioDeCancelarConteo } from "./FormularioDeCancelarConteo.cliente";
import { ListaDeConteoAplicado } from "./ListaDeConteoAplicado";
import type { FilaParaRevisar } from "./modelo-de-conteo";

/** La revisión, el resultado y «Cancelar conteo» en Chromium (FP-STK-11, FP-STK-12): «Aplicar» apagado hasta explicar toda diferencia, nombres por artículo, recarga si el servidor rechaza, a ciegas. */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
});

const ok: AccionDeFormulario = () => Promise.resolve({ error: null });
const MOTIVOS_FALTANTE = [
  { codigo: "MERMA", etiqueta: "Merma", pideDetalle: false },
  { codigo: "OTRA_SALIDA", etiqueta: "Otra salida", pideDetalle: true },
];
const CON_DIFERENCIA: FilaParaRevisar = {
  articuloId: "a1",
  nombre: "Harina",
  contado: "18 kg",
  sistema: "20 kg",
  movido: "-1 kg",
  rotuloDeMovido: "Movido desde las 10:10",
  diferencia: "-1 kg",
  conDiferencia: true,
  motivos: MOTIVOS_FALTANTE,
};
const SIN_DIFERENCIA: FilaParaRevisar = {
  articuloId: "a2",
  nombre: "Sal",
  contado: "3 u",
  sistema: "3 u",
  movido: "0 u",
  rotuloDeMovido: "Movido desde las 10:10",
  diferencia: "0 u",
  conDiferencia: false,
  motivos: [],
};
const revision = (accion = ok, filas = [CON_DIFERENCIA, SIN_DIFERENCIA], puedeEnviar = true) => (
  <FormularioDeAplicarConteo
    accion={accion}
    filas={filas}
    hrefDeCancelar="/stock/conteo"
    puedeEnviar={puedeEnviar}
  />
);
const aplicar = () => page.getByRole("button", { name: "Aplicar" });

describe("FormularioDeAplicarConteo", () => {
  it("muestra lo contado, lo que el sistema creía, lo movido y la diferencia; es accesible", async () => {
    await render(revision());
    await expect.element(page.getByText("Sistema a esa hora").first()).toBeVisible();
    await expect.element(page.getByText("20 kg")).toBeVisible();
    await expect.element(page.getByText("Movido desde las 10:10").first()).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Aplicar» espera el motivo de toda diferencia; la fila sin diferencia no lo pide", async () => {
    await render(revision());
    await expect.element(aplicar()).toBeDisabled();
    expect(page.getByLabelText("Motivo").elements()).toHaveLength(1);
    await userEvent.selectOptions(page.getByLabelText("Motivo"), "MERMA");
    await expect.element(aplicar()).toBeEnabled();
  });

  it("un motivo que pide detalle exige el detalle", async () => {
    await render(revision());
    await userEvent.selectOptions(page.getByLabelText("Motivo"), "OTRA_SALIDA");
    await expect.element(aplicar()).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Detalle"), "se cayó");
    await expect.element(aplicar()).toBeEnabled();
  });

  it("sin permiso «Aplicar» sale apagado aunque todo esté explicado", async () => {
    await render(revision(ok, [SIN_DIFERENCIA], false));
    await expect.element(aplicar()).toBeDisabled();
  });

  it("envía una sola vez con los nombres por artículo (no por posición), sin campo oculto", async () => {
    const accion = vi.fn<AccionDeFormulario>(ok);
    await render(revision(accion));
    await userEvent.selectOptions(page.getByLabelText("Motivo"), "MERMA");
    tocar(aplicar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    const datos = Object.fromEntries(accion.mock.calls[0]?.[1].entries() ?? []);
    expect(datos).toMatchObject({ "motivo.a1": "MERMA" });
    expect(Object.keys(datos).some((k) => k.startsWith("articuloId"))).toBe(false);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("si el servidor rechaza (revisión desactualizada) recarga la pantalla para traer lo nuevo y conserva lo elegido", async () => {
    const accion = vi.fn<AccionDeFormulario>(() =>
      Promise.resolve({ error: errorDeCodigo("STOCK_ACCION_NO_PERMITIDA") }),
    );
    await render(revision(accion));
    await userEvent.selectOptions(page.getByLabelText("Motivo"), "MERMA");
    tocar(aplicar());
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    await expect.element(page.getByLabelText("Motivo")).toHaveValue("MERMA");
  });

  it("a ciegas: sin lo que el sistema creía ni la diferencia esas filas no existen", async () => {
    const ciega: FilaParaRevisar = {
      ...SIN_DIFERENCIA,
      sistema: null,
      movido: null,
      diferencia: null,
    };
    await render(revision(ok, [ciega]));
    expect(page.getByText("Sistema a esa hora").elements()).toHaveLength(0);
    expect(page.getByText("Diferencia").elements()).toHaveLength(0);
  });
});

describe("FormularioDeCancelarConteo", () => {
  const cancelar = () => page.getByRole("button", { name: "Cancelar conteo" });

  it("«Cancelar conteo» espera el motivo y envía una sola vez con él", async () => {
    const accion = vi.fn<AccionDeFormulario>(ok);
    await render(<FormularioDeCancelarConteo accion={accion} puedeEnviar />);
    await expect.element(cancelar()).toBeDisabled();
    await userEvent.fill(page.getByLabelText("Detalle"), "se contó mal");
    await expect.element(cancelar()).toBeEnabled();
    tocar(cancelar());
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    expect(accion.mock.calls[0]?.[1].get("motivo")).toBe("se contó mal");
  });

  it("sin permiso sale apagado", async () => {
    await render(<FormularioDeCancelarConteo accion={ok} puedeEnviar={false} />);
    await userEvent.fill(page.getByLabelText("Detalle"), "x");
    await expect.element(cancelar()).toBeDisabled();
  });
});

describe("ListaDeConteoAplicado", () => {
  it("muestra lo contado, la diferencia que quedó y el motivo con su detalle", async () => {
    await render(
      <ListaDeConteoAplicado
        titulo="Aplicado"
        filas={[
          {
            articuloId: "a1",
            nombre: "Harina",
            contado: "18 kg",
            diferencia: "-2 kg",
            motivo: "Otra salida",
            detalle: "se cayó",
          },
          {
            articuloId: "a2",
            nombre: "Sal",
            contado: "3 u",
            diferencia: "0 u",
            motivo: null,
            detalle: null,
          },
        ]}
        rotulos={{ contado: "Contado", diferencia: "Diferencia", motivo: "Motivo" }}
      />,
    );
    await expect.element(page.getByText("Aplicado")).toBeVisible();
    await expect.element(page.getByText("Otra salida: se cayó")).toBeVisible();
    expect(page.getByText("Motivo").elements()).toHaveLength(1);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });
});
