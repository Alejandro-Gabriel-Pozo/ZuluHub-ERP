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

  it("las clases de A_COBRAR de v1 son tres, con su signo (+ cargo, − cobranza, ± ajuste con detalle); las demás nacen cerradas", () => {
    expect(CLASES_DE_ASIENTO.filter((c) => c.sentido === "A_COBRAR")).toEqual([
      {
        sentido: "A_COBRAR",
        clase: "CARGO_DE_VENTA_A_CUENTA",
        signo: "+",
        exigeDetalle: false,
        admiteVencimiento: true,
      },
      {
        sentido: "A_COBRAR",
        clase: "COBRANZA",
        signo: "-",
        exigeDetalle: false,
        admiteVencimiento: false,
      },
      {
        sentido: "A_COBRAR",
        clase: "AJUSTE_DE_SALDO",
        signo: "±",
        exigeDetalle: true,
        admiteVencimiento: false,
      },
    ]);
    expect(claseDe("A_COBRAR", "CREDITO_A_FAVOR")).toBeNull();
    expect(claseDe("A_COBRAR", "NOTA_DE_CREDITO_DE_VENTA")).toBeNull();
  });

  it("claseDe distingue por sentido: una clase de otro sentido o inventada no existe", () => {
    expect(claseDe("A_PAGAR", "PAGO_A_PROVEEDOR")?.signo).toBe("-");
    expect(claseDe("A_COBRAR", "PAGO_A_PROVEEDOR")).toBeNull();
    expect(claseDe("A_PAGAR", "INVENTADA")).toBeNull();
    expect(claseDe("A_PAGAR", "constructor")).toBeNull();
  });
});
