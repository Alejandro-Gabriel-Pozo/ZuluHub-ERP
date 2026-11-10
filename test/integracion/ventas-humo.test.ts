import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  cuentaConLinea,
  montarVentas,
  nuevaClave,
  nuevoId,
  valorDe,
  type MundoDeVentas,
} from "./ventas-apoyo";

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("ventas: humo", () => {
  let m: MundoDeVentas;
  beforeAll(async () => {
    if (base !== null) m = await montarVentas(base);
  });
  afterAll(async () => {
    await m.cerrar();
  });
  it("abre, carga, cierra y anula", async () => {
    const e = await m.escenario();
    const { cuenta } = await cuentaConLinea(m, e, e.gerente, "2");
    const cierre = valorDe(
      await m.casos.cerrarCuenta(e.gerente, { cuentaId: cuenta, ejemplarId: nuevoId() }),
    );
    expect(cierre).toMatchObject({ numero: 1, estado: "EMITIDO", total: { monto: "2000.00" } });
    const ficha = valorDe(
      await m.consultas.fichaDeTicket(e.gerente, { ticketId: cierre.ticketId }),
    );
    expect(ficha.numeroDeCorreccion).toBe(0);
    const anulado = valorDe(
      await m.casos.anularTicket(e.gerente, {
        claveIdempotencia: nuevaClave(),
        ticketId: cierre.ticketId,
        ejemplarBaseId: cierre.ejemplarId,
        ejemplarNuevoId: nuevoId(),
        motivo: "Error del cajero",
      }),
    );
    expect(anulado.numeroDeCorreccion).toBe(1);
  });
});
