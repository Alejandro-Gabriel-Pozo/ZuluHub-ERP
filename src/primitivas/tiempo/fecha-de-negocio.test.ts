import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { fechaCivilDesdeTexto } from "./fecha-civil";
import { INSTANTE_MAXIMO, INSTANTE_MINIMO, fechaDeNegocio } from "./fecha-de-negocio";

const BUENOS_AIRES = "America/Argentina/Buenos_Aires";
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/** La fecha de negocio o, si no hay, la falla de la prueba con el error. */
function jornada(instanteISO: string, zona: string, corte: string): string {
  const r = fechaDeNegocio(new Date(instanteISO), zona, corte);
  if (!r.ok) throw new Error(`se esperaba una fecha de negocio y dio ${r.error}`);
  return r.valor;
}

/**
 * Oráculo independiente para zonas con desfase fijo: instante + desfase − corte, leído como fecha
 * UTC. No usa `Intl`, así que no comparte ningún camino con la implementación.
 */
function oraculo(ms: number, desfaseEnMinutos: number, corteEnMinutos: number): string {
  return new Date(ms + (desfaseEnMinutos - corteEnMinutos) * MINUTO).toISOString().slice(0, 10);
}

/** Zonas sin horario de verano en 2020-2035 (desfase en minutos respecto de UTC). */
const ZONAS_FIJAS: readonly (readonly [string, number])[] = [
  [BUENOS_AIRES, -180],
  ["UTC", 0],
  ["Etc/GMT+3", -180],
  ["America/Sao_Paulo", -180],
  ["Asia/Kolkata", 330],
  ["Asia/Kathmandu", 345],
  ["Pacific/Pago_Pago", -660],
  ["Pacific/Kiritimati", 840],
];

