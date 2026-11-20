import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { BIEN, CONTEO, GENERICO, INESPERADO } from "./ayudas-de-pruebas";
import { FormularioDeCierre } from "./FormularioDeCierre.cliente";

/**
 * «Contar» y «Cerrar caja» en Chromium (maqueta `caja.html`, `vCierre`): el efectivo por billetes y monedas con su total contado y su diferencia, los demás medios con su total o «Conforme», «Conforme
 * general», la observación, el pedido de cierre, «Cancelar cierre», los apagados por permisos y los errores como el genérico. Las acciones van simuladas: el esperado y la cuenta definitiva son del servidor.
 */
const cerrar = vi.fn<(pedido: unknown) => Promise<typeof BIEN>>();
const cancelarCierre = vi.fn<(pedido: unknown) => Promise<typeof BIEN>>();
const alCerrar = vi.fn();
const alCancelarElCierre = vi.fn();
const alVolver = vi.fn();

beforeEach(() => {
  for (const f of [cerrar, cancelarCierre, alCerrar, alCancelarElCierre, alVolver]) f.mockReset();
  cerrar.mockResolvedValue(BIEN);
  cancelarCierre.mockResolvedValue(BIEN);
});

const formulario = (
  cambios: Partial<{ puedeCerrar: boolean; puedeCancelarCierre: boolean }> = {},
) => (
  <FormularioDeCierre
    conteo={CONTEO}
    cerrar={cerrar}
    cancelarCierre={cancelarCierre}
    puedeCerrar={cambios.puedeCerrar ?? true}
    puedeCancelarCierre={cambios.puedeCancelarCierre ?? true}
    largoMaximoDeLaObservacion={30}
    alCerrar={alCerrar}
    alCancelarElCierre={alCancelarElCierre}
    alVolver={alVolver}
  />
);
const billete = (rotulo: string) => page.getByLabelText(rotulo, { exact: true });
const medio = (nombre: string) => page.getByRole("group", { name: nombre });

