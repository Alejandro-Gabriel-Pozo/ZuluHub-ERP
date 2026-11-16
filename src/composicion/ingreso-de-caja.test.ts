import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { PIEZAS_DE_CAJA } from "./egreso-de-caja";
import { crearIngresoDeCaja } from "./ingreso-de-caja";

/** El puerto falla cerrado si la transacción no trae las piezas de caja: nunca se registra el reintegro o la devolución sin meter la plata en la caja. */
describe("ingreso de caja por origen (composición)", () => {
  const contexto = {
    empresaId: "e",
    personaId: "p",
    ahora: new Date(),
  } as unknown as ContextoOperativo;
  const entrada = {
    cajaId: "c",
    sucursalId: "s",
    origen: { tipo: "REINTEGRO_DE_PROVEEDOR", id: "x" },
    importe: { moneda: "ARS", monto: "10.00" },
    motivo: "Reintegro",
  } as const;

  it("registrar aborta antes de escribir si la transacción no trae la caja", async () => {
    await expect(crearIngresoDeCaja().registrar({}, contexto, entrada)).rejects.toThrow(
      /no trae la pieza de caja «movimientos»/,
    );
  });

  it("anular aborta igual", async () => {
    await expect(
      crearIngresoDeCaja().anular({}, contexto, { origen: entrada.origen, motivo: "Error" }),
    ).rejects.toThrow(/no trae la pieza de caja/);
  });

  it("nombra la pieza que falta, una por una", async () => {
    for (const falta of PIEZAS_DE_CAJA) {
      const tx = Object.fromEntries(PIEZAS_DE_CAJA.filter((p) => p !== falta).map((p) => [p, {}]));
      await expect(crearIngresoDeCaja().registrar(tx, contexto, entrada)).rejects.toThrow(
        new RegExp(`«${falta}»`),
      );
    }
  });
});
