import { describe, expect, it } from "vitest";
import { minutosEntre } from "./minutos";

const d = (t: string) => new Date(t);

describe("minutos entre instantes", () => {
  it("cuenta minutos completos y descarta los segundos", () => {
    expect(minutosEntre(d("2026-05-10T10:00:00Z"), d("2026-05-10T11:30:00Z"))).toEqual({
      ok: true,
      valor: 90,
    });
    expect(minutosEntre(d("2026-05-10T10:00:00Z"), d("2026-05-10T10:00:59Z"))).toEqual({
      ok: true,
      valor: 0,
    });
    expect(minutosEntre(d("2026-05-10T10:00:00Z"), d("2026-05-10T10:01:00Z"))).toEqual({
      ok: true,
      valor: 1,
    });
    expect(minutosEntre(d("2026-05-10T10:00:00Z"), d("2026-05-10T10:00:00Z"))).toEqual({
      ok: true,
      valor: 0,
    });
  });

  it("no depende de la zona: el mismo instante con otro desfase da lo mismo", () => {
    expect(minutosEntre(d("2026-05-10T10:00:00-03:00"), d("2026-05-10T14:00:00+01:00"))).toEqual({
      ok: true,
      valor: 0,
    });
    expect(minutosEntre(d("2026-05-10T00:00:00-03:00"), d("2026-05-10T04:00:00Z"))).toEqual({
      ok: true,
      valor: 60,
    });
  });

  it("instante inválido o rango invertido es error", () => {
    expect(minutosEntre(d("nada"), d("2026-05-10T10:00:00Z"))).toEqual({
      ok: false,
      error: "INSTANTE_INVALIDO",
    });
    expect(minutosEntre(d("2026-05-10T10:00:00Z"), d("nada"))).toEqual({
      ok: false,
      error: "INSTANTE_INVALIDO",
    });
    expect(minutosEntre(d("2026-05-10T11:00:00Z"), d("2026-05-10T10:00:00Z"))).toEqual({
      ok: false,
      error: "RANGO_DE_INSTANTES_INVALIDO",
    });
  });
});
