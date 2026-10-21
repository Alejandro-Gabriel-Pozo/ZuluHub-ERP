import { describe, expect, it } from "vitest";
import {
  entradaDeLaConfirmacion,
  entradaDelBorrador,
} from "../../apps/plataforma/logica/entrada-de-submarca";

const UUID_V4 = "3f2b8c1e-5d4a-4b7e-9c1a-2e6f8a0b1c3d";
const UUID_V7 = "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a";

const ASPECTO = {
  estilo: "MODERNO",
  superficie: "CALIDA",
  esquinas: "SUAVE",
  titulos: "SERIF",
  ingreso: "CENTRADO",
};
const TEMA = {
  primary: "#112233",
  "on-primary": "#ffffff",
  secondary: "#445566",
  accent: "#aa00bb",
};

const BORRADOR = {
  claveDeIdempotencia: UUID_V4,
  marcaId: UUID_V7,
  versionEsperada: 3,
  cambios: { nombreVisible: "Pedernal Sur", tema: TEMA, aspecto: ASPECTO },
};

describe("entradaDelBorrador: la forma de lo que manda el navegador", () => {
  it("acepta la forma buena", () => {
    expect(entradaDelBorrador(BORRADOR)).toEqual({ ok: true, valor: BORRADOR });
  });

  it("acepta versionEsperada null y 0, y cambios vacíos", () => {
    for (const versionEsperada of [null, 0]) {
      const r = entradaDelBorrador({ ...BORRADOR, versionEsperada, cambios: {} });
      expect(r).toEqual({ ok: true, valor: { ...BORRADOR, versionEsperada, cambios: {} } });
    }
  });

  it.each([null, undefined, [], [BORRADOR], "texto", 7, true])("rechaza %j", (entrada) => {
    expect(entradaDelBorrador(entrada)).toEqual({ ok: false });
  });

  it.each(["claveDeIdempotencia", "marcaId"])("rechaza %s que no es UUID", (campo) => {
    for (const malo of ["no-soy-uuid", "", `${UUID_V4}x`, UUID_V4.replaceAll("-", ""), 5, null]) {
      expect(entradaDelBorrador({ ...BORRADOR, [campo]: malo })).toEqual({ ok: false });
    }
  });

  it.each([-1, 1.5, "3", NaN, Infinity, undefined, {}])("rechaza versionEsperada %j", (v) => {
    expect(entradaDelBorrador({ ...BORRADOR, versionEsperada: v })).toEqual({ ok: false });
  });

  it("descarta las claves de más sin copiarlas", () => {
    const r = entradaDelBorrador({
      ...BORRADOR,
      extra: "x",
      cambios: {
        nombreVisible: "A",
        logo: "/marcas/x.png",
        tema: { ...TEMA, rojo: "#ff0000", __proto__: { x: 1 } },
        aspecto: { ...ASPECTO, fuente: "Comic" },
      },
    });
    expect(r).toEqual({
      ok: true,
      valor: {
        ...BORRADOR,
        cambios: { nombreVisible: "A", tema: TEMA, aspecto: ASPECTO },
      },
    });
  });

  it("acepta un tema parcial y descarta la clave rara", () => {
    const r = entradaDelBorrador({
      ...BORRADOR,
      cambios: { tema: { primary: "#000000", raro: "x" } },
    });
    expect(r).toEqual({
      ok: true,
      valor: { ...BORRADOR, cambios: { tema: { primary: "#000000" } } },
    });
  });

  it("rechaza nombreVisible vacío, largo o no texto", () => {
    for (const malo of ["", "a".repeat(201), 5, null]) {
      expect(entradaDelBorrador({ ...BORRADOR, cambios: { nombreVisible: malo } })).toEqual({
        ok: false,
      });
    }
    const maximo = "a".repeat(200);
    expect(entradaDelBorrador({ ...BORRADOR, cambios: { nombreVisible: maximo } }).ok).toBe(true);
  });

  it("rechaza un tema con valores que no son texto o de más de 20 caracteres, o que no es objeto", () => {
    for (const malo of [{ primary: 5 }, { primary: "#".padEnd(21, "a") }, [], null, "x"]) {
      expect(entradaDelBorrador({ ...BORRADOR, cambios: { tema: malo } })).toEqual({ ok: false });
    }
  });

  it("exige el aspecto completo con valores cortos", () => {
    const incompleto: Record<string, string> = { ...ASPECTO };
    delete incompleto["ingreso"];
    for (const malo of [
      incompleto,
      { ...ASPECTO, estilo: 3 },
      { ...ASPECTO, estilo: "x".repeat(41) },
      null,
      [],
    ]) {
      expect(entradaDelBorrador({ ...BORRADOR, cambios: { aspecto: malo } })).toEqual({
        ok: false,
      });
    }
  });

  it("rechaza cambios que no es objeto", () => {
    for (const malo of [null, [], "x", 5, undefined]) {
      expect(entradaDelBorrador({ ...BORRADOR, cambios: malo })).toEqual({ ok: false });
    }
  });
});

const CONFIRMACION = {
  claveDeIdempotencia: UUID_V4,
  marcaId: UUID_V7,
  vigenteDesde: "2026-11-02",
  motivo: "Nueva identidad",
  reemplazaProgramada: false,
};

describe("entradaDeLaConfirmacion: la forma de lo que manda el navegador", () => {
  it("acepta la forma buena y descarta lo que sobra", () => {
    expect(entradaDeLaConfirmacion({ ...CONFIRMACION, extra: 1 })).toEqual({
      ok: true,
      valor: CONFIRMACION,
    });
  });

  it("recorta el motivo", () => {
    const r = entradaDeLaConfirmacion({ ...CONFIRMACION, motivo: "  hola  " });
    expect(r).toEqual({ ok: true, valor: { ...CONFIRMACION, motivo: "hola" } });
  });

  it.each([null, undefined, [], "x", 3])("rechaza %j", (entrada) => {
    expect(entradaDeLaConfirmacion(entrada)).toEqual({ ok: false });
  });

  it.each(["claveDeIdempotencia", "marcaId"])("rechaza %s que no es UUID", (campo) => {
    expect(entradaDeLaConfirmacion({ ...CONFIRMACION, [campo]: "nada" })).toEqual({ ok: false });
  });

  it.each(["2026-1-02", "02/11/2026", "2026-11-02T00:00", "", 20261102, null, "2026-11-02 "])(
    "rechaza la fecha %j",
    (fecha) => {
      expect(entradaDeLaConfirmacion({ ...CONFIRMACION, vigenteDesde: fecha })).toEqual({
        ok: false,
      });
    },
  );

  it.each(["", "   ", "\n\t", 5, null, "a".repeat(2001)])("rechaza el motivo %j", (motivo) => {
    expect(entradaDeLaConfirmacion({ ...CONFIRMACION, motivo })).toEqual({ ok: false });
  });

  it("acepta un motivo de 2000 caracteres", () => {
    expect(entradaDeLaConfirmacion({ ...CONFIRMACION, motivo: "a".repeat(2000) }).ok).toBe(true);
  });

  it.each(["true", 1, 0, null, undefined])("rechaza reemplazaProgramada %j", (v) => {
    expect(entradaDeLaConfirmacion({ ...CONFIRMACION, reemplazaProgramada: v })).toEqual({
      ok: false,
    });
  });
});
