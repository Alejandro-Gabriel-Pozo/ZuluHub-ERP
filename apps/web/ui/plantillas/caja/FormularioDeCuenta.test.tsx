import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { FormularioDeCuenta } from "./FormularioDeCuenta.cliente";
import {
  opcionesDeSucursal,
  opcionesDeTipoDeCuenta,
  type CuentaDeLaLista,
} from "./modelo-de-cuentas-de-cobro";

/** El formulario de una cuenta de cobro en Chromium (maqueta `medios.html`, 09/11/2026): alta y edición, la sucursal que hay que elegir, error del servidor, doble toque y sin permiso. */
const TEXTOS = {
  nombre: "Nombre",
  tipo: "Tipo",
  identificador: "Identificador (opcional)",
  sucursal: "Sucursal",
  guardar: "Guardar",
};
const SUCURSALES = opcionesDeSucursal([
  { id: "s1", nombre: "Sucursal Centro" },
  { id: "s2", nombre: "Sucursal Norte" },
]);
const ORIGINAL: CuentaDeLaLista = {
  id: "c1",
  tipo: "QR",
  nombre: "QR del local",
  identificadorExterno: "local.centro.cobros",
  sucursalId: "s2",
  activa: true,
  version: 3,
};
const ok: AccionDeFormulario = () => Promise.resolve({ error: null });

const formulario = (
  original: CuentaDeLaLista | null,
  accion: AccionDeFormulario = ok,
  puedeGuardar = true,
) => (
  <FormularioDeCuenta
    original={original}
    tipos={opcionesDeTipoDeCuenta()}
    sucursales={SUCURSALES}
    accion={accion}
    textos={TEXTOS}
    puedeGuardar={puedeGuardar}
  />
);

describe("FormularioDeCuenta", () => {
  it("el alta pide nombre, tipo, identificador opcional y sucursal, y es accesible", async () => {
    await render(formulario(null));
    await expect.element(page.getByLabelText("Nombre")).toHaveValue("");
    await expect.element(page.getByLabelText("Tipo")).toBeEnabled();
    await expect.element(page.getByLabelText("Identificador (opcional)")).toHaveValue("");
    await expect.element(page.getByLabelText("Sucursal")).toHaveValue("s1");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("manda los cuatro campos a la acción y el segundo toque no manda un segundo envío", async () => {
    let liberar: () => void = () => undefined;
    const accion = vi.fn(async (_previo: unknown, datos: FormData) => {
      void datos;
      await new Promise<void>((r) => {
        liberar = r;
      });
      return { error: null };
    });
    await render(formulario(null, accion));
    await userEvent.fill(page.getByLabelText("Nombre"), "Posnet 2");
    await userEvent.selectOptions(page.getByLabelText("Tipo"), "QR");
    await userEvent.fill(page.getByLabelText("Identificador (opcional)"), "T-0482");
    await userEvent.selectOptions(page.getByLabelText("Sucursal"), "s2");
    const guardar = page.getByRole("button", { name: "Guardar" });
    tocar(guardar);
    await expect.element(guardar).toHaveAttribute("aria-busy", "true");
    tocar(guardar);
    tocar(guardar);
    await vi.waitFor(() => expect(accion).toHaveBeenCalledTimes(1));
    liberar();
    await expect.element(guardar).not.toHaveAttribute("aria-busy", "true");
    const datos = accion.mock.calls[0]?.[1] as FormData;
    expect(
      ["nombre", "tipo", "identificadorExterno", "sucursalId"].map((c) => datos.get(c)),
    ).toEqual(["Posnet 2", "QR", "T-0482", "s2"]);
  });

  it("la edición trae los datos de la cuenta y el tipo apagado (no se cambia)", async () => {
    await render(formulario(ORIGINAL));
    await expect.element(page.getByLabelText("Nombre")).toHaveValue("QR del local");
    await expect.element(page.getByLabelText("Tipo")).toBeDisabled();
    await expect.element(page.getByLabelText("Tipo")).toHaveValue("QR");
    await expect
      .element(page.getByLabelText("Identificador (opcional)"))
      .toHaveValue("local.centro.cobros");
    await expect.element(page.getByLabelText("Sucursal")).toHaveValue("s2");
  });

  it("el error del servidor sale debajo con su texto", async () => {
    const rechazo: AccionDeFormulario = () =>
      Promise.resolve({
        error: {
          codigo: "CAJA_IDENTIFICADOR_INVALIDO",
          clave: "caja.error.identificador_invalido",
          presentacion: "AVISO",
        },
      });
    await render(formulario(null, rechazo));
    tocar(page.getByRole("button", { name: "Guardar" }));
    await expect.element(page.getByText("Identificador no válido")).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("sin permiso, «Guardar» sale apagado y no envía", async () => {
    const accion = vi.fn(ok);
    await render(formulario(null, accion, false));
    await expect.element(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
    tocar(page.getByRole("button", { name: "Guardar" }));
    expect(accion).not.toHaveBeenCalled();
  });
});
