import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  SIN_SESION_DE_PLATAFORMA,
  estadoDeSesionDePlataforma,
  type DatosDeSesionDePlataforma,
} from "./estado-de-sesion-de-plataforma";
import {
  LIMITES_DE_SESION,
  LIMITES_DE_SESION_DE_PLATAFORMA,
  vigenciaDeSesion,
} from "./vigencia-de-sesion";

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const AHORA = new Date("2026-10-20T12:00:00.000Z");
const mas = (ms: number) => new Date(AHORA.getTime() + ms);

/** Una sesión creada hace `creada`, usada por última vez hace `usada`, que vence en `vence` y con segundo factor hace `segundoFactor`. */
function sesion(
  creada: number,
  usada: number,
  vence: number,
  segundoFactor: number | null = null,
): DatosDeSesionDePlataforma {
  return {
    creadaEn: mas(-creada),
    ultimoUso: mas(-usada),
    venceEn: mas(vence),
    segundoFactorEn: segundoFactor === null ? null : mas(-segundoFactor),
  };
}

describe("estadoDeSesionDePlataforma", () => {
  it("sin sesión: no vigente, 0 ms, motivo inactividad y sin ventana de segundo factor", () => {
    expect(estadoDeSesionDePlataforma(null, AHORA)).toEqual({
      vigente: false,
      venceEnMs: 0,
      motivo: "INACTIVIDAD",
      segundoFactorRecienteHastaMs: 0,
    });
    expect(SIN_SESION_DE_PLATAFORMA).toEqual(estadoDeSesionDePlataforma(null, AHORA));
    expect(Object.isFrozen(SIN_SESION_DE_PLATAFORMA)).toBe(true);
  });

  it("recién ingresada: vence en 30 minutos por inactividad y todavía no hay segundo factor", () => {
    expect(estadoDeSesionDePlataforma(sesion(0, 0, 30 * MINUTO), AHORA)).toEqual({
      vigente: true,
      venceEnMs: 30 * MINUTO,
      motivo: "INACTIVIDAD",
      segundoFactorRecienteHastaMs: 0,
    });
  });

  it("con el segundo factor verificado hace 1 minuto quedan 4 de ventana", () => {
    const e = estadoDeSesionDePlataforma(sesion(2 * MINUTO, MINUTO, 29 * MINUTO, MINUTO), AHORA);
    expect(e.segundoFactorRecienteHastaMs).toBe(4 * MINUTO);
    expect(e.venceEnMs).toBe(29 * MINUTO);
  });

  it("el segundo factor viejo (6 minutos) ya no da ventana", () => {
    const e = estadoDeSesionDePlataforma(
      sesion(10 * MINUTO, MINUTO, 29 * MINUTO, 6 * MINUTO),
      AHORA,
    );
    expect(e.vigente).toBe(true);
    expect(e.segundoFactorRecienteHastaMs).toBe(0);
  });

  it("la inactividad manda cuando falta menos que para el tope: 20 minutos sin uso → quedan 10", () => {
    expect(
      estadoDeSesionDePlataforma(sesion(3 * HORA, 20 * MINUTO, 10 * MINUTO), AHORA),
    ).toMatchObject({
      vigente: true,
      venceEnMs: 10 * MINUTO,
      motivo: "INACTIVIDAD",
    });
  });

  it("el tope de 8 horas manda cuando falta menos que para la inactividad: a las 7 h 50 quedan 10 minutos", () => {
    expect(
      estadoDeSesionDePlataforma(sesion(7 * HORA + 50 * MINUTO, MINUTO, 10 * MINUTO), AHORA),
    ).toMatchObject({
      vigente: true,
      venceEnMs: 10 * MINUTO,
      motivo: "TOPE_DE_8_HORAS",
    });
  });

  it("si el tope y la inactividad coinciden, el motivo es el tope (el que no se renueva)", () => {
    // A las 7 h 31 y recién usada: el tope vence en 29 minutos y la inactividad en 30 → manda el tope.
    expect(
      estadoDeSesionDePlataforma(sesion(7 * HORA + 31 * MINUTO, 0, 29 * MINUTO), AHORA),
    ).toMatchObject({
      motivo: "TOPE_DE_8_HORAS",
      venceEnMs: 29 * MINUTO,
    });
    // Empate exacto: usada hace 0 y 30 minutos para el tope.
    expect(
      estadoDeSesionDePlataforma(sesion(7 * HORA + 30 * MINUTO, 0, 30 * MINUTO), AHORA),
    ).toMatchObject({
      motivo: "TOPE_DE_8_HORAS",
      venceEnMs: 30 * MINUTO,
    });
  });

  it("el vencimiento guardado más corto que ambos manda en los milisegundos que quedan", () => {
    expect(estadoDeSesionDePlataforma(sesion(MINUTO, MINUTO, 5 * MINUTO), AHORA)).toMatchObject({
      vigente: true,
      venceEnMs: 5 * MINUTO,
    });
  });

  it("vencida por inactividad: 30 minutos justos sin uso", () => {
    expect(estadoDeSesionDePlataforma(sesion(2 * HORA, 30 * MINUTO, 10 * MINUTO), AHORA)).toEqual({
      vigente: false,
      venceEnMs: 0,
      motivo: "INACTIVIDAD",
      segundoFactorRecienteHastaMs: 0,
    });
    // Un milisegundo antes todavía vale.
    expect(
      estadoDeSesionDePlataforma(sesion(2 * HORA, 30 * MINUTO - 1, 10 * MINUTO), AHORA),
    ).toMatchObject({
      vigente: true,
      venceEnMs: 1,
    });
  });

  it("vencida por el tope: 8 horas justas desde que se creó, aunque se la haya usado recién", () => {
    expect(estadoDeSesionDePlataforma(sesion(8 * HORA, 0, 10 * MINUTO, MINUTO), AHORA)).toEqual({
      vigente: false,
      venceEnMs: 0,
      motivo: "TOPE_DE_8_HORAS",
      segundoFactorRecienteHastaMs: 0,
    });
    expect(estadoDeSesionDePlataforma(sesion(8 * HORA - 1, 0, 10 * MINUTO), AHORA)).toMatchObject({
      vigente: true,
      venceEnMs: 1,
      motivo: "TOPE_DE_8_HORAS",
    });
  });

  it("vencida por su vencimiento guardado, en el instante exacto", () => {
    expect(estadoDeSesionDePlataforma(sesion(MINUTO, MINUTO, 0, MINUTO), AHORA)).toMatchObject({
      vigente: false,
      venceEnMs: 0,
      segundoFactorRecienteHastaMs: 0,
    });
    expect(estadoDeSesionDePlataforma(sesion(MINUTO, MINUTO, 1), AHORA)).toMatchObject({
      vigente: true,
      venceEnMs: 1,
    });
  });

  it("una fecha inválida no es vigente (falla cerrado)", () => {
    const rota = new Date("x");
    const base = sesion(MINUTO, MINUTO, 10 * MINUTO);
    for (const campo of ["creadaEn", "ultimoUso", "venceEn"] as const) {
      const e = estadoDeSesionDePlataforma({ ...base, [campo]: rota }, AHORA);
      expect(e.vigente, campo).toBe(false);
      expect(e.venceEnMs, campo).toBe(0);
      expect(e.segundoFactorRecienteHastaMs, campo).toBe(0);
    }
  });

  it("con límites propios usa los suyos", () => {
    const limites = {
      inactividad: { avisoEnMs: 1000, vencimientoEnMs: 4000 },
      absolutoEnMs: 9000,
    };
    expect(estadoDeSesionDePlataforma(sesion(2000, 1000, 100_000), AHORA, limites)).toMatchObject({
      vigente: true,
      venceEnMs: 3000,
      motivo: "INACTIVIDAD",
    });
    expect(estadoDeSesionDePlataforma(sesion(8000, 0, 100_000), AHORA, limites)).toMatchObject({
      venceEnMs: 1000,
      motivo: "TOPE_DE_8_HORAS",
    });
  });

  it("usa por omisión los límites de la consola (30 minutos / 8 horas), no los de empresa (15)", () => {
    // 20 minutos sin uso: vigente en la consola; vencida con los límites de empresa.
    const s = sesion(HORA, 20 * MINUTO, 10 * MINUTO);
    expect(estadoDeSesionDePlataforma(s, AHORA).vigente).toBe(true);
    expect(estadoDeSesionDePlataforma(s, AHORA, LIMITES_DE_SESION).vigente).toBe(false);
  });

  it("propiedad: está vigente exactamente cuando vigenciaDeSesion la da por vigente (una sola cuenta, dos formas)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9 * HORA }),
        fc.integer({ min: 0, max: 40 * MINUTO }),
        fc.integer({ min: -5 * MINUTO, max: 40 * MINUTO }),
        (creada, usada, vence) => {
          const datos = sesion(Math.max(creada, usada), usada, vence);
          const estado = estadoDeSesionDePlataforma(datos, AHORA);
          const vigencia = vigenciaDeSesion(
            {
              host: "h",
              creadaEn: datos.creadaEn,
              ultimoUso: datos.ultimoUso,
              venceEn: datos.venceEn,
            },
            "h",
            AHORA,
            LIMITES_DE_SESION_DE_PLATAFORMA,
          );
          expect(estado.vigente).toBe(vigencia === "VIGENTE");
          expect(estado.venceEnMs >= 0).toBe(true);
          if (!estado.vigente) expect(estado.venceEnMs).toBe(0);
        },
      ),
    );
  });
});
