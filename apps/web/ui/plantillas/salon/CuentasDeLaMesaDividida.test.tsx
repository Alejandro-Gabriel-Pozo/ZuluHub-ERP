import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { CuentasDeLaMesaDividida } from "./CuentasDeLaMesaDividida.cliente";
import type { CuentaHijaArmada } from "./modelo-de-dividir";
import { textosDeDividir } from "./textos-de-dividir";

/** Las cuentas de una mesa dividida en Chromium (SAL-E2, S9): estado de cada una, «Cobrar» solo en la lista para cobrar y a quien puede, y axe. */
const ARS = (monto: string) => ({ moneda: "ARS", monto });
const hija = (n: number, extra: Partial<CuentaHijaArmada> = {}): CuentaHijaArmada => ({
  cuentaId: `c${String(n)}`,
  titulo: `Cuenta ${String(n)}`,
  importe: "$ 100,00",
  totalACobrar: ARS("100.00"),
  cobrada: false,
  cobrable: true,
  ...extra,
});
const cuentas = [
  hija(1, { cobrada: true, cobrable: false }),
  hija(2),
  hija(3, { cobrable: false }),
];

const montar = (puedeCobrar = true, ocupado = false) => {
  const alCobrar = vi.fn();
  return {
    alCobrar,
    vista: (
      <CuentasDeLaMesaDividida
        cuentas={cuentas}
        textos={textosDeDividir()}
        puedeCobrar={puedeCobrar}
        ocupado={ocupado}
        alCobrar={alCobrar}
      />
    ),
  };
};

describe("CuentasDeLaMesaDividida", () => {
  it("cada cuenta dice «Cobrada» o «Pendiente» y «Cobrar» está solo en la lista para cobrar; axe", async () => {
    const m = montar();
    await render(m.vista);
    await expect.element(page.getByText("Cuenta 1 · $ 100,00 · Cobrada")).toBeVisible();
    await expect.element(page.getByText("Cuenta 2 · $ 100,00 · Pendiente")).toBeVisible();
    await expect.element(page.getByText("Cuenta 3 · $ 100,00 · Pendiente")).toBeVisible();
    expect(page.getByRole("button", { name: "Cobrar" }).elements()).toHaveLength(1);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Cobrar» lleva a cobrar ESA cuenta", async () => {
    const m = montar();
    await render(m.vista);
    await userEvent.click(page.getByRole("button", { name: "Cobrar" }));
    expect(m.alCobrar).toHaveBeenCalledTimes(1);
    expect(m.alCobrar).toHaveBeenCalledWith(expect.objectContaining({ cuentaId: "c2" }));
  });

  it("sin permiso no hay «Cobrar»; con una acción en vuelo queda apagado", async () => {
    const sin = montar(false);
    await render(sin.vista);
    expect(page.getByRole("button", { name: "Cobrar" }).elements()).toHaveLength(0);
  });

  it("con una acción en vuelo «Cobrar» no se puede tocar", async () => {
    const m = montar(true, true);
    await render(m.vista);
    await expect.element(page.getByRole("button", { name: "Cobrar" })).toBeDisabled();
  });
});
