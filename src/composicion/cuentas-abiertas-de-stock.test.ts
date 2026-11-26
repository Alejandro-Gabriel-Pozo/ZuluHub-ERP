import { describe, expect, it, vi } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import type { TxDeStock } from "../modulos/stock/publico";

const contar = vi.hoisted(() => vi.fn());
vi.mock("../modulos/ventas/publico", () => ({ cuentasAbiertasConElProducto: contar }));

import { cuentasAbiertasDeVentasParaStock } from "./cuentas-abiertas-de-stock";

const contexto = { empresaId: "empresa-1" } as unknown as ContextoOperativo;
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";

describe("cuentasAbiertasDeVentasParaStock", () => {
  it("pregunta a ventas por la empresa del contexto y el producto, con la misma transacción, y devuelve la cuenta", async () => {
    contar.mockResolvedValueOnce(3);
    const tx = { cuentas: {} } as unknown as TxDeStock;
    await expect(cuentasAbiertasDeVentasParaStock(tx, contexto, ID)).resolves.toBe(3);
    expect(contar).toHaveBeenCalledWith(tx, "empresa-1", ID);
  });

  it("sin los repositorios de ventas en la transacción falla cerrado: no dice «cero cuentas»", () => {
    contar.mockClear();
    const tx = {} as unknown as TxDeStock;
    expect(() => cuentasAbiertasDeVentasParaStock(tx, contexto, ID)).toThrow(
      /transacción compuesta con ventas/,
    );
    expect(contar).not.toHaveBeenCalled();
  });
});
