import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CIFRAS_DEL_CODIGO_DE_TOTP,
  FORMA_DEL_CODIGO_DE_TOTP,
  PERIODO_DE_TOTP_EN_SEGUNDOS,
  codigoDeTotp,
  pasoDeTotp,
  pasoDelCodigo,
} from "./totp";

/** El secreto de los vectores de la RFC 4226 y la RFC 6238 (SHA-1): los bytes ASCII de este texto. */
const SECRETO_DE_LA_RFC = "12345678901234567890";
const en = (segundos: number) => new Date(segundos * 1000);

describe("constantes del TOTP", () => {
  it("pasos de 30 segundos y códigos de 6 cifras", () => {
    expect(PERIODO_DE_TOTP_EN_SEGUNDOS).toBe(30);
    expect(CIFRAS_DEL_CODIGO_DE_TOTP).toBe(6);
    expect(FORMA_DEL_CODIGO_DE_TOTP.test("012345")).toBe(true);
    expect(FORMA_DEL_CODIGO_DE_TOTP.test("12345")).toBe(false);
    expect(FORMA_DEL_CODIGO_DE_TOTP.test("1234567")).toBe(false);
    expect(FORMA_DEL_CODIGO_DE_TOTP.test("12345a")).toBe(false);
    expect(FORMA_DEL_CODIGO_DE_TOTP.test(" 12345")).toBe(false);
    expect(FORMA_DEL_CODIGO_DE_TOTP.test("123456\n")).toBe(false);
  });
});

describe("codigoDeTotp: vectores de la RFC 4226 (apéndice D, HOTP por contador)", () => {
  it.each([
    [0, "755224"],
    [1, "287082"],
    [2, "359152"],
    [3, "969429"],
    [4, "338314"],
    [5, "254676"],
    [6, "287922"],
    [7, "162583"],
    [8, "399871"],
    [9, "520489"],
  ])("contador %i → %s", (contador, esperado) => {
    expect(codigoDeTotp(SECRETO_DE_LA_RFC, contador)).toBe(esperado);
  });
});

describe("codigoDeTotp + pasoDeTotp: vectores de la RFC 6238 (SHA-1; las seis últimas cifras de los de 8)", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])("a los %i segundos → %s", (segundos, esperado) => {
    expect(codigoDeTotp(SECRETO_DE_LA_RFC, pasoDeTotp(en(segundos)))).toBe(esperado);
  });

  it("los ceros a la izquierda se conservan (siempre 6 cifras)", () => {
    expect(codigoDeTotp(SECRETO_DE_LA_RFC, pasoDeTotp(en(1111111109)))).toHaveLength(6);
    expect(codigoDeTotp(SECRETO_DE_LA_RFC, pasoDeTotp(en(1111111109)))).toBe("081804");
  });

  it("la clave es el texto del secreto en UTF-8: otro secreto, otro código", () => {
    expect(codigoDeTotp("12345678901234567891", 1)).not.toBe(codigoDeTotp(SECRETO_DE_LA_RFC, 1));
  });
});

describe("pasoDeTotp", () => {
  it("es el piso de los segundos divididos por 30", () => {
    expect(pasoDeTotp(en(0))).toBe(0);
    expect(pasoDeTotp(en(29))).toBe(0);
    expect(pasoDeTotp(new Date(29_999))).toBe(0);
    expect(pasoDeTotp(en(30))).toBe(1);
    expect(pasoDeTotp(new Date(30_001))).toBe(1);
    expect(pasoDeTotp(en(59))).toBe(1);
    expect(pasoDeTotp(en(60))).toBe(2);
  });
});

