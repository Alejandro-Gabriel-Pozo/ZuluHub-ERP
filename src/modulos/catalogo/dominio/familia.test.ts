import { describe, expect, it } from "vitest";
import {
  hayLugarEnLaFamilia,
  MAXIMO_DE_MIEMBROS_DE_FAMILIA,
  nombreDeFamiliaDesdeTexto,
} from "./familia";

describe("nombreDeFamiliaDesdeTexto", () => {
  it("acepta un nombre de catálogo y devuelve su clave sin mayúsculas", () => {
    expect(nombreDeFamiliaDesdeTexto("Café")).toEqual({
      ok: true,
      valor: { nombre: "Café", nombreClave: "café" },
    });
    expect(nombreDeFamiliaDesdeTexto("Gaseosa 500 cc")).toMatchObject({ ok: true });
  });

  it("rechaza lo vacío, lo que no es de una línea, los signos fuera de la lista y lo demasiado largo", () => {
    for (const malo of ["", "   ", "<b>x</b>", "a\nb", "x".repeat(121), "123"]) {
      expect(nombreDeFamiliaDesdeTexto(malo)).toEqual({
        ok: false,
        error: "NOMBRE_DE_FAMILIA_INVALIDO",
      });
    }
    expect(nombreDeFamiliaDesdeTexto("x".repeat(120))).toMatchObject({ ok: true });
  });
});

describe("hayLugarEnLaFamilia", () => {
  it("el tope es exacto", () => {
    expect(MAXIMO_DE_MIEMBROS_DE_FAMILIA).toBe(50);
    expect(hayLugarEnLaFamilia(0)).toBe(true);
    expect(hayLugarEnLaFamilia(49)).toBe(true);
    expect(hayLugarEnLaFamilia(50)).toBe(false);
    expect(hayLugarEnLaFamilia(51)).toBe(false);
    expect(hayLugarEnLaFamilia(-1)).toBe(false);
    expect(hayLugarEnLaFamilia(1.5)).toBe(false);
  });
});
