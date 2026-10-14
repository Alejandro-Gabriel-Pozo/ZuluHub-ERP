import { describe, expect, it } from "vitest";
import { LIMITES_DE_INACTIVIDAD } from "../experiencia/inactividad";
import {
  LIMITES_DE_SESION,
  segundosDeInactividad,
  vencimientoRenovado,
  vigenciaDeSesion,
  type DatosDeSesion,
  type LimitesDeSesion,
} from "./vigencia-de-sesion";

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const CREADA = new Date("2026-10-13T08:00:00.000Z");
const mas = (base: Date, ms: number) => new Date(base.getTime() + ms);

describe("LIMITES_DE_SESION (decisión del dueño)", () => {
  it("la inactividad es la de la pantalla (una sola fuente) y el tope absoluto es de 8 horas", () => {
    expect(LIMITES_DE_SESION.inactividad).toBe(LIMITES_DE_INACTIVIDAD);
    expect(LIMITES_DE_SESION.absolutoEnMs).toBe(8 * HORA);
    expect(LIMITES_DE_SESION.inactividad.vencimientoEnMs).toBe(15 * MINUTO);
  });

  it("no se puede cambiar por accidente", () => {
    expect(Object.isFrozen(LIMITES_DE_SESION)).toBe(true);
  });
});

describe("segundosDeInactividad", () => {
  it("son 900 con los límites del dueño (lo que se le da a la librería como expiresIn)", () => {
    expect(segundosDeInactividad()).toBe(900);
  });

  it("sale del límite de inactividad y no de otro número", () => {
    const limites: LimitesDeSesion = {
      inactividad: { avisoEnMs: 1000, vencimientoEnMs: 7000 },
      absolutoEnMs: 99 * HORA,
    };
    expect(segundosDeInactividad(limites)).toBe(7);
  });
});

describe("vencimientoRenovado (G5: nunca más de 8 horas desde la creación)", () => {
  it("con la sesión joven, vence a 15 minutos de ahora", () => {
    const ahora = mas(CREADA, HORA);
    expect(vencimientoRenovado(CREADA, ahora)).toEqual(mas(ahora, 15 * MINUTO));
  });

  it("cerca del tope, el tope manda: a las 7 h 50 vence a las 8 h, no a las 8 h 05", () => {
    const ahora = mas(CREADA, 7 * HORA + 50 * MINUTO);
    expect(vencimientoRenovado(CREADA, ahora)).toEqual(mas(CREADA, 8 * HORA));
  });

  it("justo cuando los dos coinciden da lo mismo", () => {
    const ahora = mas(CREADA, 8 * HORA - 15 * MINUTO);
    expect(vencimientoRenovado(CREADA, ahora)).toEqual(mas(CREADA, 8 * HORA));
  });

  it("pasado el tope, el vencimiento ya pasó (no se estira)", () => {
    const ahora = mas(CREADA, 9 * HORA);
    expect(vencimientoRenovado(CREADA, ahora)).toEqual(mas(CREADA, 8 * HORA));
    expect(vencimientoRenovado(CREADA, ahora).getTime()).toBeLessThan(ahora.getTime());
  });

  it("respeta los límites que se le pasan", () => {
    const limites: LimitesDeSesion = {
      inactividad: { avisoEnMs: MINUTO, vencimientoEnMs: 5 * MINUTO },
      absolutoEnMs: 20 * MINUTO,
    };
    expect(vencimientoRenovado(CREADA, mas(CREADA, 10 * MINUTO), limites)).toEqual(
      mas(CREADA, 15 * MINUTO),
    );
    expect(vencimientoRenovado(CREADA, mas(CREADA, 18 * MINUTO), limites)).toEqual(
      mas(CREADA, 20 * MINUTO),
    );
  });

  it("una fecha inválida da una fecha ya vencida: falla cerrado", () => {
    expect(vencimientoRenovado(new Date(Number.NaN), CREADA)).toEqual(new Date(0));
    expect(vencimientoRenovado(CREADA, new Date(Number.NaN))).toEqual(new Date(0));
  });
});

