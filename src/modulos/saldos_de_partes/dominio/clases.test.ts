import { describe, expect, it } from "vitest";
import { CLASES_DE_ASIENTO, SENTIDOS, claseDe } from "./clases";

describe("las clases de asiento", () => {
  it("no repiten (sentido, clase) y todas tienen un sentido y un signo conocidos", () => {
    const claves = CLASES_DE_ASIENTO.map((c) => `${c.sentido}/${c.clase}`);
    expect(new Set(claves).size).toBe(claves.length);
    for (const c of CLASES_DE_ASIENTO) {
      expect(SENTIDOS).toContain(c.sentido);
      expect(["+", "-", "±"]).toContain(c.signo);
      expect(c.clase).toMatch(/^[A-Z][A-Z0-9_]{2,59}$/);
    }
  });

  it("el signo libre (±) exige detalle", () => {
    for (const c of CLASES_DE_ASIENTO.filter((x) => x.signo === "±"))
      expect(c.exigeDetalle).toBe(true);
  });

  it("claseDe distingue por sentido: una clase de otro sentido o inventada no existe", () => {
    expect(claseDe("A_PAGAR", "PAGO_A_PROVEEDOR")?.signo).toBe("-");
    expect(claseDe("A_COBRAR", "PAGO_A_PROVEEDOR")).toBeNull();
    expect(claseDe("A_PAGAR", "INVENTADA")).toBeNull();
    expect(claseDe("A_PAGAR", "constructor")).toBeNull();
  });
});
