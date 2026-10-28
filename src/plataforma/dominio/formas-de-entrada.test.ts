import { describe, expect, it } from "vitest";
import {
  LARGO_MAXIMO_DEL_MOTIVO,
  validarLargoDelMotivo,
  validarNumeroEsperado,
  validarVersionEsperada,
  validarVersionVista,
  validarVigencia,
} from "./formas-de-entrada";

const MAXIMO = 2_147_483_647;

describe("validarNumeroEsperado", () => {
  it("acepta null (no había decisión) y todo entero de 1 al máximo de la base", () => {
    expect(validarNumeroEsperado(null)).toEqual({ ok: true, valor: null });
    for (const n of [1, 2, 41, MAXIMO]) {
      expect(validarNumeroEsperado(n), String(n)).toEqual({ ok: true, valor: n });
    }
  });

  it.each([0, -1, 1.5, MAXIMO + 1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rechaza %s",
    (n) => {
      expect(validarNumeroEsperado(n)).toEqual({ ok: false, error: "NUMERO_ESPERADO_INVALIDO" });
    },
  );
});

describe("validarVersionEsperada", () => {
  it("acepta null (no había borrador) y todo entero de 1 al máximo de la base", () => {
    expect(validarVersionEsperada(null)).toEqual({ ok: true, valor: null });
    for (const n of [1, 2, 41, MAXIMO]) {
      expect(validarVersionEsperada(n), String(n)).toEqual({ ok: true, valor: n });
    }
  });

  it.each([0, -1, 1.5, MAXIMO + 1, Number.NaN, Number.POSITIVE_INFINITY])("rechaza %s", (n) => {
    expect(validarVersionEsperada(n)).toEqual({ ok: false, error: "VERSION_ESPERADA_INVALIDA" });
  });
});

describe("validarVersionVista", () => {
  it("acepta todo entero de 1 al máximo de la base", () => {
    for (const n of [1, 2, 41, MAXIMO]) {
      expect(validarVersionVista(n), String(n)).toEqual({ ok: true, valor: n });
    }
  });

  // A diferencia de `validarVersionEsperada`, `null` no vale: confirmar exige un borrador que se haya visto.
  it.each([0, -1, 1.5, MAXIMO + 1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, "1"])(
    "rechaza %s",
    (n) => {
      expect(validarVersionVista(n as unknown as number)).toEqual({
        ok: false,
        error: "VERSION_ESPERADA_INVALIDA",
      });
    },
  );
});

describe("validarVigencia", () => {
  it("acepta una fecha de verdad y la devuelve tal cual", () => {
    const fecha = new Date("2026-10-11T12:00:00Z");
    const r = validarVigencia(fecha);
    expect(r).toEqual({ ok: true, valor: fecha });
    expect(r.ok && r.valor).toBe(fecha);
  });

  it("rechaza una fecha inválida y lo que no es una fecha, sin lanzar", () => {
    const rechazo = { ok: false, error: "VIGENCIA_INVALIDA" };
    expect(validarVigencia(new Date(Number.NaN))).toEqual(rechazo);
    expect(validarVigencia(new Date("no es una fecha"))).toEqual(rechazo);
    expect(validarVigencia("2026-10-11" as unknown as Date)).toEqual(rechazo);
    expect(validarVigencia(null as unknown as Date)).toEqual(rechazo);
    expect(validarVigencia(1_760_000_000_000 as unknown as Date)).toEqual(rechazo);
  });
});

describe("validarLargoDelMotivo", () => {
  it("el tope es de 500 caracteres", () => {
    expect(LARGO_MAXIMO_DEL_MOTIVO).toBe(500);
  });

  it("acepta hasta 500 caracteres y lo devuelve tal cual", () => {
    expect(validarLargoDelMotivo("cambio de plan")).toEqual({ ok: true, valor: "cambio de plan" });
    const justo = "m".repeat(500);
    expect(validarLargoDelMotivo(justo)).toEqual({ ok: true, valor: justo });
    expect(validarLargoDelMotivo("")).toEqual({ ok: true, valor: "" });
  });

  it("rechaza 501 caracteres", () => {
    expect(validarLargoDelMotivo("m".repeat(501))).toEqual({
      ok: false,
      error: "MOTIVO_DEMASIADO_LARGO",
    });
  });

  it("los espacios de los costados no cuentan: se mide el motivo recortado", () => {
    const conEspacios = `  ${"m".repeat(500)}  `;
    expect(validarLargoDelMotivo(conEspacios)).toEqual({ ok: true, valor: conEspacios });
    expect(validarLargoDelMotivo(`  ${"m".repeat(501)}  `).ok).toBe(false);
  });
});
