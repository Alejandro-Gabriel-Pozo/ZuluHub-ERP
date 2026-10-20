import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  TOLERANCIA_DE_RELOJ_EN_MS,
  VENTANA_DE_ENROLAMIENTO_EN_MS,
  VENTANA_DEL_SEGUNDO_FACTOR_RECIENTE_EN_MS,
  puedeEnrolar,
  segundoFactorReciente,
  segundoFactorRecienteHastaMs,
} from "./ventanas-de-segundo-factor";

const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;
const AHORA = new Date("2026-10-20T12:00:00.000Z");
const hace = (ms: number) => new Date(AHORA.getTime() - ms);
const INVALIDA = new Date("no es una fecha");

describe("las ventanas (DECIDIDO por el dueño y ASUMIDO en h5-p8)", () => {
  it("«reciente» son 5 minutos, enrolar son 10 y la tolerancia del reloj es de 1", () => {
    expect(VENTANA_DEL_SEGUNDO_FACTOR_RECIENTE_EN_MS).toBe(5 * MINUTO);
    expect(VENTANA_DE_ENROLAMIENTO_EN_MS).toBe(10 * MINUTO);
    expect(TOLERANCIA_DE_RELOJ_EN_MS).toBe(MINUTO);
  });
});

describe("segundoFactorReciente (G3)", () => {
  it("nunca verificado: no", () => {
    expect(segundoFactorReciente(null, AHORA)).toBe(false);
  });

  it("recién verificado y hasta 5 minutos justos: sí; un milisegundo más: no", () => {
    expect(segundoFactorReciente(hace(0), AHORA)).toBe(true);
    expect(segundoFactorReciente(hace(4 * MINUTO + 59 * SEGUNDO), AHORA)).toBe(true);
    expect(segundoFactorReciente(hace(5 * MINUTO), AHORA)).toBe(true);
    expect(segundoFactorReciente(hace(5 * MINUTO + 1), AHORA)).toBe(false);
    expect(segundoFactorReciente(hace(60 * MINUTO), AHORA)).toBe(false);
  });

  it("una verificación apenas en el futuro (diferencia de reloj entre instancias) vale; una muy en el futuro no", () => {
    expect(segundoFactorReciente(hace(-1), AHORA)).toBe(true);
    expect(segundoFactorReciente(hace(-MINUTO), AHORA)).toBe(true);
    expect(segundoFactorReciente(hace(-MINUTO - 1), AHORA)).toBe(false);
    expect(segundoFactorReciente(hace(-24 * 60 * MINUTO), AHORA)).toBe(false);
  });

  it("una fecha inválida no es reciente (falla cerrado), ni con un reloj inválido", () => {
    expect(segundoFactorReciente(INVALIDA, AHORA)).toBe(false);
    expect(segundoFactorReciente(hace(0), INVALIDA)).toBe(false);
  });
});

describe("segundoFactorRecienteHastaMs", () => {
  it("recién verificado le quedan los 5 minutos enteros, y baja con el tiempo", () => {
    expect(segundoFactorRecienteHastaMs(hace(0), AHORA)).toBe(5 * MINUTO);
    expect(segundoFactorRecienteHastaMs(hace(MINUTO), AHORA)).toBe(4 * MINUTO);
    expect(segundoFactorRecienteHastaMs(hace(5 * MINUTO - 1), AHORA)).toBe(1);
  });

  it("a los 5 minutos justos quedan 0; pasado el plazo, nunca verificado o inválido: 0", () => {
    expect(segundoFactorRecienteHastaMs(hace(5 * MINUTO), AHORA)).toBe(0);
    expect(segundoFactorRecienteHastaMs(hace(5 * MINUTO + 1), AHORA)).toBe(0);
    expect(segundoFactorRecienteHastaMs(null, AHORA)).toBe(0);
    expect(segundoFactorRecienteHastaMs(INVALIDA, AHORA)).toBe(0);
  });

  it("una verificación apenas en el futuro no prolonga la ventana: quedan 5 minutos, no más", () => {
    expect(segundoFactorRecienteHastaMs(hace(-30 * SEGUNDO), AHORA)).toBe(5 * MINUTO);
    expect(segundoFactorRecienteHastaMs(hace(-2 * MINUTO), AHORA)).toBe(0);
  });

  it("propiedad: es 0 si y solo si no es reciente o se cumplió el plazo, y nunca pasa de 5 minutos", () => {
    fc.assert(
      fc.property(fc.integer({ min: -20 * MINUTO, max: 20 * MINUTO }), (edad) => {
        const hasta = segundoFactorRecienteHastaMs(hace(edad), AHORA);
        expect(hasta).toBeGreaterThanOrEqual(0);
        expect(hasta).toBeLessThanOrEqual(5 * MINUTO);
        expect(hasta > 0).toBe(segundoFactorReciente(hace(edad), AHORA) && edad < 5 * MINUTO);
      }),
    );
  });
});

describe("puedeEnrolar", () => {
  it("la sesión nació hace 10 minutos o menos: sí; un milisegundo más: no", () => {
    expect(puedeEnrolar(hace(0), AHORA)).toBe(true);
    expect(puedeEnrolar(hace(9 * MINUTO + 59 * SEGUNDO), AHORA)).toBe(true);
    expect(puedeEnrolar(hace(10 * MINUTO), AHORA)).toBe(true);
    expect(puedeEnrolar(hace(10 * MINUTO + 1), AHORA)).toBe(false);
    expect(puedeEnrolar(hace(8 * 60 * MINUTO), AHORA)).toBe(false);
  });

  it("la misma tolerancia de reloj, y una fecha inválida no puede enrolar", () => {
    expect(puedeEnrolar(hace(-MINUTO), AHORA)).toBe(true);
    expect(puedeEnrolar(hace(-MINUTO - 1), AHORA)).toBe(false);
    expect(puedeEnrolar(INVALIDA, AHORA)).toBe(false);
    expect(puedeEnrolar(hace(0), INVALIDA)).toBe(false);
  });
});
