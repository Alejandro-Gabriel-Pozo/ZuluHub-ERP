import { describe, expect, it } from "vitest";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { fechaDeNegocio } from "../../../primitivas/tiempo/fecha-de-negocio";
import { estaVencida } from "./vencida";

const fecha = (texto: string): FechaCivil => {
  const r = fechaCivilDesdeTexto(texto);
  if (!r.ok) throw new Error(texto);
  return r.valor;
};

describe("estaVencida", () => {
  it("el día del vencimiento NO está vencida; un día después, sí; sin vencimiento, nunca", () => {
    expect(estaVencida(fecha("2026-11-20"), fecha("2026-11-20"))).toBe(false);
    expect(estaVencida(fecha("2026-11-20"), fecha("2026-11-21"))).toBe(true);
    expect(estaVencida(fecha("2026-11-20"), fecha("2026-11-19"))).toBe(false);
    expect(estaVencida(null, fecha("2099-12-31"))).toBe(false);
  });

  it("compara el calendario, no el texto suelto: cambio de mes y de año", () => {
    expect(estaVencida(fecha("2026-12-31"), fecha("2027-01-01"))).toBe(true);
    expect(estaVencida(fecha("2027-01-01"), fecha("2026-12-31"))).toBe(false);
    expect(estaVencida(fecha("2026-02-28"), fecha("2026-03-01"))).toBe(true);
  });

  it("corte de día de Argentina: 23:30 del 20/11 y 00:30 del 21/11 caen en días distintos y deciden si vence el 20", () => {
    const hoy = (instante: string) => {
      const r = fechaDeNegocio(new Date(instante), "America/Argentina/Buenos_Aires", "00:00");
      if (!r.ok) throw new Error(instante);
      return r.valor;
    };
    const vence = fecha("2026-11-20");
    expect(estaVencida(vence, hoy("2026-11-21T02:30:00Z"))).toBe(false); // 23:30 del 20/11 en Buenos Aires
    expect(estaVencida(vence, hoy("2026-11-21T03:30:00Z"))).toBe(true); // 00:30 del 21/11
  });
});
