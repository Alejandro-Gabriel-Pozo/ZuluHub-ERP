import { describe, expect, it } from "vitest";
import {
  LARGO_MAXIMO_DEL_NOMBRE_DE_PRESENTACION,
  nombreDePresentacionDesdeTexto,
} from "./nombre-de-presentacion";

describe("nombre de una presentación de compra", () => {
  it("acepta letras, dígitos y signos permitidos; recorta y colapsa espacios", () => {
    expect(nombreDePresentacionDesdeTexto("  Caja   de 5 kg ")).toEqual({
      ok: true,
      valor: "Caja de 5 kg",
    });
    expect(nombreDePresentacionDesdeTexto("Bolsa 25 kg")).toMatchObject({ ok: true });
  });

  it("el largo es de 1 a 80: 80 pasa, 81 y vacío no", () => {
    expect(LARGO_MAXIMO_DEL_NOMBRE_DE_PRESENTACION).toBe(80);
    expect(nombreDePresentacionDesdeTexto("a".repeat(80))).toMatchObject({ ok: true });
    expect(nombreDePresentacionDesdeTexto("a".repeat(81))).toMatchObject({ ok: false });
    expect(nombreDePresentacionDesdeTexto("")).toMatchObject({ ok: false });
    expect(nombreDePresentacionDesdeTexto("   ")).toMatchObject({ ok: false });
  });

  it("exige al menos una letra: un nombre solo de números o signos no sirve", () => {
    expect(nombreDePresentacionDesdeTexto("123")).toMatchObject({ ok: false });
    expect(nombreDePresentacionDesdeTexto("5 - 10")).toMatchObject({ ok: false });
    expect(nombreDePresentacionDesdeTexto("5 kg")).toMatchObject({ ok: true });
  });

  it("no admite los signos propios del catálogo de venta (¿ ¡ ? ! % $) ni los que empiezan una fórmula", () => {
    expect(nombreDePresentacionDesdeTexto("Caja 50%")).toMatchObject({ ok: false });
    expect(nombreDePresentacionDesdeTexto("=Caja")).toMatchObject({ ok: false });
    expect(nombreDePresentacionDesdeTexto("+Caja")).toMatchObject({ ok: false });
  });
});
