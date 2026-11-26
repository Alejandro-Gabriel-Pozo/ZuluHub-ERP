import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { instanteIsoEnArgentina } from "./instante-en-argentina";
import { instanteDeLaHora } from "./instante-de-la-hora";

/** De «HH:MM» al instante más reciente que ya pasó en la zona. Argentina es UTC-3 (12:00 en Argentina = 15:00Z). El oráculo de las propiedades es la hora de pared por la regla fija -03:00, aparte de la función. */
const AR = "America/Argentina/Buenos_Aires";
const iso = (r: ReturnType<typeof instanteDeLaHora>) => (r.ok ? r.valor.toISOString() : r.error);
const instante = (texto: string) => new Date(texto);

describe("instanteDeLaHora", () => {
  const AHORA = instante("2026-11-26T15:00:20Z"); // 12:00:20 en Argentina

  it("una hora que ya pasó hoy es la de hoy; los segundos de «ahora» cuentan (las 12:00:20 ya pasaron las 12:00)", () => {
    expect(iso(instanteDeLaHora("11:30", AR, AHORA))).toBe("2026-11-26T14:30:00.000Z");
    expect(iso(instanteDeLaHora("12:00", AR, AHORA))).toBe("2026-11-26T15:00:00.000Z");
    expect(iso(instanteDeLaHora("00:00", AR, AHORA))).toBe("2026-11-26T03:00:00.000Z");
  });

  it("una hora que todavía no llegó hoy es la de ayer", () => {
    expect(iso(instanteDeLaHora("12:01", AR, AHORA))).toBe("2026-11-25T15:01:00.000Z");
    expect(iso(instanteDeLaHora("23:59", AR, AHORA))).toBe("2026-11-26T02:59:00.000Z");
  });

  it("cruce de medianoche: cargado a las 00:10 de Argentina, las 23:45 son de ayer y las 00:05 de hoy", () => {
    const ahora = instante("2026-11-26T03:10:00Z"); // 00:10 del 26 en Argentina
    expect(iso(instanteDeLaHora("23:45", AR, ahora))).toBe("2026-11-26T02:45:00.000Z"); // 23:45 del 25
    expect(iso(instanteDeLaHora("00:05", AR, ahora))).toBe("2026-11-26T03:05:00.000Z"); // 00:05 del 26
    expect(iso(instanteDeLaHora("00:10", AR, ahora))).toBe("2026-11-26T03:10:00.000Z");
    expect(iso(instanteDeLaHora("00:11", AR, ahora))).toBe("2026-11-25T03:11:00.000Z");
  });

  it("cruce de mes y de año: el 1 de enero a las 00:30 de Argentina, las 23:00 son del 31 de diciembre", () => {
    const ahora = instante("2027-01-01T03:30:00Z");
    expect(iso(instanteDeLaHora("23:00", AR, ahora))).toBe("2027-01-01T02:00:00.000Z");
  });

  it("la misma cuenta en otra zona (UTC) y en una con desfase positivo", () => {
    expect(iso(instanteDeLaHora("14:30", "UTC", instante("2026-11-26T15:00:00Z")))).toBe(
      "2026-11-26T14:30:00.000Z",
    );
    expect(iso(instanteDeLaHora("14:30", "Asia/Tokyo", instante("2026-11-26T03:00:00Z")))).toBe(
      "2026-11-25T05:30:00.000Z",
    ); // en Tokio son las 12:00 del 26: las 14:30 son del 25
  });

  it("una zona con horario de verano usa el desfase del instante resultante, no el de «ahora»", () => {
    // Nueva York: el 8/11/2026 termina el verano (EDT -04:00 → EST -05:00). El 9/11 a las 10:00Z son las 05:00 EST.
    const ahora = instante("2026-11-09T10:00:00Z");
    expect(iso(instanteDeLaHora("23:30", "America/New_York", ahora))).toBe(
      "2026-11-09T04:30:00.000Z",
    ); // 23:30 del 8, ya en EST (-05) = 04:30Z del 9
    expect(iso(instanteDeLaHora("04:00", "America/New_York", ahora))).toBe(
      "2026-11-09T09:00:00.000Z",
    ); // 04:00 del 9 EST = 09:00Z
  });

  it("sin la forma HH:MM, con una zona que no existe o con un instante inválido no hay resultado", () => {
    for (const hora of ["", "7:30", "24:00", "12:60", "12:00:00", "12.30", "ab:cd", " 12:30"]) {
      expect(iso(instanteDeLaHora(hora, AR, AHORA)), hora).toBe("HORA_DEL_DIA_INVALIDA");
    }
    for (const zona of ["", "Mundo/Nada", "-03:00", "art"]) {
      expect(iso(instanteDeLaHora("10:00", zona, AHORA)), zona).toBe("ZONA_HORARIA_INVALIDA");
    }
    expect(iso(instanteDeLaHora("10:00", AR, new Date(Number.NaN)))).toBe("INSTANTE_INVALIDO");
    expect(iso(instanteDeLaHora("10:00", AR, new Date("0001-01-01T00:00:00Z")))).toBe(
      "INSTANTE_INVALIDO",
    );
  });

  it("propiedad (Argentina): el resultado es ≤ ahora, a menos de 24 h, su hora de pared es la pedida y es la más reciente", () => {
    fc.assert(
      fc.property(
        fc.integer({
          min: Date.parse("2020-01-01T00:00:00Z"),
          max: Date.parse("2035-12-31T23:59:59Z"),
        }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (ms, h, m) => {
          const hora = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
          const r = instanteDeLaHora(hora, AR, new Date(ms));
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          const t = r.valor.getTime();
          expect(t).toBeLessThanOrEqual(ms);
          expect(ms - t).toBeLessThan(24 * 60 * 60 * 1000);
          // Su hora de pared en Argentina es la pedida (oráculo aparte: restar tres horas, sin Intl).
          expect(instanteIsoEnArgentina(r.valor).slice(11, 16)).toBe(hora);
          // Es la más reciente: un día más tarde ya sería futuro.
          expect(t + 24 * 60 * 60 * 1000).toBeGreaterThan(ms);
        },
      ),
    );
  });
});
