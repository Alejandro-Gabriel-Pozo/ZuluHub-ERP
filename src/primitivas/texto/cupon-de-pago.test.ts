import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { cuponDePagoDesdeTexto, LARGO_MAXIMO_DEL_CUPON } from "./cupon-de-pago";

const MALO = { ok: false, error: "CUPON_INVALIDO" } as const;

describe("cupón de pago", () => {
  it("acepta los caracteres permitidos y conserva el texto tal cual", () => {
    for (const bueno of ["A-123", "ab 12.3_4/5-6", "x", "000123456789", " 1 "]) {
      expect(cuponDePagoDesdeTexto(bueno), bueno).toEqual({ ok: true, valor: bueno });
    }
  });

  it("acepta 12 dígitos y rechaza 13 o más seguidos", () => {
    expect(cuponDePagoDesdeTexto("1".repeat(12)).ok).toBe(true);
    expect(cuponDePagoDesdeTexto("1".repeat(13))).toEqual(MALO);
    expect(cuponDePagoDesdeTexto("1".repeat(20))).toEqual(MALO);
    expect(cuponDePagoDesdeTexto(`A${"7".repeat(13)}`)).toEqual(MALO);
  });

  it("rechaza un número de tarjeta válido (Luhn) con separadores permitidos", () => {
    for (const pan of [
      "4111 1111 1111 1111",
      "4111-1111-1111-1111",
      "4111.1111.1111.1111",
      "4111_1111_1111_1111",
      "4111/1111/1111/1111",
      "ref 4111 1111 1111 1111",
      "4222 2222 2222 2", // 13 dígitos en total, Luhn válido
    ]) {
      expect(cuponDePagoDesdeTexto(pan), pan).toEqual(MALO);
    }
  });

  it("el control de Luhn cubre de 13 a 19 dígitos: 19 se rechaza, 20 separados no son una tarjeta", () => {
    const de19 = "4511 1111 1111 1111 111";
    const de20 = "4511 1111 1111 1111 1111";
    expect(cuponDePagoDesdeTexto(de19)).toEqual(MALO);
    expect(cuponDePagoDesdeTexto(de20).ok).toBe(true);
  });

  it("el Luhn de cada dígito pesa: un error en un dígito duplicado o no duplicado lo invalida", () => {
    for (const casi of [
      "4111 1111 1111 1113",
      "4111 1111 1111 1121",
      "4111 1111 1111 1211",
      "4111 1111 1111 2111",
      "4111 1111 1111 1110",
    ]) {
      expect(cuponDePagoDesdeTexto(casi).ok, casi).toBe(true);
    }
    // Dígito duplicado mayor que 4 (el doble pasa de 9): 5 y 9 en posición duplicada.
    expect(cuponDePagoDesdeTexto("4111 1111 1111 1111").ok).toBe(false);
    expect(cuponDePagoDesdeTexto("5555 5555 5555 4444").ok).toBe(false);
    expect(cuponDePagoDesdeTexto("5555 5555 5555 4445").ok).toBe(true);
    expect(cuponDePagoDesdeTexto("3782 8224 6310 005").ok).toBe(false);
  });

  it("acepta dígitos separados que no son una tarjeta (Luhn inválido)", () => {
    expect(cuponDePagoDesdeTexto("4111 1111 1111 1112").ok).toBe(true);
  });

  it("el borde: 32 caracteres entran y 33 no", () => {
    expect(cuponDePagoDesdeTexto("a".repeat(LARGO_MAXIMO_DEL_CUPON)).ok).toBe(true);
    expect(cuponDePagoDesdeTexto("a".repeat(LARGO_MAXIMO_DEL_CUPON + 1))).toEqual(MALO);
  });

  it("rechaza vacío, `<`, `>`, control, emoji, tildes y otros símbolos", () => {
    for (const malo of [
      "",
      "a<b",
      "a>b",
      "a\nb",
      "a\tb",
      "a\u0000",
      "a😀",
      "ñ",
      "a,b",
      "a;b",
      "a​b",
    ]) {
      expect(cuponDePagoDesdeTexto(malo), JSON.stringify(malo)).toEqual(MALO);
    }
  });

  it("propiedad: nunca acepta 13 o más dígitos seguidos", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z .]{0,8}$/),
        fc.stringMatching(/^[0-9]{13,19}$/),
        fc.stringMatching(/^[A-Za-z .]{0,8}$/),
        (antes, digitos, despues) => {
          expect(cuponDePagoDesdeTexto(`${antes}${digitos}${despues}`).ok).toBe(false);
        },
      ),
    );
  });

  it("propiedad: con menos de 13 dígitos en total y la lista permitida, entra", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9 ._/-]{1,32}$/), (texto) => {
        const digitos = texto.replace(/[^0-9]/g, "").length;
        fc.pre(digitos < 13);
        expect(cuponDePagoDesdeTexto(texto)).toEqual({ ok: true, valor: texto });
      }),
    );
  });

  it("propiedad: ninguna cadena con un carácter fuera de la lista pasa", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: "binary" }),
        fc.string({ unit: "binary" }),
        (antes, despues) => {
          expect(cuponDePagoDesdeTexto(`${antes}%${despues}`).ok).toBe(false);
        },
      ),
    );
  });
});
