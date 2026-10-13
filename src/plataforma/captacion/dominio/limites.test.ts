import { describe, expect, it } from "vitest";
import {
  DURACION_DE_VENTANA_EN_MS,
  RETENCION_DE_CONTADORES_EN_MS,
  claveDeContador,
  decidirLimite,
  inicioDeVentana,
  reglasDeLimite,
  type CapaDeLimite,
  type Observacion,
  type ReglaDeLimite,
} from "./limites";

const HUELLA = "0123456789abcdef".repeat(4);
const reglas = reglasDeLimite({ topeGlobalDeVerificacionesPorDia: 40 });
const regla = (capa: CapaDeLimite, ventana: ReglaDeLimite["ventana"]): ReglaDeLimite =>
  reglas.find((r) => r.capa === capa && r.ventana === ventana) as ReglaDeLimite;
const obs = (
  capa: CapaDeLimite,
  ventana: ReglaDeLimite["ventana"],
  cuenta: number,
): Observacion => ({
  regla: regla(capa, ventana),
  cuenta,
});

describe("reglas de límite (§4.2)", () => {
  it("son seis, con estos topes y esta visibilidad", () => {
    expect(reglas).toEqual([
      { capa: "IP", ventana: "HORA", tope: 10, alPasar: "VISIBLE" },
      { capa: "IP", ventana: "DIA", tope: 30, alPasar: "VISIBLE" },
      { capa: "CORREO", ventana: "DIA", tope: 5, alPasar: "SILENCIOSO" },
      { capa: "CORREO", ventana: "SEMANA", tope: 10, alPasar: "SILENCIOSO" },
      { capa: "GLOBAL_SOLICITUDES", ventana: "HORA", tope: 100, alPasar: "VISIBLE" },
      { capa: "GLOBAL_VERIFICACIONES", ventana: "DIA", tope: 40, alPasar: "VISIBLE" },
    ]);
  });

  it("el tope global de verificaciones lo da la configuración (depende del plan de Resend)", () => {
    const una = reglasDeLimite({ topeGlobalDeVerificacionesPorDia: 1 });
    expect(una[5]).toEqual({
      capa: "GLOBAL_VERIFICACIONES",
      ventana: "DIA",
      tope: 1,
      alPasar: "VISIBLE",
    });
    expect(reglasDeLimite({ topeGlobalDeVerificacionesPorDia: 2500 })[5]?.tope).toBe(2500);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    "un tope global inválido (%s) no se acepta: no hay valor por defecto honesto",
    (tope) => {
      expect(() => reglasDeLimite({ topeGlobalDeVerificacionesPorDia: tope })).toThrow(
        new RangeError("el tope global de verificaciones por día debe ser un entero positivo"),
      );
    },
  );

  it("las ventanas duran una hora, un día y siete días; los contadores se purgan a los 8 días", () => {
    expect(DURACION_DE_VENTANA_EN_MS).toEqual({
      HORA: 3_600_000,
      DIA: 86_400_000,
      SEMANA: 604_800_000,
    });
    expect(RETENCION_DE_CONTADORES_EN_MS).toBe(8 * 86_400_000);
    expect(RETENCION_DE_CONTADORES_EN_MS).toBe(691_200_000);
  });
});

describe("inicioDeVentana (UTC)", () => {
  const iso = (ventana: ReglaDeLimite["ventana"], fecha: string) =>
    inicioDeVentana(ventana, new Date(fecha)).toISOString();

  it("hora: la hora en punto", () => {
    expect(iso("HORA", "2026-10-13T12:34:56.789Z")).toBe("2026-10-13T12:00:00.000Z");
    expect(iso("HORA", "2026-10-13T12:00:00.000Z")).toBe("2026-10-13T12:00:00.000Z");
    expect(iso("HORA", "2026-10-13T11:59:59.999Z")).toBe("2026-10-13T11:00:00.000Z");
  });

  it("día: la medianoche UTC", () => {
    expect(iso("DIA", "2026-10-13T23:59:59.999Z")).toBe("2026-10-13T00:00:00.000Z");
    expect(iso("DIA", "2026-10-13T00:00:00.000Z")).toBe("2026-10-13T00:00:00.000Z");
    expect(iso("DIA", "2026-10-12T23:59:59.999Z")).toBe("2026-10-12T00:00:00.000Z");
  });

  it("semana: el lunes a las 00:00 (ISO), todos los días de la semana", () => {
    // 2026-10-12 es lunes.
    const dias = ["12", "13", "14", "15", "16", "17", "18"];
    for (const dia of dias) {
      expect(iso("SEMANA", `2026-10-${dia}T15:30:00.000Z`), dia).toBe("2026-10-12T00:00:00.000Z");
    }
    expect(iso("SEMANA", "2026-10-12T00:00:00.000Z")).toBe("2026-10-12T00:00:00.000Z");
    expect(iso("SEMANA", "2026-10-11T23:59:59.999Z")).toBe("2026-10-05T00:00:00.000Z");
    expect(iso("SEMANA", "2026-10-19T00:00:00.000Z")).toBe("2026-10-19T00:00:00.000Z");
  });

  it("antes de 1970 también alinea (el piso, no el truncado hacia cero)", () => {
    expect(iso("HORA", "1969-12-31T23:30:00.000Z")).toBe("1969-12-31T23:00:00.000Z");
    expect(iso("DIA", "1969-12-31T23:30:00.000Z")).toBe("1969-12-31T00:00:00.000Z");
    // 1969-12-29 fue lunes.
    expect(iso("SEMANA", "1969-12-31T23:30:00.000Z")).toBe("1969-12-29T00:00:00.000Z");
    expect(iso("SEMANA", "1970-01-05T00:00:00.000Z")).toBe("1970-01-05T00:00:00.000Z");
    expect(iso("SEMANA", "1970-01-04T23:59:59.999Z")).toBe("1969-12-29T00:00:00.000Z");
  });
});

describe("claveDeContador", () => {
  it("IP y correo llevan el HMAC; las globales no", () => {
    expect(claveDeContador("IP", HUELLA)).toBe(`ip:${HUELLA}`);
    expect(claveDeContador("CORREO", HUELLA)).toBe(`correo:${HUELLA}`);
    expect(claveDeContador("GLOBAL_SOLICITUDES")).toBe("global:solicitudes");
    expect(claveDeContador("GLOBAL_VERIFICACIONES")).toBe("global:verificaciones");
  });

  it("las globales ignoran una huella que les pasen", () => {
    expect(claveDeContador("GLOBAL_SOLICITUDES", HUELLA)).toBe("global:solicitudes");
    expect(claveDeContador("GLOBAL_VERIFICACIONES", "x")).toBe("global:verificaciones");
  });

  it("sin huella válida (64 dígitos hexadecimales en minúscula) no hay clave: nunca la IP ni el correo en claro", () => {
    const mal = [
      undefined,
      "",
      "203.0.113.7",
      "ana@x.com",
      HUELLA.slice(1),
      `${HUELLA}0`,
      HUELLA.toUpperCase(),
      `g${HUELLA.slice(1)}`,
      ` ${HUELLA}`,
      `${HUELLA}\n`,
    ];
    for (const huella of mal) {
      for (const capa of ["IP", "CORREO"] as const) {
        expect(() => claveDeContador(capa, huella), `${capa} ${String(huella)}`).toThrow(
          new RangeError("la huella debe ser un HMAC en hexadecimal minúsculo de 64 dígitos"),
        );
      }
    }
  });
});

describe("decidirLimite", () => {
  it("sin observaciones, o con todas dentro del tope, pasa", () => {
    expect(decidirLimite([])).toEqual({ tipo: "PERMITIDO" });
    expect(decidirLimite([obs("IP", "HORA", 1), obs("CORREO", "DIA", 1)])).toEqual({
      tipo: "PERMITIDO",
    });
  });

  it("con tope N pasan los intentos 1..N y el N + 1 ya es de más (en cada regla)", () => {
    for (const r of reglas) {
      expect(decidirLimite([{ regla: r, cuenta: 1 }]), `${r.capa} ${r.ventana} 1`).toEqual({
        tipo: "PERMITIDO",
      });
      expect(decidirLimite([{ regla: r, cuenta: r.tope }]), `${r.capa} ${r.ventana} N`).toEqual({
        tipo: "PERMITIDO",
      });
      expect(
        decidirLimite([{ regla: r, cuenta: r.tope + 1 }]),
        `${r.capa} ${r.ventana} N+1`,
      ).toEqual({
        tipo: "EXCEDIDO",
        capa: r.capa,
        visible: r.alPasar === "VISIBLE",
      });
    }
  });

  it("pasarse por IP, global de solicitudes o global de verificaciones es visible; por correo, silencioso", () => {
    expect(decidirLimite([obs("IP", "HORA", 11)])).toEqual({
      tipo: "EXCEDIDO",
      capa: "IP",
      visible: true,
    });
    expect(decidirLimite([obs("GLOBAL_SOLICITUDES", "HORA", 101)])).toEqual({
      tipo: "EXCEDIDO",
      capa: "GLOBAL_SOLICITUDES",
      visible: true,
    });
    expect(decidirLimite([obs("GLOBAL_VERIFICACIONES", "DIA", 41)])).toEqual({
      tipo: "EXCEDIDO",
      capa: "GLOBAL_VERIFICACIONES",
      visible: true,
    });
    expect(decidirLimite([obs("CORREO", "SEMANA", 11)])).toEqual({
      tipo: "EXCEDIDO",
      capa: "CORREO",
      visible: false,
    });
  });

  it("si se pasan una silenciosa y una visible, gana la visible aunque venga después", () => {
    expect(decidirLimite([obs("CORREO", "DIA", 6), obs("IP", "DIA", 31)])).toEqual({
      tipo: "EXCEDIDO",
      capa: "IP",
      visible: true,
    });
  });

  it("si se pasan varias del mismo tipo, gana la primera", () => {
    expect(decidirLimite([obs("IP", "DIA", 31), obs("IP", "HORA", 11)])).toEqual({
      tipo: "EXCEDIDO",
      capa: "IP",
      visible: true,
    });
    expect(decidirLimite([obs("CORREO", "SEMANA", 11), obs("CORREO", "DIA", 6)])).toEqual({
      tipo: "EXCEDIDO",
      capa: "CORREO",
      visible: false,
    });
    expect(decidirLimite([obs("GLOBAL_SOLICITUDES", "HORA", 101), obs("IP", "HORA", 11)])).toEqual({
      tipo: "EXCEDIDO",
      capa: "GLOBAL_SOLICITUDES",
      visible: true,
    });
  });

  it("las que no se pasaron no cuentan, vengan antes o después", () => {
    expect(
      decidirLimite([obs("IP", "HORA", 10), obs("CORREO", "DIA", 6), obs("IP", "DIA", 30)]),
    ).toEqual({ tipo: "EXCEDIDO", capa: "CORREO", visible: false });
  });
});
