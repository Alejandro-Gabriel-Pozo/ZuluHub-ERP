import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { fechaCivilDesdeTexto, type FechaCivil } from "./fecha-civil";
import { fechaDeNegocio } from "./fecha-de-negocio";
import { fechaParaMostrar } from "./fecha-para-mostrar";

const civil = (texto: string): FechaCivil => {
  const r = fechaCivilDesdeTexto(texto);
  if (!r.ok) throw new Error(`fecha de prueba inválida: ${texto}`);
  return r.valor;
};

/** Las zonas del proceso con las que la salida NO puede cambiar (UTC, Buenos Aires, Los Ángeles y +14). */
const ZONAS = [
  "UTC",
  "America/Argentina/Buenos_Aires",
  "America/Los_Angeles",
  "Pacific/Kiritimati",
];
const zonaOriginal = process.env["TZ"];
afterEach(() => {
  if (zonaOriginal === undefined) delete process.env["TZ"];
  else process.env["TZ"] = zonaOriginal;
});

describe("fechaParaMostrar", () => {
  it.each([
    ["2026-11-15", "15/11/2026"],
    ["2026-03-05", "05/03/2026"],
    ["0001-01-01", "01/01/0001"],
    ["9999-12-31", "31/12/9999"],
    ["2028-02-29", "29/02/2028"],
    ["2026-12-31", "31/12/2026"],
  ])("%s se muestra %s", (entrada, esperada) => {
    expect(fechaParaMostrar(civil(entrada))).toBe(esperada);
  });

  it("falla cerrada: lo que no es una fecha civil válida lanza y no muestra nada (tipo forzado)", () => {
    for (const mala of [
      "2026-02-30",
      "2026-13-01",
      "2026-1-5",
      "15/11/2026",
      "2026-11-15 ",
      "2026-11-15T00:00:00Z",
      "",
      "no es una fecha",
    ]) {
      expect(() => fechaParaMostrar(mala as FechaCivil), JSON.stringify(mala)).toThrow(
        "fechaParaMostrar: no es una fecha civil válida",
      );
    }
    expect(() => fechaParaMostrar("2026-02-30" as FechaCivil)).toThrow(RangeError);
  });

  it("propiedad: toda fecha civil válida de 1900 a 2100 sale DD/MM/AAAA y volver a AAAA-MM-DD da la misma fecha", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1900, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 31 }),
        (anio, mes, dia) => {
          const texto = `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
          const r = fechaCivilDesdeTexto(texto);
          fc.pre(r.ok);
          if (!r.ok) return;
          const mostrada = fechaParaMostrar(r.valor);
          expect(mostrada).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
          const [d, m, a] = mostrada.split("/");
          expect(`${a}-${m}-${d}`).toBe(texto);
        },
      ),
    );
  });

  it.each(ZONAS)(
    "no corre un día con la zona del proceso en %s, incluso en los bordes del día y del año",
    (zona) => {
      process.env["TZ"] = zona;
      for (const [entrada, esperada] of [
        ["2026-11-15", "15/11/2026"],
        ["2026-01-01", "01/01/2026"],
        ["2025-12-31", "31/12/2025"],
        ["2028-02-29", "29/02/2028"],
        ["2026-11-16", "16/11/2026"],
      ] as const) {
        expect(fechaParaMostrar(civil(entrada))).toBe(esperada);
      }
    },
  );

  it.each(ZONAS)(
    "la fecha de negocio argentina en los bordes de medianoche se muestra bien con la zona del proceso en %s",
    (zona) => {
      process.env["TZ"] = zona;
      const BA = "America/Argentina/Buenos_Aires";
      const mostrada = (iso: string) => {
        const f = fechaDeNegocio(new Date(iso), BA, "00:00");
        if (!f.ok) throw new Error(f.error);
        return fechaParaMostrar(f.valor);
      };
      // UTC−3 sin horario de verano: la medianoche argentina es las 03:00 UTC.
      expect(mostrada("2026-11-16T02:59:59.999Z")).toBe("15/11/2026");
      expect(mostrada("2026-11-16T03:00:00.000Z")).toBe("16/11/2026");
      // Frontera del cambio de año y 29 de febrero de un año bisiesto.
      expect(mostrada("2027-01-01T02:59:59.999Z")).toBe("31/12/2026");
      expect(mostrada("2027-01-01T03:00:00.000Z")).toBe("01/01/2027");
      expect(mostrada("2028-03-01T02:59:59.999Z")).toBe("29/02/2028");
      expect(mostrada("2028-03-01T03:00:00.000Z")).toBe("01/03/2028");
    },
  );
});
