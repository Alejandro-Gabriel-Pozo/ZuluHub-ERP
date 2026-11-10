import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  descripcionDeCartaDesdeTexto,
  LARGO_MAXIMO_DE_LA_DESCRIPCION_EN_CARTA,
} from "./descripcion-de-carta";
import {
  codigoDeBarrasDesdeTexto,
  codigoDeProductoDesdeTexto,
  LARGO_MAXIMO_DEL_CODIGO_DE_PRODUCTO,
} from "./codigo-de-producto";
import { LARGO_MAXIMO_DEL_NOMBRE_DE_COCINA, nombreDeCocinaDesdeTexto } from "./nombre-de-cocina";
import {
  LARGO_MAXIMO_DEL_NOMBRE_DE_ELECCION,
  nombreDeEleccionDesdeTexto,
} from "./nombre-de-eleccion";
import {
  claveDeNombre,
  LARGO_MAXIMO_DEL_NOMBRE_DE_PRODUCTO,
  nombreDeProductoDesdeTexto,
} from "./nombre-de-producto";

describe("nombre de producto", () => {
  it("acepta letras, dígitos y signos permitidos; recorta y colapsa espacios", () => {
    expect(nombreDeProductoDesdeTexto("  Café   con leche ")).toEqual({
      ok: true,
      valor: "Café con leche",
    });
    expect(nombreDeProductoDesdeTexto("Coca-Cola 500 ml")).toMatchObject({ ok: true });
  });
  it("rechaza vacío, sin letras, largo de más, caracteres fuera de la lista y empezar con signo", () => {
    expect(nombreDeProductoDesdeTexto("  ")).toEqual({ ok: false, error: "VACIO" });
    expect(nombreDeProductoDesdeTexto("123")).toEqual({ ok: false, error: "SIN_LETRAS" });
    expect(nombreDeProductoDesdeTexto("a".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_PRODUCTO + 1))).toEqual(
      { ok: false, error: "DEMASIADO_LARGO" },
    );
    expect(
      nombreDeProductoDesdeTexto("a".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_PRODUCTO)),
    ).toMatchObject({ ok: true });
    for (const malo of ["<b>x</b>", "pizza 😀", "con\nsalto", "=suma", "+Kota"]) {
      expect(nombreDeProductoDesdeTexto(malo).ok, malo).toBe(false);
    }
  });
  it("D7: `Café` y `CAFÉ` colisionan en la clave, también con la tilde descompuesta", () => {
    expect(claveDeNombre("Café")).toBe(claveDeNombre("CAFÉ"));
    expect(claveDeNombre("Café")).toBe(claveDeNombre("CAFÉ"));
    expect(claveDeNombre("Café")).not.toBe(claveDeNombre("Cafe"));
    expect(claveDeNombre("CAFÉ")).toBe("café");
  });
  it("D7 (propiedad): la clave no cambia al mayusculizar ni al re-normalizar", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), (texto) => {
        expect(claveDeNombre(texto.toUpperCase())).toBe(
          claveDeNombre(texto.toUpperCase().toLowerCase()),
        );
        expect(claveDeNombre(claveDeNombre(texto))).toBe(claveDeNombre(texto));
      }),
    );
  });
});

describe("las demás fichas del catálogo", () => {
  it("nombre de cocina: exige letra y respeta su largo", () => {
    expect(nombreDeCocinaDesdeTexto("Napolitana").ok).toBe(true);
    expect(nombreDeCocinaDesdeTexto("12").ok).toBe(false);
    expect(nombreDeCocinaDesdeTexto("a".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_COCINA + 1)).ok).toBe(
      false,
    );
  });
  it("descripción: no exige letra y respeta su largo", () => {
    expect(descripcionDeCartaDesdeTexto("Con salsa").ok).toBe(true);
    expect(descripcionDeCartaDesdeTexto("2 x 1").ok).toBe(true);
    expect(descripcionDeCartaDesdeTexto("123 456")).toEqual({ ok: true, valor: "123 456" });
    expect(
      descripcionDeCartaDesdeTexto("a".repeat(LARGO_MAXIMO_DE_LA_DESCRIPCION_EN_CARTA + 1)).ok,
    ).toBe(false);
  });
  it("nombre de elección: no exige letra y respeta su largo", () => {
    expect(nombreDeEleccionDesdeTexto("12").ok).toBe(true);
    expect(nombreDeEleccionDesdeTexto("Chico").ok).toBe(true);
    expect(nombreDeEleccionDesdeTexto("a".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_ELECCION + 1)).ok).toBe(
      false,
    );
  });
  it("código interno y de barras", () => {
    expect(codigoDeProductoDesdeTexto("ABC-1.x_2").ok).toBe(true);
    for (const malo of [
      "",
      "con espacio",
      "ñ",
      "a".repeat(LARGO_MAXIMO_DEL_CODIGO_DE_PRODUCTO + 1),
    ]) {
      expect(codigoDeProductoDesdeTexto(malo).ok, malo).toBe(false);
    }
    expect(codigoDeProductoDesdeTexto("con espacio")).toEqual({
      ok: false,
      error: "CODIGO_INVALIDO",
    });
    expect(codigoDeBarrasDesdeTexto("123")).toEqual({
      ok: false,
      error: "CODIGO_DE_BARRAS_INVALIDO",
    });
    expect(codigoDeBarrasDesdeTexto("7790001234567").ok).toBe(true);
    for (const malo of ["1234567", "123456789012345", "12345abc", ""]) {
      expect(codigoDeBarrasDesdeTexto(malo).ok, malo).toBe(false);
    }
  });
});
