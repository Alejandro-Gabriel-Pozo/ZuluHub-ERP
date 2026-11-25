import { describe, expect, it } from "vitest";
import {
  claveDeNombreDeRol,
  LARGO_MAXIMO_DEL_NOMBRE_DE_ROL,
  nombreDeRolDesdeTexto,
} from "./nombre-de-rol";

describe("nombre de un rol propio", () => {
  it("el largo máximo es el de la base (80)", () => {
    expect(LARGO_MAXIMO_DEL_NOMBRE_DE_ROL).toBe(80);
  });

  it("acepta un nombre de una línea con letras y lo devuelve canónico (sin espacios de más)", () => {
    expect(nombreDeRolDesdeTexto("  Encargado   de compras ")).toEqual({
      ok: true,
      valor: "Encargado de compras",
    });
  });

  it("acepta hasta 80 caracteres y rechaza 81", () => {
    expect(nombreDeRolDesdeTexto("a".repeat(80)).ok).toBe(true);
    expect(nombreDeRolDesdeTexto("a".repeat(81)).ok).toBe(false);
  });

  it.each(["", "   ", "123", "Caja\nchica", "<b>Cajero</b>"])("rechaza «%s»", (texto) => {
    expect(nombreDeRolDesdeTexto(texto).ok).toBe(false);
  });

  it("la clave no distingue mayúsculas ni composición de tildes", () => {
    expect(claveDeNombreDeRol("Cajero")).toBe(claveDeNombreDeRol("CAJERO"));
    expect(claveDeNombreDeRol("Café")).toBe(claveDeNombreDeRol("Café"));
    expect(claveDeNombreDeRol("Cajero")).not.toBe(claveDeNombreDeRol("Cajera"));
  });
});
