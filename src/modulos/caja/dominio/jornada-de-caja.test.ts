import { describe, expect, it } from "vitest";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { jornadaVencida } from "./jornada-de-caja";

const BA = { zonaHoraria: "America/Argentina/Buenos_Aires", horaDeCorte: "06:00" };
const fecha = (t: string) => t as FechaCivil;

describe("jornada vencida (e3 §3.4)", () => {
  it("la sesión abierta el 10/11 con corte 06:00 sigue en su jornada hasta las 06:00 del 11/11 (UTC-3)", () => {
    // 05:59:59.999 del 11/11 en Buenos Aires = 08:59:59.999Z: todavía es la jornada del 10/11.
    expect(jornadaVencida(new Date("2026-11-11T08:59:59.999Z"), BA, fecha("2026-11-10"))).toEqual({
      ok: true,
      valor: false,
    });
    expect(jornadaVencida(new Date("2026-11-11T09:00:00.000Z"), BA, fecha("2026-11-10"))).toEqual({
      ok: true,
      valor: true,
    });
  });
  it("el mismo día o una sesión de una jornada futura no está vencida", () => {
    expect(jornadaVencida(new Date("2026-11-10T15:00:00Z"), BA, fecha("2026-11-10"))).toEqual({
      ok: true,
      valor: false,
    });
    expect(jornadaVencida(new Date("2026-11-10T15:00:00Z"), BA, fecha("2026-11-11"))).toEqual({
      ok: true,
      valor: false,
    });
  });
  it("un sello inválido no se disfraza de «no vencida»: devuelve el error de la fórmula", () => {
    expect(
      jornadaVencida(
        new Date("2026-11-10T15:00:00Z"),
        { ...BA, horaDeCorte: "25:00" },
        fecha("2026-11-10"),
      ),
    ).toEqual({
      ok: false,
      error: "HORA_DE_CORTE_INVALIDA",
    });
    expect(
      jornadaVencida(
        new Date("2026-11-10T15:00:00Z"),
        { ...BA, zonaHoraria: "Nope/Zona" },
        fecha("2026-11-10"),
      ),
    ).toEqual({
      ok: false,
      error: "ZONA_HORARIA_INVALIDA",
    });
    expect(jornadaVencida(new Date(Number.NaN), BA, fecha("2026-11-10"))).toEqual({
      ok: false,
      error: "INSTANTE_INVALIDO",
    });
  });
});
