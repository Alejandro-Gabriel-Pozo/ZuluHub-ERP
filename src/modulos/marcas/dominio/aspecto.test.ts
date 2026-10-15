import { describe, expect, it } from "vitest";
import {
  ASPECTO_POR_DEFECTO,
  ESQUINAS_DE_ASPECTO,
  ESTILOS_DE_ASPECTO,
  INGRESOS_DE_ASPECTO,
  LISTAS_DE_ASPECTO,
  SUPERFICIES_DE_ASPECTO,
  TITULOS_DE_ASPECTO,
  TOKENS_DE_ASPECTO,
  completarAspecto,
  esTokenDeAspecto,
  validarAspecto,
  type TokenDeAspecto,
} from "./aspecto";

describe("las listas cerradas del aspecto", () => {
  it("son exactamente estas, con estos valores y en este orden", () => {
    expect(ESTILOS_DE_ASPECTO).toEqual(["CLARO_CON_BORDES", "MODERNO", "CLASICO", "LUDICO"]);
    expect(SUPERFICIES_DE_ASPECTO).toEqual(["NEUTRA", "CALIDA", "FRIA"]);
    expect(ESQUINAS_DE_ASPECTO).toEqual(["RECTA", "SUAVE", "REDONDEADA"]);
    expect(TITULOS_DE_ASPECTO).toEqual(["SANS", "SERIF"]);
    expect(INGRESOS_DE_ASPECTO).toEqual(["DIVIDIDO", "CENTRADO", "CON_IMAGEN"]);
  });

  it("los tokens son cinco, en ese orden, y cada uno tiene su lista", () => {
    expect(TOKENS_DE_ASPECTO).toEqual(["estilo", "superficie", "esquinas", "titulos", "ingreso"]);
    expect(Object.keys(LISTAS_DE_ASPECTO)).toEqual([...TOKENS_DE_ASPECTO]);
    expect(LISTAS_DE_ASPECTO.estilo).toBe(ESTILOS_DE_ASPECTO);
    expect(LISTAS_DE_ASPECTO.superficie).toBe(SUPERFICIES_DE_ASPECTO);
    expect(LISTAS_DE_ASPECTO.esquinas).toBe(ESQUINAS_DE_ASPECTO);
    expect(LISTAS_DE_ASPECTO.titulos).toBe(TITULOS_DE_ASPECTO);
    expect(LISTAS_DE_ASPECTO.ingreso).toBe(INGRESOS_DE_ASPECTO);
  });

  it("todo valor está en MAYÚSCULAS con guion bajo", () => {
    for (const token of TOKENS_DE_ASPECTO) {
      for (const valor of LISTAS_DE_ASPECTO[token]) expect(valor).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
    }
  });

  it("los defectos son estos y cada uno está en la lista de su token", () => {
    expect(ASPECTO_POR_DEFECTO).toEqual({
      estilo: "CLARO_CON_BORDES",
      superficie: "NEUTRA",
      esquinas: "SUAVE",
      titulos: "SANS",
      ingreso: "CENTRADO",
    });
    expect(Object.keys(ASPECTO_POR_DEFECTO)).toEqual([...TOKENS_DE_ASPECTO]);
    for (const token of TOKENS_DE_ASPECTO) {
      expect(
        (LISTAS_DE_ASPECTO[token] as readonly string[]).includes(ASPECTO_POR_DEFECTO[token]),
      ).toBe(true);
    }
  });

  it("esTokenDeAspecto acepta los cinco tokens y nada más", () => {
    for (const token of TOKENS_DE_ASPECTO) expect(esTokenDeAspecto(token)).toBe(true);
    for (const otro of [
      "primary",
      "Estilo",
      "ESTILO",
      "estilos",
      "estilo ",
      "",
      "constructor",
      "__proto__",
      "toString",
      "length",
    ]) {
      expect(esTokenDeAspecto(otro), otro).toBe(false);
    }
  });
});

