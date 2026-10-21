import { describe, expect, it } from "vitest";
import { avisoDeSesion } from "../../apps/plataforma/logica/aviso-de-sesion";

const MIN = 60_000;
const estado = (venceEnMs: number, motivo: "INACTIVIDAD" | "TOPE_DE_8_HORAS", vigente = true) => ({
  vigente,
  venceEnMs,
  motivo,
  segundoFactorRecienteHastaMs: 0,
});

describe("avisoDeSesion", () => {
  it("por inactividad avisa cuando quedan 5 minutos (a los 25 sin uso), ni un segundo antes", () => {
    expect(avisoDeSesion(estado(5 * MIN + 1, "INACTIVIDAD"))).toBe("ninguno");
    expect(avisoDeSesion(estado(5 * MIN, "INACTIVIDAD"))).toBe("por-vencer-renovable");
    expect(avisoDeSesion(estado(1, "INACTIVIDAD"))).toBe("por-vencer-renovable");
  });

  it("por el tope de 8 horas avisa 10 minutos antes y NO se puede renovar", () => {
    expect(avisoDeSesion(estado(10 * MIN + 1, "TOPE_DE_8_HORAS"))).toBe("ninguno");
    expect(avisoDeSesion(estado(10 * MIN, "TOPE_DE_8_HORAS"))).toBe("por-vencer-sin-renovar");
  });

  it("con 7 minutos por inactividad todavía no avisa; por el tope sí", () => {
    expect(avisoDeSesion(estado(7 * MIN, "INACTIVIDAD"))).toBe("ninguno");
    expect(avisoDeSesion(estado(7 * MIN, "TOPE_DE_8_HORAS"))).toBe("por-vencer-sin-renovar");
  });

  it("sin sesión vigente, o sin tiempo, está vencida", () => {
    expect(avisoDeSesion(estado(20 * MIN, "INACTIVIDAD", false))).toBe("vencida");
    expect(avisoDeSesion(estado(0, "INACTIVIDAD"))).toBe("vencida");
    expect(avisoDeSesion(estado(-5, "TOPE_DE_8_HORAS"))).toBe("vencida");
  });
});