const instanteModerno = fc.integer({
  min: Date.parse("2020-01-01T00:00:00Z"),
  max: Date.parse("2035-12-31T23:59:59Z"),
});
const zonaFija = fc.constantFrom(...ZONAS_FIJAS);
const corteEnMinutos = fc.integer({ min: 0, max: 1439 });
const aTexto = (minutos: number) =>
  `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;

describe("fecha de negocio: el ejemplo del encargo (Buenos Aires, UTC−3)", () => {
  // Sábado 11/10/2026 01:30 hora local = 04:30 UTC.
  const cobroDeLas0130 = "2026-10-11T04:30:00Z";

  it("con corte 00:00 el cobro de la 01:30 es del sábado 11/10", () => {
    expect(jornada(cobroDeLas0130, BUENOS_AIRES, "00:00")).toBe("2026-10-11");
  });

  it("con corte 04:00 ese mismo instante es de la jornada del viernes 10/10", () => {
    expect(jornada(cobroDeLas0130, BUENOS_AIRES, "04:00")).toBe("2026-10-10");
  });

  it("devuelve una fecha civil válida", () => {
    const r = fechaDeNegocio(new Date(cobroDeLas0130), BUENOS_AIRES, "04:00");
    expect(r.ok && fechaCivilDesdeTexto(r.valor).ok).toBe(true);
  });

  it("el corte 06:00 de caja: sesión abierta el 11/10 a las 05:30 es jornada 10/10", () => {
    expect(jornada("2026-10-11T08:30:00Z", BUENOS_AIRES, "06:00")).toBe("2026-10-10");
  });
});

describe("fecha de negocio: bordes del corte", () => {
  it("un milisegundo antes del corte rige la jornada anterior; en punto, la nueva", () => {
    // Corte 04:00 locales = 07:00 UTC.
    expect(jornada("2026-10-11T06:59:59.999Z", BUENOS_AIRES, "04:00")).toBe("2026-10-10");
    expect(jornada("2026-10-11T07:00:00.000Z", BUENOS_AIRES, "04:00")).toBe("2026-10-11");
    expect(jornada("2026-10-11T07:00:00.001Z", BUENOS_AIRES, "04:00")).toBe("2026-10-11");
  });

  it("los segundos no mueven el corte: 03:59:59 es anterior y 04:00:59 ya es la jornada nueva", () => {
    expect(jornada("2026-10-11T06:59:59Z", BUENOS_AIRES, "04:00")).toBe("2026-10-10");
    expect(jornada("2026-10-11T07:00:59Z", BUENOS_AIRES, "04:00")).toBe("2026-10-11");
  });

  it("el corte con minutos: 04:30 corta exactamente a las 04:30", () => {
    expect(jornada("2026-10-11T07:29:59Z", BUENOS_AIRES, "04:30")).toBe("2026-10-10");
    expect(jornada("2026-10-11T07:30:00Z", BUENOS_AIRES, "04:30")).toBe("2026-10-11");
  });

  it("el minuto dentro de la hora cuenta: 04:59 es posterior al corte 04:01 y anterior a 05:00", () => {
    expect(jornada("2026-10-11T07:59:00Z", BUENOS_AIRES, "04:01")).toBe("2026-10-11");
    expect(jornada("2026-10-11T07:59:00Z", BUENOS_AIRES, "05:00")).toBe("2026-10-10");
  });

  it("con corte 00:00 la medianoche local cambia el día", () => {
    expect(jornada("2026-10-12T02:59:59.999Z", BUENOS_AIRES, "00:00")).toBe("2026-10-11");
    expect(jornada("2026-10-12T03:00:00.000Z", BUENOS_AIRES, "00:00")).toBe("2026-10-12");
  });

  it("23:59 locales sigue en el día; con corte 23:59 el cambio es en ese minuto", () => {
    expect(jornada("2026-10-12T02:59:00Z", BUENOS_AIRES, "00:00")).toBe("2026-10-11");
    expect(jornada("2026-10-12T02:58:59Z", BUENOS_AIRES, "23:59")).toBe("2026-10-10");
    expect(jornada("2026-10-12T02:59:00Z", BUENOS_AIRES, "23:59")).toBe("2026-10-11");
    expect(jornada("2026-10-12T03:00:00Z", BUENOS_AIRES, "23:59")).toBe("2026-10-11");
  });

  it("lo que cuenta es la hora local, no la de UTC: a las 22:00 locales UTC ya está en el día siguiente", () => {
    // 2026-10-11 22:00 en Buenos Aires = 2026-10-12 01:00 UTC.
    expect(jornada("2026-10-12T01:00:00Z", BUENOS_AIRES, "00:00")).toBe("2026-10-11");
    expect(jornada("2026-10-12T01:00:00Z", "UTC", "00:00")).toBe("2026-10-12");
  });
});

describe("fecha de negocio: cambios de día, mes y año, y bisiestos", () => {
  it("cambio de mes (sin y con corte)", () => {
    expect(jornada("2026-11-01T02:59:59Z", BUENOS_AIRES, "00:00")).toBe("2026-10-31");
    expect(jornada("2026-11-01T03:00:00Z", BUENOS_AIRES, "00:00")).toBe("2026-11-01");
    expect(jornada("2026-11-01T05:00:00Z", BUENOS_AIRES, "04:00")).toBe("2026-10-31");
    expect(jornada("2026-11-01T07:00:00Z", BUENOS_AIRES, "04:00")).toBe("2026-11-01");
  });

  it("cambio de año: la madrugada del 1/1 con corte pertenece al 31/12", () => {
    expect(jornada("2027-01-01T02:59:59Z", BUENOS_AIRES, "00:00")).toBe("2026-12-31");
    expect(jornada("2027-01-01T03:00:00Z", BUENOS_AIRES, "00:00")).toBe("2027-01-01");
    expect(jornada("2027-01-01T05:00:00Z", BUENOS_AIRES, "04:00")).toBe("2026-12-31");
    expect(jornada("2027-01-01T07:00:00Z", BUENOS_AIRES, "04:00")).toBe("2027-01-01");
  });

  it("año bisiesto: el 1/3 con corte es 29/2; en un año común es 28/2", () => {
    expect(jornada("2028-03-01T05:00:00Z", BUENOS_AIRES, "04:00")).toBe("2028-02-29");
    expect(jornada("2028-03-01T07:00:00Z", BUENOS_AIRES, "04:00")).toBe("2028-03-01");
    expect(jornada("2028-02-29T12:00:00Z", BUENOS_AIRES, "00:00")).toBe("2028-02-29");
    expect(jornada("2027-03-01T05:00:00Z", BUENOS_AIRES, "04:00")).toBe("2027-02-28");
    expect(jornada("2026-03-01T05:00:00Z", BUENOS_AIRES, "04:00")).toBe("2026-02-28");
  });

  it("siglos: 1900 no es bisiesto y 2000 sí", () => {
    expect(jornada("1900-03-01T00:30:00Z", "UTC", "01:00")).toBe("1900-02-28");
    expect(jornada("2000-03-01T00:30:00Z", "UTC", "01:00")).toBe("2000-02-29");
    expect(jornada("2100-03-01T00:30:00Z", "UTC", "01:00")).toBe("2100-02-28");
  });

  it("años de tres y menos dígitos no se leen como 19xx", () => {
    expect(jornada("0099-05-05T12:00:00Z", "UTC", "00:00")).toBe("0099-05-05");
    expect(jornada("0099-05-05T00:30:00Z", "UTC", "01:00")).toBe("0099-05-04");
    expect(jornada("0004-03-01T00:30:00Z", "UTC", "01:00")).toBe("0004-02-29");
    expect(jornada("0001-03-01T00:30:00Z", "UTC", "01:00")).toBe("0001-02-28");
    expect(jornada("0001-01-04T00:30:00Z", "UTC", "01:00")).toBe("0001-01-03");
  });
});

describe("fecha de negocio: otras zonas, con y sin horario de verano", () => {
  it("Nueva York, primavera 2026: el reloj salta de 02:00 a 03:00 el 8/3 (07:00 UTC)", () => {
    const ny = "America/New_York";
    // 06:30 UTC = 01:30 EST; 07:00 UTC = 03:00 EDT.
    expect(jornada("2026-03-08T06:59:59Z", ny, "02:00")).toBe("2026-03-07");
    expect(jornada("2026-03-08T07:00:00Z", ny, "02:00")).toBe("2026-03-08");
    expect(jornada("2026-03-08T07:00:00Z", ny, "03:00")).toBe("2026-03-08");
    expect(jornada("2026-03-08T06:59:59Z", ny, "03:00")).toBe("2026-03-07");
  });

  it("Nueva York usa el desfase de cada época: invierno −5, verano −4", () => {
    const ny = "America/New_York";
    // Medianoche local del 1/1 (EST) = 05:00 UTC; del 1/7 (EDT) = 04:00 UTC.
    expect(jornada("2026-01-01T04:59:59Z", ny, "00:00")).toBe("2025-12-31");
    expect(jornada("2026-01-01T05:00:00Z", ny, "00:00")).toBe("2026-01-01");
    expect(jornada("2026-07-01T03:59:59Z", ny, "00:00")).toBe("2026-06-30");
    expect(jornada("2026-07-01T04:00:00Z", ny, "00:00")).toBe("2026-07-01");
    // El mismo corte 00:00 cae a distinta hora UTC según la época: lo que fija es la hora local.
    expect(jornada("2026-07-01T04:30:00Z", ny, "00:30")).toBe("2026-07-01");
    expect(jornada("2026-01-01T04:30:00Z", ny, "00:30")).toBe("2025-12-31");
  });

  it("Nueva York, otoño 2026: la hora 01:00-02:00 se repite el 1/11", () => {
    const ny = "America/New_York";
    // 05:30 UTC = 01:30 EDT (primera vez); 06:30 UTC = 01:30 EST (segunda vez).
    expect(jornada("2026-11-01T05:29:59Z", ny, "01:30")).toBe("2026-10-31");
    expect(jornada("2026-11-01T05:30:00Z", ny, "01:30")).toBe("2026-11-01");
    expect(jornada("2026-11-01T06:30:00Z", ny, "01:30")).toBe("2026-11-01");
    expect(jornada("2026-11-01T07:00:00Z", ny, "02:00")).toBe("2026-11-01");
  });

  it("hemisferio sur: Sídney pasa a horario de verano (+11) el 4/10/2026 a las 16:00 UTC", () => {
    const sidney = "Australia/Sydney";
    // Antes: +10. 15:59:59 UTC = 01:59:59 del 4/10; 16:00 UTC = 03:00 del 4/10.
    expect(jornada("2026-10-03T15:59:59Z", sidney, "02:00")).toBe("2026-10-03");
    expect(jornada("2026-10-03T16:00:00Z", sidney, "03:00")).toBe("2026-10-04");
    // Ya con +11, medianoche local del 5/10 = 13:00 UTC del 4/10.
    expect(jornada("2026-10-04T12:59:59Z", sidney, "00:00")).toBe("2026-10-04");
    expect(jornada("2026-10-04T13:00:00Z", sidney, "00:00")).toBe("2026-10-05");
  });

  it("Londres: GMT en invierno, BST (+1) en verano", () => {
    const londres = "Europe/London";
    expect(jornada("2026-01-15T00:00:00Z", londres, "00:00")).toBe("2026-01-15");
    expect(jornada("2026-07-14T23:00:00Z", londres, "00:00")).toBe("2026-07-15");
    expect(jornada("2026-07-14T22:59:59Z", londres, "00:00")).toBe("2026-07-14");
  });

  it("desfases con media hora o tres cuartos, y el de +14", () => {
    expect(jornada("2026-10-10T18:29:59Z", "Asia/Kolkata", "00:00")).toBe("2026-10-10");
    expect(jornada("2026-10-10T18:30:00Z", "Asia/Kolkata", "00:00")).toBe("2026-10-11");
    expect(jornada("2026-10-10T18:14:59Z", "Asia/Kathmandu", "00:00")).toBe("2026-10-10");
    expect(jornada("2026-10-10T18:15:00Z", "Asia/Kathmandu", "00:00")).toBe("2026-10-11");
    expect(jornada("2026-10-09T09:59:59Z", "Pacific/Kiritimati", "00:00")).toBe("2026-10-09");
    expect(jornada("2026-10-10T10:00:00Z", "Pacific/Kiritimati", "00:00")).toBe("2026-10-11");
    expect(jornada("2026-10-10T10:00:00Z", "Pacific/Pago_Pago", "00:00")).toBe("2026-10-09");
  });

  it("zonas con segmentos de guion, signo y dígitos en el nombre", () => {
    expect(jornada("2026-10-11T04:30:00Z", "Etc/GMT+3", "00:00")).toBe("2026-10-11");
    expect(jornada("2026-10-11T04:30:00Z", "Etc/GMT+3", "02:00")).toBe("2026-10-10");
    expect(jornada("2026-10-11T04:30:00Z", "America/Port-au-Prince", "00:00")).toBe("2026-10-11");
    expect(jornada("2026-10-11T04:30:00Z", "Etc/UTC", "00:00")).toBe("2026-10-11");
  });
});

describe("fecha de negocio: errores tipados, nunca excepciones", () => {
  const instante = new Date("2026-10-11T04:30:00Z");

  it.each(["24:00", "04:60", "4:00", "04:00:00", "", "medianoche", " 04:00"])(
    "hora de corte inválida %j",
    (corte) => {
      expect(fechaDeNegocio(instante, BUENOS_AIRES, corte)).toEqual({
        ok: false,
        error: "HORA_DE_CORTE_INVALIDA",
      });
    },
  );

  it.each([
    "Foo/Bar",
    "America/Argentina/Buenos_Aires_",
    "America/Argentina/Buenos Aires",
    "",
    " ",
    "UTC ",
    " UTC",
    "UTCX",
    "+03:00",
    "-03:00",
    "UTC+3",
    "EST",
    "GMT",
    "utc",
    "Japan",
    "America",
    "America/",
    "/America",
    "America//New_York",
    "america/argentina/buenos_aires",
    "america/Argentina/Buenos_Aires",
    "America/argentina/Buenos_Aires",
    "America/Argentina/buenos_aires",
    "Xx/Yy",
    "America/New_York\n",
    "\nAmerica/New_York",
  ])("zona horaria inexistente o que no es un nombre canónico %j", (zona) => {
    expect(fechaDeNegocio(instante, zona, "00:00")).toEqual({
      ok: false,
      error: "ZONA_HORARIA_INVALIDA",
    });
  });

  it("instante inválido (Date con NaN)", () => {
    expect(fechaDeNegocio(new Date(Number.NaN), BUENOS_AIRES, "00:00")).toEqual({
      ok: false,
      error: "INSTANTE_INVALIDO",
    });
  });

  it("los límites de los instantes representables, al milisegundo", () => {
    expect(INSTANTE_MINIMO).toBe(Date.parse("0001-01-03T00:00:00Z"));
    expect(INSTANTE_MAXIMO).toBe(Date.parse("9999-12-30T00:00:00Z"));
    for (const zona of ["Pacific/Pago_Pago", "Pacific/Kiritimati", BUENOS_AIRES, "UTC"]) {
      for (const corte of ["00:00", "23:59"]) {
        for (const borde of [INSTANTE_MINIMO, INSTANTE_MAXIMO]) {
          const r = fechaDeNegocio(new Date(borde), zona, corte);
          expect(r.ok && fechaCivilDesdeTexto(r.valor).ok).toBe(true);
        }
      }
    }
    expect(fechaDeNegocio(new Date(INSTANTE_MINIMO - 1), "UTC", "00:00").ok).toBe(false);
    expect(fechaDeNegocio(new Date(INSTANTE_MAXIMO + 1), "UTC", "00:00").ok).toBe(false);
    expect(fechaDeNegocio(new Date(INSTANTE_MINIMO - 1), "UTC", "00:00")).toEqual({
      ok: false,
      error: "INSTANTE_INVALIDO",
    });
    expect(fechaDeNegocio(new Date(8.64e15), "UTC", "00:00")).toEqual({
      ok: false,
      error: "INSTANTE_INVALIDO",
    });
    expect(fechaDeNegocio(new Date(-8.64e15), "UTC", "00:00")).toEqual({
      ok: false,
      error: "INSTANTE_INVALIDO",
    });
  });

  it("si hay varios errores, devuelve el primero: hora de corte, zona, instante", () => {
    const malo = new Date(Number.NaN);
    expect(fechaDeNegocio(malo, "Foo/Bar", "99:99")).toEqual({
      ok: false,
      error: "HORA_DE_CORTE_INVALIDA",
    });
    expect(fechaDeNegocio(malo, "Foo/Bar", "00:00")).toEqual({
      ok: false,
      error: "ZONA_HORARIA_INVALIDA",
    });
    expect(fechaDeNegocio(malo, BUENOS_AIRES, "00:00")).toEqual({
      ok: false,
      error: "INSTANTE_INVALIDO",
    });
  });
});

describe("fecha de negocio: propiedades", () => {
  it("corte 00:00 equivale a la fecha civil local", () => {
    fc.assert(
      fc.property(instanteModerno, zonaFija, (ms, [zona, desfase]) => {
        const r = fechaDeNegocio(new Date(ms), zona, "00:00");
        expect(r).toEqual({ ok: true, valor: oraculo(ms, desfase, 0) });
      }),
    );
  });

  it("coincide con el oráculo (instante + desfase − corte) para cualquier corte y zona fija", () => {
    fc.assert(
      fc.property(instanteModerno, zonaFija, corteEnMinutos, (ms, [zona, desfase], corte) => {
        const r = fechaDeNegocio(new Date(ms), zona, aTexto(corte));
        expect(r).toEqual({ ok: true, valor: oraculo(ms, desfase, corte) });
      }),
    );
  });

  it("el cambio de fecha ocurre exactamente en el corte", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.parse("2020-01-02Z") / DIA, max: Date.parse("2035-12-30Z") / DIA }),
        zonaFija,
        corteEnMinutos,
        fc.integer({ min: 0, max: MINUTO - 1 }),
        (diaUtc, [zona, desfase], corte, dentroDelMinuto) => {
          // Instante en que el reloj local marca la hora de corte del día `diaUtc` (UTC) en esa zona.
          const enElCorte = diaUtc * DIA + (corte - desfase) * MINUTO;
          const dia = (n: number) => new Date(n * DIA).toISOString().slice(0, 10);
          const en = (ms: number) => fechaDeNegocio(new Date(ms), zona, aTexto(corte));
          expect(en(enElCorte)).toEqual({ ok: true, valor: dia(diaUtc) });
          expect(en(enElCorte + dentroDelMinuto)).toEqual({ ok: true, valor: dia(diaUtc) });
          expect(en(enElCorte - 1)).toEqual({ ok: true, valor: dia(diaUtc - 1) });
          // Un día después de la hora de corte cambia otra vez, y un milisegundo antes todavía no.
          expect(en(enElCorte + DIA - 1)).toEqual({ ok: true, valor: dia(diaUtc) });
          expect(en(enElCorte + DIA)).toEqual({ ok: true, valor: dia(diaUtc + 1) });
        },
      ),
    );
  });

  it("es monótona en el instante (zonas fijas y cualquier corte)", () => {
    fc.assert(
      fc.property(instanteModerno, instanteModerno, zonaFija, corteEnMinutos, (a, b, [zona], c) => {
        const [antes, despues] = a <= b ? [a, b] : [b, a];
        const f1 = fechaDeNegocio(new Date(antes), zona, aTexto(c));
        const f2 = fechaDeNegocio(new Date(despues), zona, aTexto(c));
        expect(f1.ok && f2.ok && f1.valor <= f2.valor).toBe(true);
      }),
    );
  });

  it("es monótona también con horario de verano si el corte no cae en la hora que se repite", () => {
    const conVerano = ["America/New_York", "Europe/London", "Australia/Sydney"];
    // Las horas que se repiten al atrasar el reloj están entre la 01:00 y las 03:00 en estas zonas; se evita (00:59, 03:00).
    const corteSeguro = fc.oneof(
      fc.integer({ min: 0, max: 59 }),
      fc.integer({ min: 180, max: 1439 }),
    );
    fc.assert(
      fc.property(
        fc.integer({ min: Date.parse("2020-01-01Z"), max: Date.parse("2040-01-01Z") }),
        fc.integer({ min: 0, max: 400 * DIA }),
        fc.constantFrom(...conVerano),
        corteSeguro,
        (a, salto, zona, c) => {
          const f1 = fechaDeNegocio(new Date(a), zona, aTexto(c));
          const f2 = fechaDeNegocio(new Date(a + salto), zona, aTexto(c));
          expect(f1.ok && f2.ok && f1.valor <= f2.valor).toBe(true);
        },
      ),
    );
  });

  it("con horario de verano, el desfase de cada época se respeta (oráculo por temporada)", () => {
    // [zona, desfase de la hora estándar, desfase de la hora de verano] en minutos; enero y julio de 2020 a 2035.
    const casos = [
      ["America/New_York", -300, -240, "norte"],
      ["Europe/London", 0, 60, "norte"],
      ["Australia/Sydney", 600, 660, "sur"],
    ] as const;
    fc.assert(
      fc.property(
        fc.constantFrom(...casos),
        fc.integer({ min: 2020, max: 2035 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 40 * DIA }),
        corteEnMinutos,
        (caso, anio, enero, desde, corte) => {
          const [zona, invierno, verano, hemisferio] = caso;
          // En enero rige el verano del sur y el invierno del norte; en julio, al revés.
          const desfase = enero === (hemisferio === "sur") ? verano : invierno;
          const ms = Date.parse(`${anio}-${enero ? "01" : "07"}-05T00:00:00Z`) + desde;
          const r = fechaDeNegocio(new Date(ms), zona, aTexto(corte));
          expect(r).toEqual({ ok: true, valor: oraculo(ms, desfase, corte) });
        },
      ),
    );
  });

  it("siempre da una fecha civil válida", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: INSTANTE_MINIMO, max: INSTANTE_MAXIMO }),
        fc.constantFrom(
          ...ZONAS_FIJAS.map(([zona]) => zona),
          "America/New_York",
          "Australia/Sydney",
        ),
        corteEnMinutos,
        (ms, zona, corte) => {
          const r = fechaDeNegocio(new Date(ms), zona, aTexto(corte));
          expect(r.ok && fechaCivilDesdeTexto(r.valor).ok).toBe(true);
        },
      ),
    );
  });

  it("subir el corte nunca adelanta la jornada, y retrasa como mucho un día", () => {
    fc.assert(
      fc.property(
        instanteModerno,
        zonaFija,
        corteEnMinutos,
        corteEnMinutos,
        (ms, [zona], c1, c2) => {
          const [bajo, alto] = c1 <= c2 ? [c1, c2] : [c2, c1];
          const conBajo = fechaDeNegocio(new Date(ms), zona, aTexto(bajo));
          const conAlto = fechaDeNegocio(new Date(ms), zona, aTexto(alto));
          if (!conBajo.ok || !conAlto.ok) throw new Error("se esperaban fechas");
          expect(conAlto.valor <= conBajo.valor).toBe(true);
          const unDiaAntes = new Date(Date.parse(conBajo.valor) - DIA).toISOString().slice(0, 10);
          expect(conAlto.valor >= unDiaAntes).toBe(true);
        },
      ),
    );
  });
});

describe("fecha de negocio: un caso que NO es monótono y queda a la vista", () => {
  it("Nueva York, corte 01:30, noche en que se repite la hora: la fecha vuelve para atrás", () => {
    // 05:59 UTC = 01:59 EDT (corte cumplido → 1/11); 06:00 UTC = 01:00 EST (todavía no → 31/10).
    // Es la misma fórmula que la de la base: la jornada sigue al reloj de pared, que retrocede.
    const ny = "America/New_York";
    expect(jornada("2026-11-01T05:59:00Z", ny, "01:30")).toBe("2026-11-01");
    expect(jornada("2026-11-01T06:00:00Z", ny, "01:30")).toBe("2026-10-31");
  });
});