describe("validarAspecto", () => {
  it("acepta un aspecto vacío (todo se hereda o toma el defecto), uno parcial y uno completo", () => {
    expect(validarAspecto({})).toStrictEqual({ ok: true, valor: {} });
    expect(validarAspecto({ esquinas: "RECTA" })).toStrictEqual({
      ok: true,
      valor: { esquinas: "RECTA" },
    });
    const completo = {
      estilo: "LUDICO",
      superficie: "FRIA",
      esquinas: "REDONDEADA",
      titulos: "SERIF",
      ingreso: "CON_IMAGEN",
    };
    expect(validarAspecto(completo)).toStrictEqual({ ok: true, valor: completo });
  });

  it("acepta cada valor de cada lista, solo o junto a los demás", () => {
    for (const token of TOKENS_DE_ASPECTO) {
      for (const valor of LISTAS_DE_ASPECTO[token]) {
        expect(validarAspecto({ [token]: valor }), `${token}=${valor}`).toStrictEqual({
          ok: true,
          valor: { [token]: valor },
        });
      }
    }
  });

  it("devuelve los tokens en el orden de la lista, sea cual sea el de entrada, y sin claves de más", () => {
    const r = validarAspecto({ ingreso: "DIVIDIDO", estilo: "MODERNO", titulos: "SANS" });
    expect(r.ok && Object.keys(r.valor)).toEqual(["estilo", "titulos", "ingreso"]);
    const vacio = validarAspecto({ estilo: "MODERNO" });
    expect(vacio.ok && Object.keys(vacio.valor)).toEqual(["estilo"]);
  });

  it("no modifica lo que recibe ni devuelve el mismo objeto", () => {
    const entrada = { ingreso: "DIVIDIDO", estilo: "MODERNO" };
    const r = validarAspecto(entrada);
    expect(entrada).toEqual({ ingreso: "DIVIDIDO", estilo: "MODERNO" });
    expect(Object.keys(entrada)).toEqual(["ingreso", "estilo"]);
    expect(r.ok && r.valor).not.toBe(entrada);
  });

  it.each([
    ["en minúsculas", "moderno"],
    ["con mayúscula inicial", "Moderno"],
    ["con guion medio", "CLARO-CON-BORDES"],
    ["con espacio", "CLARO CON BORDES"],
    ["con espacio al final", "MODERNO "],
    ["con salto de línea al final", "MODERNO\n"],
    ["un valor de otra lista", "NEUTRA"],
    ["un prefijo", "MODER"],
    ["con algo de más", "MODERNOS"],
    ["vacío", ""],
    ["CSS", "red; background: url(x)"],
  ])("rechaza el valor %s en `estilo`", (_nombre, valor) => {
    expect(validarAspecto({ estilo: valor })).toStrictEqual({
      ok: false,
      error: { codigo: "ASPECTO_INVALIDO", token: "estilo" },
    });
  });

  it("rechaza, en cada token, un valor de la lista de OTRO token", () => {
    for (const token of TOKENS_DE_ASPECTO) {
      for (const otro of TOKENS_DE_ASPECTO) {
        if (otro === token) continue;
        // Un valor que solo existe en la otra lista (los de las listas no se repiten entre tokens).
        const ajenos = LISTAS_DE_ASPECTO[otro].filter(
          (v) => !(LISTAS_DE_ASPECTO[token] as readonly string[]).includes(v),
        );
        for (const valor of ajenos) {
          expect(validarAspecto({ [token]: valor }), `${token}=${valor}`).toStrictEqual({
            ok: false,
            error: { codigo: "ASPECTO_INVALIDO", token },
          });
        }
      }
    }
  });

  it("rechaza un valor que no es texto", () => {
    for (const valor of [1, 0, null, undefined, true, ["MODERNO"], { a: "MODERNO" }]) {
      expect(validarAspecto({ estilo: valor })).toStrictEqual({
        ok: false,
        error: { codigo: "ASPECTO_INVALIDO", token: "estilo" },
      });
    }
  });

  it("rechaza una clave fuera de la lista cerrada y la informa tal cual llegó", () => {
    for (const token of ["fondo", "Estilo", "primary", "constructor", "estilo "]) {
      expect(validarAspecto({ [token]: "MODERNO" }), token).toStrictEqual({
        ok: false,
        error: { codigo: "ASPECTO_INVALIDO", token },
      });
    }
  });

  it("la clave `__proto__` no pasa por la lista cerrada", () => {
    const entrada = JSON.parse('{"__proto__": {"estilo": "MODERNO"}}') as Record<string, unknown>;
    expect(validarAspecto(entrada)).toStrictEqual({
      ok: false,
      error: { codigo: "ASPECTO_INVALIDO", token: "__proto__" },
    });
  });

  it("el primer problema se informa con la clave que lo trae, en el orden de la entrada", () => {
    expect(
      validarAspecto({ estilo: "MODERNO", titulos: "GRANDE", esquinas: "OVAL" }),
    ).toStrictEqual({
      ok: false,
      error: { codigo: "ASPECTO_INVALIDO", token: "titulos" },
    });
    expect(validarAspecto({ fondo: "x", estilo: "nada" })).toStrictEqual({
      ok: false,
      error: { codigo: "ASPECTO_INVALIDO", token: "fondo" },
    });
    expect(validarAspecto({ ingreso: "CENTRADO", fondo: "x" })).toStrictEqual({
      ok: false,
      error: { codigo: "ASPECTO_INVALIDO", token: "fondo" },
    });
  });

  it("un token válido junto a uno inválido no se acepta a medias", () => {
    expect(validarAspecto({ estilo: "MODERNO", superficie: "verde" }).ok).toBe(false);
  });
});