describe("pasoDelCodigo", () => {
  const AHORA = en(1111111111);
  const PASO = pasoDeTotp(AHORA);

  it("el código del paso actual coincide con el paso actual", () => {
    expect(pasoDelCodigo(SECRETO_DE_LA_RFC, codigoDeTotp(SECRETO_DE_LA_RFC, PASO), AHORA)).toBe(
      PASO,
    );
  });

  it("acepta un paso a cada lado (deriva del reloj del teléfono) y dice cuál fue", () => {
    expect(pasoDelCodigo(SECRETO_DE_LA_RFC, codigoDeTotp(SECRETO_DE_LA_RFC, PASO - 1), AHORA)).toBe(
      PASO - 1,
    );
    expect(pasoDelCodigo(SECRETO_DE_LA_RFC, codigoDeTotp(SECRETO_DE_LA_RFC, PASO + 1), AHORA)).toBe(
      PASO + 1,
    );
  });

  it("no acepta dos pasos o más de distancia", () => {
    for (const desvio of [-3, -2, 2, 3, 100]) {
      expect(
        pasoDelCodigo(SECRETO_DE_LA_RFC, codigoDeTotp(SECRETO_DE_LA_RFC, PASO + desvio), AHORA),
        `desvío ${desvio}`,
      ).toBeNull();
    }
  });

  it("no acepta el código de otro secreto", () => {
    expect(
      pasoDelCodigo(SECRETO_DE_LA_RFC, codigoDeTotp("otro-secreto-cualquiera", PASO), AHORA),
    ).toBeNull();
  });

  it.each([
    "",
    "12345",
    "1234567",
    "abcdef",
    "12 456",
    " 12345",
    "12345 ",
    "０１２３４５",
    "12345\n",
  ])("un código sin la forma de 6 cifras (%j) no coincide con nada", (codigo) => {
    expect(pasoDelCodigo(SECRETO_DE_LA_RFC, codigo, AHORA)).toBeNull();
  });

  it("si el código vale en dos pasos vecinos (1 de cada millón de pares), manda el actual", () => {
    // Un secreto hallado de antemano donde el paso 500 y el 501 dan el mismo código.
    const secreto = "choque-464041";
    expect(codigoDeTotp(secreto, 500)).toBe(codigoDeTotp(secreto, 501));
    const codigo = codigoDeTotp(secreto, 500);
    // Estando en el paso 501 coinciden el actual (501) y el anterior (500): manda el actual.
    expect(pasoDelCodigo(secreto, codigo, new Date(501 * 30_000))).toBe(501);
    // Estando en el paso 500 coinciden el actual (500) y el siguiente (501): manda el actual.
    expect(pasoDelCodigo(secreto, codigo, new Date(500 * 30_000))).toBe(500);
    // Estando en el 502 coinciden el anterior (501) y el de dos pasos atrás (500, fuera de ventana): el 501.
    expect(pasoDelCodigo(secreto, codigo, new Date(502 * 30_000))).toBe(501);
    // Estando en el 499 coinciden el siguiente (500) y el 501 (fuera de ventana): el 500.
    expect(pasoDelCodigo(secreto, codigo, new Date(499 * 30_000))).toBe(500);
  });

  it("si el código vale en el paso anterior y en el siguiente (no en el actual), manda el anterior", () => {
    // Un secreto hallado de antemano donde el paso 499 y el 501 dan el mismo código, y el 500 otro.
    const secreto = "choque-vecinos-2882103";
    expect(codigoDeTotp(secreto, 499)).toBe(codigoDeTotp(secreto, 501));
    expect(codigoDeTotp(secreto, 500)).not.toBe(codigoDeTotp(secreto, 499));
    expect(pasoDelCodigo(secreto, codigoDeTotp(secreto, 499), new Date(500 * 30_000))).toBe(499);
  });

  it("propiedad: para cualquier secreto y paso, el código de un paso a ≤ 1 de distancia se encuentra y los de ≥ 2 no", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 8, maxLength: 40 }),
        fc.integer({ min: 10, max: 10_000_000 }),
        fc.integer({ min: -5, max: 5 }),
        (secreto, paso, desvio) => {
          const ahora = new Date(paso * 30_000 + 1234);
          const hallado = pasoDelCodigo(secreto, codigoDeTotp(secreto, paso + desvio), ahora);
          if (Math.abs(desvio) <= 1) expect(hallado).not.toBeNull();
          else if (hallado !== null) {
            // Solo puede ser un choque de códigos (1 en un millón): entonces el paso hallado está dentro de la ventana.
            expect(Math.abs(hallado - paso)).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
