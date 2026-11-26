import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { DividirLaMesa, type PropsDeDividirLaMesa } from "./DividirLaMesa.cliente";
import { lineasParaDividir } from "./modelo-de-dividir";
import { textosDeDividir } from "./textos-de-dividir";

/**
 * «Dividir la cuenta» por ítems en Chromium (SAL-E2): sin repartir se ve «Falta asignar» y no se confirma; con 3 gaseosas «Por unidades» y el plato «Compartido» entre 3, las cuentas suman lo que dice la prueba del dueño
 * ($ 2.000,34 / $ 2.000,33 / $ 2.000,33); una cuenta vacía no deja confirmar; un doble toque en «Confirmar división» es UN pedido con el MISMO id de división (también al repetir tras un corte); y axe.
 */
const ficha = (
  id: string,
  descripcion: string,
  cantidad: string,
  precio: string,
  importe: string,
) => ({
  lineaId: id,
  descripcion,
  varianteNombre: null,
  cantidad,
  precioUnitario: precio,
  pasoDeCantidad: "1.0000",
  importe,
});
const lineas = lineasParaDividir([
  ficha("g", "Gaseosa", "3.0000", "1000.00", "3000.00"),
  ficha("p", "Plato", "1.0000", "3001.00", "3001.00"),
]);

const montar = (
  dividir = vi.fn<(pedido: unknown, alTerminar: () => void) => void>((_p, alTerminar) => {
    alTerminar();
  }),
  extra: Partial<PropsDeDividirLaMesa> = {},
) => {
  const alDividida = vi.fn();
  return {
    dividir,
    alDividida,
    vista: (
      <DividirLaMesa
        cuentaId="c1"
        lineas={lineas}
        textos={textosDeDividir()}
        ocupado={false}
        error={null}
        dividir={dividir}
        alDividida={alDividida}
        {...extra}
      />
    ),
  };
};
const abrir = async () => {
  await userEvent.click(page.getByRole("button", { name: "Dividir la cuenta" }));
};
/** Una línea de la hoja (su fila), para tocar sus botones sin confundirla con la otra. */
const linea = (nombre: string) => page.getByRole("listitem").filter({ hasText: nombre });
const cuenta = (n: number) => `Cuenta ${String(n)}`;
const entero = async (nombre: string, n: number) => {
  await userEvent.click(linea(nombre).getByRole("button", { name: "Entero" }));
  await userEvent.click(linea(nombre).getByRole("button", { name: cuenta(n) }));
};
/** Reparte el caso de la prueba del dueño: gaseosas una a cada cuenta (3 cuentas) y el plato compartido entre las tres. */
const repartirComoElDueno = async () => {
  await userEvent.click(page.getByRole("button", { name: "Agregar cuenta" }));
  await userEvent.click(linea("Gaseosa").getByRole("button", { name: "Por unidades" }));
  // Una fila por unidad: la fila N elige la «Cuenta N» (los botones se repiten por fila).
  for (let fila = 0; fila < 3; fila++) {
    await userEvent.click(
      linea("Gaseosa")
        .getByRole("button", { name: cuenta(fila + 1) })
        .nth(fila),
    );
  }
  await userEvent.click(linea("Plato").getByRole("button", { name: "Compartido" }));
  for (let n = 1; n <= 3; n++) {
    await userEvent.click(linea("Plato").getByRole("button", { name: cuenta(n) }));
  }
};

describe("DividirLaMesa", () => {
  it("sin repartir: cada línea dice «Falta asignar» y «Confirmar división» no se puede tocar; axe", async () => {
    const m = montar();
    await render(m.vista);
    await abrir();
    expect(page.getByText("Falta asignar").elements()).toHaveLength(2);
    await expect.element(page.getByRole("button", { name: "Confirmar división" })).toBeDisabled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("DINERO: 3 gaseosas por unidades y el plato compartido entre 3 suman $ 2.000,34 / $ 2.000,33 / $ 2.000,33 y se manda el reparto exacto", async () => {
    const m = montar();
    await render(m.vista);
    await abrir();
    await repartirComoElDueno();
    await expect.element(page.getByText("Cuenta 1 · $ 2.000,34")).toBeVisible();
    await expect.element(page.getByText("Cuenta 2 · $ 2.000,33")).toBeVisible();
    await expect.element(page.getByText("Cuenta 3 · $ 2.000,33")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Confirmar división" }));
    await vi.waitFor(() => {
      expect(m.alDividida).toHaveBeenCalledTimes(1);
    });
    const [pedido] = m.dividir.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(pedido).toMatchObject({ cuentaId: "c1", partes: 3 });
    expect(pedido["asignaciones"]).toEqual([
      { lineaId: "g", forma: "POR_UNIDADES", cantidades: ["1.0000", "1.0000", "1.0000"] },
      { lineaId: "p", forma: "COMPARTIDO", partes: [1, 2, 3] },
    ]);
  });

  it("una cuenta sin nada dice «Cuenta vacía» y no deja confirmar", async () => {
    const m = montar();
    await render(m.vista);
    await abrir();
    await entero("Gaseosa", 1);
    await entero("Plato", 1);
    await expect.element(page.getByText(/Cuenta 2 · Cuenta vacía/)).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Confirmar división" })).toBeDisabled();
  });

  it("IDEMPOTENCIA: un doble toque manda un solo pedido y repetir tras un corte reutiliza el MISMO id de división; otro reparto, otro id", async () => {
    let enVuelo = false;
    const dividir = vi.fn((_p: unknown, alTerminar: () => void) => {
      if (enVuelo) return;
      enVuelo = true;
      // Como el servidor: la respuesta llega después, no en el mismo instante del toque.
      setTimeout(alTerminar, 50);
    });
    const m = montar(dividir);
    await render(m.vista);
    await abrir();
    await entero("Gaseosa", 1);
    await entero("Plato", 2);
    const confirmar = page.getByRole("button", { name: "Confirmar división" });
    tocar(confirmar);
    tocar(confirmar);
    await vi.waitFor(() => {
      expect(m.alDividida).toHaveBeenCalledTimes(1);
    });
    expect(dividir).toHaveBeenCalledTimes(2);
    const ids = dividir.mock.calls.map((c) => (c[0] as Record<string, unknown>)["divisionId"]);
    expect(ids[0]).toBe(ids[1]);
    expect(String(ids[0])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("tras un corte (no terminó), confirmar lo mismo manda el MISMO id y otro reparto manda otro", async () => {
    const dividir = vi.fn<(pedido: unknown, alTerminar: () => void) => void>();
    const m = montar(dividir);
    await render(m.vista);
    await abrir();
    await entero("Gaseosa", 1);
    await entero("Plato", 2);
    await userEvent.click(page.getByRole("button", { name: "Confirmar división" }));
    await userEvent.click(page.getByRole("button", { name: "Confirmar división" }));
    await entero("Gaseosa", 2);
    await entero("Plato", 1);
    await userEvent.click(page.getByRole("button", { name: "Confirmar división" }));
    const ids = dividir.mock.calls.map((c) => (c[0] as Record<string, unknown>)["divisionId"]);
    expect(ids).toHaveLength(3);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });
});