describe("Contar", () => {
  it("el efectivo muestra lo esperado, una fila por denominación y las monedas; los demás medios, lo esperado y su cuenta; es accesible", async () => {
    await render(formulario());
    await expect.element(medio("Efectivo")).toBeVisible();
    await expect.element(page.getByText("$ 50.900,00", { exact: true })).toBeVisible();
    for (const d of ["$ 20.000", "$ 10.000", "$ 2.000", "$ 1.000", "$ 500", "$ 200", "$ 100"]) {
      await expect.element(billete(d)).toBeVisible();
    }
    await expect.element(page.getByLabelText("Monedas")).toBeVisible();
    await expect.element(medio("Tarjeta de débito · Posnet 1")).toBeVisible();
    await expect.element(medio("QR · Sin cuenta")).toBeVisible();
    await expect.element(page.getByText("Sin declarar").first()).toBeVisible();
    expect(page.getByText("Sugerido").elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("suma los billetes por denominación y las monedas, y muestra el total y la diferencia contra lo esperado", async () => {
    await render(formulario());
    await userEvent.fill(billete("$ 20.000"), "2");
    await userEvent.fill(billete("$ 2.000"), "5");
    await userEvent.fill(billete("$ 500"), "1");
    await userEvent.fill(billete("$ 100"), "3");
    await expect.element(page.getByText("$ 40.000,00", { exact: true })).toBeVisible();
    await expect.element(page.getByText("$ 50.800,00", { exact: true })).toBeVisible();
    await expect.element(page.getByText("-$ 100,00", { exact: true })).toBeVisible();
    await userEvent.fill(page.getByLabelText("Monedas"), "100,50");
    await expect.element(page.getByText("$ 50.900,50", { exact: true })).toBeVisible();
    await expect.element(page.getByText("$ 0,50", { exact: true })).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("un medio que no es efectivo: el total declarado da su diferencia; «Conforme» la reemplaza y desmarca el total", async () => {
    await render(formulario());
    const debito = medio("Tarjeta de débito · Posnet 1");
    await userEvent.fill(debito.getByLabelText("Contado"), "52000");
    await expect.element(debito.getByText("-$ 300,00", { exact: true })).toBeVisible();
    await userEvent.click(debito.getByRole("button", { name: "Conforme" }));
    await expect
      .element(debito.getByRole("button", { name: "Conforme" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.element(debito.getByLabelText("Contado")).toHaveValue("");
    await expect.element(debito.getByText("Conforme", { exact: true }).last()).toBeVisible();
    await userEvent.fill(debito.getByLabelText("Contado"), "1");
    await expect
      .element(debito.getByRole("button", { name: "Conforme" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("«Conforme general» marca los medios sin total y deja el que ya tiene", async () => {
    await render(formulario());
    await userEvent.fill(medio("Tarjeta de débito · Posnet 1").getByLabelText("Contado"), "52300");
    await userEvent.click(page.getByRole("button", { name: "Conforme general" }));
    await expect
      .element(medio("QR · Sin cuenta").getByRole("button", { name: "Conforme" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(medio("Tarjeta de débito · Posnet 1").getByRole("button", { name: "Conforme" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("«Cerrar caja» manda billetes, monedas, lo declarado, «conforme general» y la observación; recarga al terminar", async () => {
    await render(formulario());
    await userEvent.fill(billete("$ 20.000"), "2");
    await userEvent.fill(billete("$ 2.000"), "5");
    await userEvent.fill(billete("$ 500"), "1");
    await userEvent.fill(billete("$ 100"), "3");
    await userEvent.fill(medio("Tarjeta de débito · Posnet 1").getByLabelText("Contado"), "52300");
    await userEvent.click(medio("QR · Sin cuenta").getByRole("button", { name: "Conforme" }));
    await userEvent.fill(
      page.getByLabelText("Observación (opcional)"),
      "Faltaron 100 pesos de vuelto",
    );
    const enviar = page.getByRole("button", { name: "Cerrar caja" });
    tocar(enviar);
    tocar(enviar);
    await vi.waitFor(() => {
      expect(cerrar).toHaveBeenCalledTimes(1);
    });
    expect(cerrar.mock.calls[0]?.[0]).toEqual({
      sesionId: "ses-1",
      conteo: {
        billetes: [
          { denominacion: 20000, cantidad: 2 },
          { denominacion: 2000, cantidad: 5 },
          { denominacion: 500, cantidad: 1 },
          { denominacion: 100, cantidad: 3 },
        ],
        monedas: "",
      },
      otros: [{ medioDePagoId: "m-de", cuentaDeCobroId: "c-1", contado: "52300.00" }],
      conformeGeneral: true,
      observacion: "Faltaron 100 pesos de vuelto",
    });
    await vi.waitFor(() => {
      expect(alCerrar).toHaveBeenCalledTimes(1);
    });
  });

  it("la observación no pasa del largo que dice su dato", async () => {
    await render(formulario());
    await userEvent.fill(page.getByLabelText("Observación (opcional)"), "y".repeat(50));
    await expect.element(page.getByLabelText("Observación (opcional)")).toHaveValue("y".repeat(30));
  });

  it("sin contar el efectivo el pedido va con `conteo: null` y lo que el servidor rechaza sale como el genérico", async () => {
    cerrar.mockResolvedValueOnce(GENERICO);
    await render(formulario());
    await userEvent.click(page.getByRole("button", { name: "Conforme general" }));
    tocar(page.getByRole("button", { name: "Cerrar caja" }));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(cerrar.mock.calls[0]?.[0]).toMatchObject({
      conteo: null,
      conformeGeneral: true,
      otros: [],
    });
    expect(alCerrar).not.toHaveBeenCalled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("si la respuesta fue un error inesperado, queda en «Verificando…» con su referencia y reintenta", async () => {
    cerrar.mockResolvedValueOnce(INESPERADO);
    await render(formulario());
    tocar(page.getByRole("button", { name: "Cerrar caja" }));
    await expect.element(page.getByText("Verificando si se registró…").first()).toBeVisible();
    await expect.element(page.getByText("PD-ABCD-0123", { exact: false })).toBeVisible();
    await vi.waitFor(
      () => {
        expect(cerrar).toHaveBeenCalledTimes(2);
      },
      { timeout: 6000 },
    );
    expect(cerrar.mock.calls[1]?.[0]).toEqual(cerrar.mock.calls[0]?.[0]);
  });

  it("«Cancelar cierre» cancela por la sesión y avisa; sin permiso sale apagado", async () => {
    await render(formulario());
    tocar(page.getByRole("button", { name: "Cancelar cierre" }));
    await vi.waitFor(() => {
      expect(cancelarCierre).toHaveBeenCalledTimes(1);
    });
    expect(cancelarCierre.mock.calls[0]?.[0]).toEqual({ sesionId: "ses-1" });
    await vi.waitFor(() => {
      expect(alCancelarElCierre).toHaveBeenCalledTimes(1);
    });
    expect(cerrar).not.toHaveBeenCalled();
  });

  it("sin permiso, «Cerrar caja» y «Cancelar cierre» salen apagados y no envían", async () => {
    await render(formulario({ puedeCerrar: false, puedeCancelarCierre: false }));
    await expect.element(page.getByRole("button", { name: "Cerrar caja" })).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Cancelar cierre" })).toBeDisabled();
    tocar(page.getByRole("button", { name: "Cerrar caja" }));
    expect(cerrar).not.toHaveBeenCalled();
  });

  it("«Volver» avisa y no cancela el cierre", async () => {
    await render(formulario());
    await userEvent.click(page.getByRole("button", { name: "Volver" }));
    expect(alVolver).toHaveBeenCalledTimes(1);
    expect(cancelarCierre).not.toHaveBeenCalled();
  });
});
