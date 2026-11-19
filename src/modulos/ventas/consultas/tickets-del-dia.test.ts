import { describe, expect, it } from "vitest";
import type { EstadoDeCajasParaCobrar } from "../../caja/publico";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { jornadaDeLosTickets } from "./tickets-del-dia";

const fecha = (t: string): FechaCivil => {
  const r = fechaCivilDesdeTexto(t);
  if (!r.ok) throw new Error(t);
  return r.valor;
};
const HOY = fecha("2026-11-09");
const AYER = fecha("2026-11-08");

const caja = (
  estado: "SIN_SESION" | "ABIERTA" | "EN_CIERRE",
  fechaDeNegocio: FechaCivil | null,
  n = 1,
) => ({
  cajaId: `caja-${n}`,
  nombre: `Caja ${n}`,
  estado,
  sesionId: fechaDeNegocio === null ? null : `sesion-${n}`,
  fechaDeNegocio,
  jornadaVencida: false,
});
const estado = (cajas: ReturnType<typeof caja>[]): EstadoDeCajasParaCobrar => ({
  cajas,
  jornadaActual: { fechaDeNegocio: HOY, estado: "ABIERTA" },
});

describe("jornadaDeLosTickets: qué jornada muestra «Tickets del día»", () => {
  it("una caja abierta: la jornada de esa caja", () => {
    expect(jornadaDeLosTickets(estado([caja("ABIERTA", HOY)]))).toBe(HOY);
  });
  it("una caja abierta desde ayer (pasada la hora de corte): la de ayer, no la del reloj", () => {
    expect(jornadaDeLosTickets(estado([caja("ABIERTA", AYER)]))).toBe(AYER);
  });
  it("ninguna abierta (sin sesión o en cierre): la del reloj", () => {
    expect(jornadaDeLosTickets(estado([]))).toBe(HOY);
    expect(
      jornadaDeLosTickets(estado([caja("SIN_SESION", null), caja("EN_CIERRE", AYER, 2)])),
    ).toBe(HOY);
  });
  it("dos abiertas: la del reloj (nunca se elige una al azar)", () => {
    expect(jornadaDeLosTickets(estado([caja("ABIERTA", AYER), caja("ABIERTA", HOY, 2)]))).toBe(HOY);
  });
});
