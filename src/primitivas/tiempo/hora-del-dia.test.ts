import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { HORA_DE_CORTE_POR_DEFECTO, horaDelDiaDesdeTexto, minutosDelDia } from "./hora-del-dia";

function hora(texto: string) {
  const r = horaDelDiaDesdeTexto(texto);
  if (!r.ok) throw new Error(`se esperaba una hora válida y dio ${r.error}`);
  return r.valor;
}

describe("hora del día", () => {
  it("la hora de corte por defecto es la medianoche", () => {
    expect(HORA_DE_CORTE_POR_DEFECTO).toBe("00:00");
    expect(minutosDelDia(HORA_DE_CORTE_POR_DEFECTO)).toBe(0);
  });

  it.each(["00:00", "00:01", "04:00", "09:59", "12:30", "19:00", "20:00", "23:00", "23:59"])(
    "acepta %s",
    (texto) => {
      expect(horaDelDiaDesdeTexto(texto)).toEqual({ ok: true, valor: texto });
    },
  );

  it.each([
    "24:00",
    "25:00",
    "29:00",
    "30:00",
    "99:00",
    "00:60",
    "00:99",
    "12:6",
    "4:00",
    "04:0",
    "0400",
    "04-00",
    "04:00:00",
    "04:00:30",
    "04:00 ",
    " 04:00",
    "04:00\n",
    "-1:00",
    "ab:cd",
    "",
    "medianoche",
    "٠٤:٠٠",
  ])("rechaza %j", (texto) => {
    expect(horaDelDiaDesdeTexto(texto)).toEqual({ ok: false, error: "HORA_DEL_DIA_INVALIDA" });
  });

  it("minutos desde la medianoche", () => {
    expect(minutosDelDia(hora("00:01"))).toBe(1);
    expect(minutosDelDia(hora("01:00"))).toBe(60);
    expect(minutosDelDia(hora("04:00"))).toBe(240);
    expect(minutosDelDia(hora("10:07"))).toBe(607);
    expect(minutosDelDia(hora("23:59"))).toBe(1439);
  });

  it("propiedad: de las 1440 horas posibles se aceptan exactamente las que existen, en orden", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1439 }), (minutos) => {
        const texto = `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
        expect(minutosDelDia(hora(texto))).toBe(minutos);
      }),
    );
  });

  it("propiedad: dos dígitos, dos puntos y dos dígitos que no son una hora real se rechazan", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 99 }), (h, m) => {
        const texto = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        expect(horaDelDiaDesdeTexto(texto).ok).toBe(h <= 23 && m <= 59);
      }),
    );
  });
});
