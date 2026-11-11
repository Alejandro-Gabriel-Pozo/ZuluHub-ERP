import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import type { TxDeCompras } from "../modulos/compras/publico";
import { crearEgresoDeCaja } from "./egreso-de-caja";

/** El puerto falla cerrado si la transacción de compras no trae las piezas de caja: nunca se paga sin descontar. */
describe("egreso de caja para compras (composición)", () => {
  const contexto = {
    empresaId: "e",
    personaId: "p",
    ahora: new Date(),
  } as unknown as ContextoOperativo;
  const sinCaja = {} as unknown as TxDeCompras;

  it("registrar aborta antes de escribir si la transacción no trae la caja", async () => {
    await expect(
      crearEgresoDeCaja().registrar(sinCaja, contexto, {
        cajaId: "c",
        sucursalId: "s",
        pagoId: "x",
        importe: "10.00",
        motivo: "Pago",
      }),
    ).rejects.toThrow(/no trae la pieza de caja «movimientos»/);
  });

  it("anular aborta igual", async () => {
    await expect(
      crearEgresoDeCaja().anular(sinCaja, contexto, { pagoId: "x", motivo: "Error" }),
    ).rejects.toThrow(/no trae la pieza de caja/);
  });

  it("nombra la pieza que falta, una por una", async () => {
    const piezas = ["movimientos", "sesiones", "cajas", "mediosDePago", "cobros"];
    for (const falta of piezas) {
      const tx = Object.fromEntries(piezas.filter((p) => p !== falta).map((p) => [p, {}]));
      await expect(
        crearEgresoDeCaja().anular(tx as unknown as TxDeCompras, contexto, {
          pagoId: "x",
          motivo: "Error",
        }),
      ).rejects.toThrow(new RegExp(`«${falta}»`));
    }
  });
});
