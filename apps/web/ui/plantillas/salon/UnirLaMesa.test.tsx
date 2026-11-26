import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { errorDeCodigo } from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { textosDeLaMesa } from "./modelo-de-la-mesa";
import { UnirLaMesa, type PropsDeUnirLaMesa } from "./UnirLaMesa.cliente";

/**
 * «Unir con otra mesa» en Chromium (SAL-E1): se elige la mesa, «Cuánto queda» es la suma EXACTA de las dos cuentas, el aviso dice que no se deshace, un doble toque en «Confirmar unión» es UN pedido y tras un corte repetir
 * reutiliza el mismo id y la misma clave (otra mesa es otro intento); el rechazo sale bajo «No se pueden unir»; y axe.
 */
const t = textosDeLaMesa();
const candidatas = [
  { mesaId: "m5", cuentaId: "c5", titulo: "Mesa 5", total: { moneda: "ARS", monto: "1000.01" } },
  { mesaId: "m6", cuentaId: "c6", titulo: "Mesa 6", total: { moneda: "ARS", monto: "50.00" } },
];

const montar = (
  extra: Partial<PropsDeUnirLaMesa> = {},
  unir = vi.fn<(pedido: unknown, alTerminar: () => void) => void>((_p, alTerminar) => {
    alTerminar();
  }),
) => {
  const alUnida = vi.fn();
  return {
    unir,
    alUnida,
    vista: (
      <UnirLaMesa
        cuentaId="c2"
        total={{ moneda: "ARS", monto: "2345.66" }}
        candidatas={candidatas}
        textos={{ ...t, cancelar: "Cancelar", cerrar: "Cerrar" }}
        ocupado={false}
        error={null}
        unir={unir}
        alUnida={alUnida}
        {...extra}
      />
    ),
  };
};

describe("UnirLaMesa", () => {
  it("elegir una mesa muestra «Cuánto queda» (suma exacta con centavos) y que no se deshace; sin elegir no hay confirmación; axe", async () => {
    const { vista } = montar();
    await render(vista);
    await userEvent.click(page.getByRole("button", { name: "Unir con otra mesa" }));
    expect(page.getByRole("button", { name: "Confirmar unión" }).elements()).toHaveLength(0);
    await userEvent.click(page.getByRole("button", { name: "Mesa 5" }));
    await expect.element(page.getByText("Cuánto queda")).toBeVisible();
    await expect.element(page.getByText("$ 3.345,67")).toBeVisible();
    await expect.element(page.getByText(/Esto no se deshace/)).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("IDEMPOTENCIA: un doble toque en «Confirmar unión» manda el mismo origen, destino, id de unión y clave (la pantalla corre un solo pedido a la vez); después va a la mesa destino", async () => {
    // Como la pantalla: mientras hay un pedido en vuelo el segundo toque no corre; el ruido se mide en lo que llega.
    let enVuelo = false;
    const m = montar(
      {},
      vi.fn((_p: unknown, alTerminar: () => void) => {
        if (enVuelo) return;
        enVuelo = true;
        alTerminar();
      }),
    );
    await render(m.vista);
    await userEvent.click(page.getByRole("button", { name: "Unir con otra mesa" }));
    await userEvent.click(page.getByRole("button", { name: "Mesa 5" }));
    const confirmar = page.getByRole("button", { name: "Confirmar unión" });
    tocar(confirmar);
    tocar(confirmar);
    await vi.waitFor(() => {
      expect(m.alUnida).toHaveBeenCalledTimes(1);
    });
    const [pedido] = m.unir.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(pedido).toMatchObject({ cuentaDestinoId: "c5", cuentaOrigenId: "c2" });
    expect(String(pedido["unionId"])).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(pedido["clave"])).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.alUnida).toHaveBeenCalledWith(expect.objectContaining({ mesaId: "m5" }));
  });

  it("tras un corte, repetir con la misma mesa manda el MISMO id y la MISMA clave; con otra mesa, otros", async () => {
    const unir = vi.fn<(pedido: unknown, alTerminar: () => void) => void>();
    const m = montar({}, unir);
    await render(m.vista);
    await userEvent.click(page.getByRole("button", { name: "Unir con otra mesa" }));
    await userEvent.click(page.getByRole("button", { name: "Mesa 5" }));
    await userEvent.click(page.getByRole("button", { name: "Confirmar unión" }));
    await userEvent.click(page.getByRole("button", { name: "Confirmar unión" }));
    await userEvent.click(page.getByRole("button", { name: "Mesa 6" }));
    await userEvent.click(page.getByRole("button", { name: "Confirmar unión" }));
    const llamadas = unir.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(llamadas).toHaveLength(3);
    expect(llamadas[1]?.["unionId"]).toBe(llamadas[0]?.["unionId"]);
    expect(llamadas[1]?.["clave"]).toBe(llamadas[0]?.["clave"]);
    expect(llamadas[2]?.["unionId"]).not.toBe(llamadas[0]?.["unionId"]);
    expect(llamadas[2]?.["cuentaDestinoId"]).toBe("c6");
  });

  it("el rechazo del servidor sale dentro de la hoja bajo «No se pueden unir» y «Cancelar» no manda nada", async () => {
    const unir = vi.fn<(pedido: unknown, alTerminar: () => void) => void>();
    const m = montar({ error: errorDeCodigo("SALON_UNIR_MESA_LIBRE") }, unir);
    await render(m.vista);
    await userEvent.click(page.getByRole("button", { name: "Unir con otra mesa" }));
    await userEvent.click(page.getByRole("button", { name: "Mesa 5" }));
    await expect.element(page.getByText("No se pueden unir")).toBeVisible();
    await expect.element(page.getByText("Mesa libre", { exact: true })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Cancelar" }));
    expect(unir).not.toHaveBeenCalled();
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
  });
});