describe("vigenciaDeSesion", () => {
  const HOST = "app.marca-a.test";
  const AHORA = mas(CREADA, 2 * HORA);
  const buena = (cambios: Partial<DatosDeSesion> = {}): DatosDeSesion => ({
    host: HOST,
    creadaEn: CREADA,
    ultimoUso: mas(AHORA, -MINUTO),
    venceEn: mas(AHORA, 10 * MINUTO),
    ...cambios,
  });
  const veredicto = (cambios: Partial<DatosDeSesion> = {}, host = HOST, ahora = AHORA) =>
    vigenciaDeSesion(buena(cambios), host, ahora);

  it("una sesión del host, reciente y dentro de los dos topes está vigente", () => {
    expect(veredicto()).toBe("VIGENTE");
  });

  describe("el host (G4)", () => {
    it("otro host: OTRO_HOST", () => {
      expect(veredicto({}, "app.marca-b.test")).toBe("OTRO_HOST");
    });
    it("se decide antes que el vencimiento: una vencida de otro host es OTRO_HOST", () => {
      expect(veredicto({ venceEn: mas(AHORA, -MINUTO) }, "app.marca-b.test")).toBe("OTRO_HOST");
    });
    it("no se ignoran las mayúsculas ni los blancos: son otro texto", () => {
      expect(veredicto({}, "APP.marca-a.test")).toBe("OTRO_HOST");
      expect(veredicto({}, `${HOST} `)).toBe("OTRO_HOST");
    });
    it("un host del pedido vacío nunca coincide, ni siquiera con una sesión sin host", () => {
      expect(veredicto({}, "")).toBe("OTRO_HOST");
      expect(veredicto({ host: "" }, "")).toBe("OTRO_HOST");
    });
    it("una sesión sin host guardado no vale en ningún host", () => {
      expect(veredicto({ host: "" })).toBe("OTRO_HOST");
    });
  });

  describe("el vencimiento guardado", () => {
    it("justo en el vencimiento ya venció; un milisegundo antes, no", () => {
      expect(veredicto({ venceEn: AHORA })).toBe("VENCIDA");
      expect(veredicto({ venceEn: mas(AHORA, 1) })).toBe("VIGENTE");
    });
    it("una fecha inválida cuenta como vencida", () => {
      expect(veredicto({ venceEn: new Date(Number.NaN) })).toBe("VENCIDA");
    });
  });

  describe("el tope absoluto de 8 horas", () => {
    const ahoraA8h = (extra: number) => mas(CREADA, 8 * HORA + extra);
    it("a las 8 horas justas está vencida; un milisegundo antes, no", () => {
      const sesion = (ahora: Date) =>
        buena({ ultimoUso: mas(ahora, -MINUTO), venceEn: mas(ahora, 10 * MINUTO) });
      expect(veredicto(sesion(ahoraA8h(0)), HOST, ahoraA8h(0))).toBe("VENCIDA");
      expect(veredicto(sesion(ahoraA8h(-1)), HOST, ahoraA8h(-1))).toBe("VIGENTE");
      expect(veredicto(sesion(ahoraA8h(MINUTO)), HOST, ahoraA8h(MINUTO))).toBe("VENCIDA");
    });
    it("aunque haya actividad ahora mismo y el vencimiento guardado esté lejos", () => {
      const ahora = ahoraA8h(MINUTO);
      expect(veredicto({ ultimoUso: ahora, venceEn: mas(ahora, 60 * MINUTO) }, HOST, ahora)).toBe(
        "VENCIDA",
      );
    });
    it("una fecha de creación inválida cuenta como vencida", () => {
      expect(veredicto({ creadaEn: new Date(Number.NaN) })).toBe("VENCIDA");
    });
    it("el tope es el de los límites que se pasan", () => {
      const limites: LimitesDeSesion = {
        inactividad: LIMITES_DE_INACTIVIDAD,
        absolutoEnMs: HORA,
      };
      const ahora = mas(CREADA, HORA);
      const sesion = buena({ ultimoUso: ahora, venceEn: mas(ahora, 10 * MINUTO) });
      expect(vigenciaDeSesion(sesion, HOST, ahora, limites)).toBe("VENCIDA");
      expect(vigenciaDeSesion(sesion, HOST, ahora)).toBe("VIGENTE");
    });
  });

  describe("la inactividad (15 minutos, aunque el vencimiento guardado esté lejos)", () => {
    it("14 min 59 s sin uso, vigente (aunque ya esté en el aviso); 15 minutos justos, vencida", () => {
      expect(veredicto({ ultimoUso: mas(AHORA, -15 * MINUTO + 1) })).toBe("VIGENTE");
      expect(veredicto({ ultimoUso: mas(AHORA, -13 * MINUTO) })).toBe("VIGENTE");
      expect(veredicto({ ultimoUso: mas(AHORA, -15 * MINUTO) })).toBe("VENCIDA");
      expect(veredicto({ ultimoUso: mas(AHORA, -16 * MINUTO) })).toBe("VENCIDA");
    });
    it("un último uso en el futuro (relojes distintos) cuenta como uso reciente", () => {
      expect(veredicto({ ultimoUso: mas(AHORA, 5 * MINUTO) })).toBe("VIGENTE");
    });
    it("un último uso inválido cuenta como vencida", () => {
      expect(veredicto({ ultimoUso: new Date(Number.NaN) })).toBe("VENCIDA");
    });
    it("usa los límites de inactividad que se pasan", () => {
      const limites: LimitesDeSesion = {
        inactividad: { avisoEnMs: MINUTO, vencimientoEnMs: 3 * MINUTO },
        absolutoEnMs: 8 * HORA,
      };
      const sesion = buena({ ultimoUso: mas(AHORA, -4 * MINUTO) });
      expect(vigenciaDeSesion(sesion, HOST, AHORA, limites)).toBe("VENCIDA");
      expect(vigenciaDeSesion(sesion, HOST, AHORA)).toBe("VIGENTE");
    });
  });

  it("cada razón de vencimiento alcanza por sí sola", () => {
    expect(veredicto({ venceEn: mas(AHORA, -1) })).toBe("VENCIDA");
    expect(veredicto({ ultimoUso: mas(AHORA, -20 * MINUTO) })).toBe("VENCIDA");
    expect(veredicto({ creadaEn: mas(AHORA, -9 * HORA) })).toBe("VENCIDA");
  });
});