describe("completarAspecto", () => {
  it("sin nada definido son los defectos, en un objeto nuevo cada vez", () => {
    const a = completarAspecto({});
    expect(a).toStrictEqual(ASPECTO_POR_DEFECTO);
    expect(a).not.toBe(ASPECTO_POR_DEFECTO);
    expect(completarAspecto({})).not.toBe(a);
  });

  it("lo definido gana al defecto, token por token, y lo demás toma el defecto", () => {
    expect(completarAspecto({ estilo: "CLASICO", esquinas: "RECTA" })).toStrictEqual({
      estilo: "CLASICO",
      superficie: "NEUTRA",
      esquinas: "RECTA",
      titulos: "SANS",
      ingreso: "CENTRADO",
    });
    for (const token of TOKENS_DE_ASPECTO as readonly TokenDeAspecto[]) {
      for (const valor of LISTAS_DE_ASPECTO[token]) {
        const a = completarAspecto({ [token]: valor });
        expect(a[token], `${token}=${valor}`).toBe(valor);
        for (const otro of TOKENS_DE_ASPECTO) {
          if (otro !== token) expect(a[otro]).toBe(ASPECTO_POR_DEFECTO[otro]);
        }
      }
    }
  });

  it("un aspecto completo queda igual y las claves salen en el orden de la lista", () => {
    const completo = {
      estilo: "LUDICO",
      superficie: "CALIDA",
      esquinas: "REDONDEADA",
      titulos: "SERIF",
      ingreso: "DIVIDIDO",
    } as const;
    const a = completarAspecto(completo);
    expect(a).toStrictEqual(completo);
    expect(a).not.toBe(completo);
    expect(Object.keys(completarAspecto({ ingreso: "DIVIDIDO" }))).toEqual([...TOKENS_DE_ASPECTO]);
  });

  it("no modifica lo que recibe ni los defectos", () => {
    const parcial = { estilo: "MODERNO" } as const;
    completarAspecto(parcial);
    expect(parcial).toEqual({ estilo: "MODERNO" });
    const copia = { ...ASPECTO_POR_DEFECTO };
    completarAspecto({ estilo: "LUDICO" });
    expect(ASPECTO_POR_DEFECTO).toEqual(copia);
  });
});
