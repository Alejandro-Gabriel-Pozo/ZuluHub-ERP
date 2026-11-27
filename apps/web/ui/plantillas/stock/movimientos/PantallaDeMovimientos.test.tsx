import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { violacionesDeAccesibilidad } from "../../../pruebas/ayudas";
import { texto } from "../../../../../../src/capacidades/vocabulario/vocabulario";
import { armarLosMovimientos, type MovimientosDeLaComposicion } from "./modelo-de-movimientos";
import { PantallaDeMovimientos } from "./PantallaDeMovimientos";

/** «Movimientos» en Chromium (maqueta `stock.html`): el libro del depósito en solo lectura, con la clase, «Anulado», la cantidad con signo, el artículo, el motivo, quién y cuándo; accesible y sin botones. */
const TEXTOS = {
  depositos: "Depósitos",
  anulado: "Anulado",
  siguiente: "Siguiente",
  anular: "Anular",
};
const m = (cambios: Record<string, unknown> = {}) => ({
  movimientoId: "m1",
  numero: 1,
  clase: "ENTRADA",
  motivo: "COMPRA",
  hechoEn: "2026-11-25T15:30:00.000Z",
  quien: "ana@ejemplo.com",
  nombre: "Harina",
  unidadId: "KILOGRAMO",
  cantidad: "5.5000",
  anulado: false,
  anulable: false,
  ...cambios,
});
const DATO: MovimientosDeLaComposicion = {
  depositos: [{ id: "d1", nombre: "Salón" }],
  depositoId: "d1",
  movimientos: [
    m(),
    m({ movimientoId: "m2", clase: "SALIDA", motivo: "MERMA", cantidad: "-1.2500", anulado: true }),
    m({
      movimientoId: "m3",
      clase: "ANULACION",
      motivo: "ANULACION",
      cantidad: "-5.5000",
      quien: null,
    }),
  ],
  siguiente: null,
};
const pantalla = (dato = DATO, puedeAnular = true) => (
  <PantallaDeMovimientos
    vista={armarLosMovimientos(dato, (clave) => texto({}, clave))}
    textos={TEXTOS}
    puedeAnular={puedeAnular}
    hrefDeAnular={(id) => `/stock/movimientos/${id}/anular`}
  />
);
const ANULABLE: MovimientosDeLaComposicion = { ...DATO, movimientos: [m({ anulable: true })] };

describe("PantallaDeMovimientos", () => {
  it("una tarjeta por renglón con clase, cantidad con signo, artículo, motivo, quién y cuándo; «Anulado» solo en el anulado; sin botones; accesible", async () => {
    await render(pantalla());
    await expect.element(page.getByText("Compra", { exact: false }).first()).toBeVisible();
    await expect.element(page.getByText("+5,5", { exact: false })).toBeVisible();
    await expect.element(page.getByText("-1,25", { exact: false })).toBeVisible();
    await expect.element(page.getByText("ana@ejemplo.com", { exact: false }).first()).toBeVisible();
    expect(page.getByText("Anulado").elements()).toHaveLength(1);
    expect(page.getByRole("link", { name: "Anular" }).elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("«Anular» solo en lo anulable: lleva al detalle con el permiso y sale apagado sin él", async () => {
    await render(pantalla(ANULABLE));
    await expect
      .element(page.getByRole("link", { name: "Anular" }))
      .toHaveAttribute("href", "/stock/movimientos/m1/anular");
  });

  it("sin permiso para anular, el botón sale apagado", async () => {
    await render(pantalla(ANULABLE, false));
    await expect.element(page.getByRole("button", { name: "Anular" })).toBeDisabled();
    expect(page.getByRole("link", { name: "Anular" }).elements()).toHaveLength(0);
  });

  it("el motivo de sistema sin texto aprobado y la persona sin correo no dejan separadores sueltos", async () => {
    await render(pantalla());
    const detalles = page
      .getByText("Harina", { exact: false })
      .elements()
      .map((e) => e.textContent);
    expect(detalles.every((t) => !/·\s*·|·\s*$|^\s*·/.test(t ?? ""))).toBe(true);
  });
});
