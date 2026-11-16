import { describe, expect, it } from "vitest";
import {
  entradaDeAgregarValor,
  entradaDeCambiarEstado,
  entradaDeCorregirNombre,
} from "../../apps/plataforma/logica/entrada-de-lista";

const CLAVE = "3f2b8c1e-5d4a-4b7e-9c1a-2e6f8a0b1c3d";
const VALOR = "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a";

describe("entradaDeAgregarValor", () => {
  it("toma la clave, la lista (ya resuelta a la del dominio) y el nombre tal cual; lo demás se descarta", () => {
    const r = entradaDeAgregarValor({
      claveDeIdempotencia: CLAVE,
      lista: "marcas",
      nombre: " Tarjeta Sol ",
      empresaId: "no entra",
    });
    expect(r).toEqual({
      ok: true,
      valor: {
        claveDeIdempotencia: CLAVE,
        lista: { nombre: "marcas", lista: "MARCAS_DE_TARJETA", titulo: "Marcas de tarjeta" },
        nombre: " Tarjeta Sol ",
      },
    });
  });

  it.each([
    ["MARCAS_DE_TARJETA"],
    ["motivos"],
    ["constructor"],
    ["__proto__"],
    [""],
    [null],
    [undefined],
    [7],
  ])("una lista %j que no está en la tabla de la consola se rechaza", (lista) => {
    expect(entradaDeAgregarValor({ claveDeIdempotencia: CLAVE, lista, nombre: "X" })).toEqual({
      ok: false,
    });
  });

  it.each([null, undefined, 5, "x", [], [CLAVE]])("una entrada %j sin forma se rechaza", (x) => {
    expect(entradaDeAgregarValor(x)).toEqual({ ok: false });
  });

  it.each(["", "no-es-uuid", 5, null, undefined])("una clave %j inválida se rechaza", (clave) => {
    expect(
      entradaDeAgregarValor({ claveDeIdempotencia: clave, lista: "marcas", nombre: "X" }),
    ).toEqual({ ok: false });
  });

  it.each([null, undefined, 5, {}, ["X"]])("un nombre %j que no es texto se rechaza", (nombre) => {
    expect(entradaDeAgregarValor({ claveDeIdempotencia: CLAVE, lista: "marcas", nombre })).toEqual({
      ok: false,
    });
  });

  it("un nombre vacío tiene forma de texto: lo rechaza el dominio, no esta capa", () => {
    expect(
      entradaDeAgregarValor({ claveDeIdempotencia: CLAVE, lista: "marcas", nombre: "" }).ok,
    ).toBe(true);
  });
});

describe("entradaDeCorregirNombre", () => {
  const buena = { claveDeIdempotencia: CLAVE, valorId: VALOR, nombre: "Cabal", versionEsperada: 3 };

  it("toma solo las cuatro claves", () => {
    expect(entradaDeCorregirNombre({ ...buena, sobra: 1 })).toEqual({ ok: true, valor: buena });
  });

  it.each([0, -1, 1.5, "3", null, undefined, Number.NaN, Infinity, 2 ** 60])(
    "una versión %j que no es un entero de 1 en adelante se rechaza",
    (versionEsperada) => {
      expect(entradaDeCorregirNombre({ ...buena, versionEsperada })).toEqual({ ok: false });
    },
  );

  it.each([["valorId"], ["claveDeIdempotencia"]])("un %s inválido se rechaza", (campo) => {
    expect(entradaDeCorregirNombre({ ...buena, [campo]: "x" })).toEqual({ ok: false });
  });

  it("un nombre que no es texto o una entrada sin forma se rechaza", () => {
    expect(entradaDeCorregirNombre({ ...buena, nombre: 1 })).toEqual({ ok: false });
    expect(entradaDeCorregirNombre(null)).toEqual({ ok: false });
    expect(entradaDeCorregirNombre([buena])).toEqual({ ok: false });
  });
});

describe("entradaDeCambiarEstado", () => {
  const buena = { claveDeIdempotencia: CLAVE, valorId: VALOR, versionEsperada: 1 };

  it("toma solo las tres claves", () => {
    expect(entradaDeCambiarEstado({ ...buena, nombre: "no entra" })).toEqual({
      ok: true,
      valor: buena,
    });
  });

  it("rechaza la versión inválida, los ids inválidos y lo que no tiene forma", () => {
    expect(entradaDeCambiarEstado({ ...buena, versionEsperada: 0 })).toEqual({ ok: false });
    expect(entradaDeCambiarEstado({ ...buena, valorId: "x" })).toEqual({ ok: false });
    expect(entradaDeCambiarEstado({ ...buena, claveDeIdempotencia: 3 })).toEqual({ ok: false });
    expect(entradaDeCambiarEstado("texto")).toEqual({ ok: false });
    expect(entradaDeCambiarEstado(undefined)).toEqual({ ok: false });
  });
});
