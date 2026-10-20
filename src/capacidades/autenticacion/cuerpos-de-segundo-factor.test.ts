import { describe, expect, it } from "vitest";
import {
  FORMA_DEL_CODIGO_DE_RECUPERACION,
  altaDeSegundoFactorDeLaLibreria,
  codigosDeRecuperacionDeLaLibreria,
  cuerpoDeCodigoDeRecuperacionValido,
  cuerpoDeCodigoDeTotpValido,
  cuerpoVacioValido,
  secretoDeLaDireccionOtpauth,
} from "./cuerpos-de-segundo-factor";

const SECRETO = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const DIRECCION = `otpauth://totp/ZuluHub%20Plataforma:ana%40ejemplo.test?secret=${SECRETO}&issuer=ZuluHub%20Plataforma&digits=6&period=30`;
const CODIGOS = Array.from({ length: 10 }, (_, i) => `abcd${i}-EFGH${i}`);

describe("cuerpoDeCodigoDeTotpValido", () => {
  it("acepta { code: <6 cifras> } y nada más", () => {
    expect(cuerpoDeCodigoDeTotpValido('{"code":"123456"}')).toBe(true);
    expect(cuerpoDeCodigoDeTotpValido('{"code":"000000"}')).toBe(true);
    expect(cuerpoDeCodigoDeTotpValido('  {"code":"123456"}\n')).toBe(true);
  });

  it.each([
    [
      "con trustDevice (un dispositivo de confianza 30 días)",
      '{"code":"123456","trustDevice":true}',
    ],
    ["con un campo ajeno", '{"code":"123456","x":1}'],
    ["sin code", "{}"],
    ["code número", '{"code":123456}'],
    ["code nulo", '{"code":null}'],
    ["code de 5 cifras", '{"code":"12345"}'],
    ["code de 7 cifras", '{"code":"1234567"}'],
    ["code con letras", '{"code":"12345a"}'],
    ["code con espacio", '{"code":"123 456"}'],
    ["code de recuperación", '{"code":"abcde-12345"}'],
    ["una lista", '[{"code":"123456"}]'],
    ["no es JSON", "code=123456"],
    ["vacío", ""],
    ["null", "null"],
    ["un texto", '"123456"'],
  ])("rechaza el cuerpo %s", (_c, cuerpo) => {
    expect(cuerpoDeCodigoDeTotpValido(cuerpo)).toBe(false);
  });

  it("rechaza uno de más de 256 caracteres aunque el resto esté bien", () => {
    expect(cuerpoDeCodigoDeTotpValido(`{"code":"123456"${" ".repeat(239)}}`)).toBe(true);
    expect(cuerpoDeCodigoDeTotpValido(`{"code":"123456"${" ".repeat(240)}}`)).toBe(false);
  });
});

describe("cuerpoDeCodigoDeRecuperacionValido", () => {
  it("acepta { code: xxxxx-xxxxx } con letras y cifras, y nada más", () => {
    expect(cuerpoDeCodigoDeRecuperacionValido('{"code":"abcde-12345"}')).toBe(true);
    expect(cuerpoDeCodigoDeRecuperacionValido('{"code":"ABCDE-xyz09"}')).toBe(true);
  });

  it.each([
    '{"code":"abcde12345"}',
    '{"code":"abcd-12345"}',
    '{"code":"abcde-123456"}',
    '{"code":"abcde-1234!"}',
    '{"code":" abcde-12345"}',
    '{"code":"123456"}',
    '{"code":"abcde-12345","trustDevice":true}',
    "{}",
    "",
  ])("rechaza %s", (cuerpo) => {
    expect(cuerpoDeCodigoDeRecuperacionValido(cuerpo)).toBe(false);
  });

  it("la forma es de cinco, un guion y cinco, anclada a todo el texto", () => {
    expect(FORMA_DEL_CODIGO_DE_RECUPERACION.test("abcde-12345")).toBe(true);
    expect(FORMA_DEL_CODIGO_DE_RECUPERACION.test("abcde-12345\n")).toBe(false);
    expect(FORMA_DEL_CODIGO_DE_RECUPERACION.test("xabcde-12345")).toBe(false);
  });
});

describe("cuerpoVacioValido", () => {
  it("acepta {} (con blancos)", () => {
    expect(cuerpoVacioValido("{}")).toBe(true);
    expect(cuerpoVacioValido(" { } \n")).toBe(true);
  });

  it.each(['{"method":"otp"}', '{"password":"x"}', '{"issuer":"x"}', "[]", "", "null", "{", "x"])(
    "rechaza %j",
    (cuerpo) => {
      expect(cuerpoVacioValido(cuerpo)).toBe(false);
    },
  );
});

describe("secretoDeLaDireccionOtpauth", () => {
  it("saca el secreto base32 de la dirección", () => {
    expect(secretoDeLaDireccionOtpauth(DIRECCION)).toBe(SECRETO);
  });

  it.each([
    ["otro esquema", `https://ejemplo.test/?secret=${SECRETO}`],
    ["sin secreto", "otpauth://totp/x:y?issuer=x"],
    ["secreto corto", "otpauth://totp/x:y?secret=ABC234"],
    ["secreto con minúsculas", `otpauth://totp/x:y?secret=${SECRETO.toLowerCase()}`],
    ["secreto con un 1 (no es base32)", `otpauth://totp/x:y?secret=${SECRETO.slice(0, 20)}1`],
    ["secreto larguísimo", `otpauth://totp/x:y?secret=${"A".repeat(129)}`],
    ["no es una dirección", "esto no es una dirección"],
    ["vacía", ""],
  ])("devuelve null si la dirección tiene %s", (_c, direccion) => {
    expect(secretoDeLaDireccionOtpauth(direccion)).toBeNull();
  });

  it("con más de un parámetro secret no se sabe cuál es: null aunque alguno sea válido", () => {
    expect(
      secretoDeLaDireccionOtpauth(`otpauth://totp/x:y?secret=ABC&secret=${SECRETO}`),
    ).toBeNull();
    expect(
      secretoDeLaDireccionOtpauth(`otpauth://totp/x:y?secret=${SECRETO}&secret=${SECRETO}`),
    ).toBeNull();
  });

  it("acepta el largo mínimo (16) y máximo (128)", () => {
    expect(secretoDeLaDireccionOtpauth(`otpauth://totp/x:y?secret=${"A".repeat(16)}`)).toBe(
      "A".repeat(16),
    );
    expect(secretoDeLaDireccionOtpauth(`otpauth://totp/x:y?secret=${"A".repeat(15)}`)).toBeNull();
    expect(secretoDeLaDireccionOtpauth(`otpauth://totp/x:y?secret=${"A".repeat(128)}`)).toBe(
      "A".repeat(128),
    );
  });
});

describe("altaDeSegundoFactorDeLaLibreria", () => {
  const cuerpo = (extra: object = {}) =>
    JSON.stringify({ method: "totp", totpURI: DIRECCION, backupCodes: CODIGOS, ...extra });

  it("extrae la dirección, el secreto y los diez códigos", () => {
    expect(altaDeSegundoFactorDeLaLibreria(cuerpo())).toEqual({
      direccion: DIRECCION,
      secreto: SECRETO,
      codigos: CODIGOS,
    });
  });

  it.each([
    ["sin dirección", { totpURI: undefined }],
    ["dirección que no es un texto", { totpURI: 5 }],
    ["dirección sin secreto", { totpURI: "otpauth://totp/x:y?issuer=x" }],
    ["sin códigos", { backupCodes: undefined }],
    ["códigos vacíos", { backupCodes: [] }],
    ["códigos que no son una lista", { backupCodes: "abcde-12345" }],
    ["un código con otra forma", { backupCodes: [...CODIGOS.slice(1), "mal"] }],
    ["un código que no es texto", { backupCodes: [...CODIGOS.slice(1), 5] }],
  ])("devuelve null %s", (_c, extra) => {
    expect(altaDeSegundoFactorDeLaLibreria(cuerpo(extra))).toBeNull();
  });

  it("devuelve null si el cuerpo no es un objeto JSON", () => {
    for (const x of ["", "null", "[]", "5", "no es json"]) {
      expect(altaDeSegundoFactorDeLaLibreria(x), x).toBeNull();
    }
  });
});

describe("codigosDeRecuperacionDeLaLibreria", () => {
  it("extrae la lista", () => {
    expect(
      codigosDeRecuperacionDeLaLibreria(JSON.stringify({ status: true, backupCodes: CODIGOS })),
    ).toEqual(CODIGOS);
  });

  it.each([
    "",
    "null",
    "{}",
    JSON.stringify({ backupCodes: [] }),
    JSON.stringify({ backupCodes: ["mal"] }),
    JSON.stringify({ backupCodes: "x" }),
  ])("devuelve null para %j", (cuerpo) => {
    expect(codigosDeRecuperacionDeLaLibreria(cuerpo)).toBeNull();
  });
});

describe("tipos de los campos de la respuesta de la librería (nada se coacciona a texto)", () => {
  it("una dirección que es una lista con la dirección adentro no vale (sería texto al coaccionarla)", () => {
    expect(
      altaDeSegundoFactorDeLaLibreria(
        JSON.stringify({ totpURI: [DIRECCION], backupCodes: CODIGOS }),
      ),
    ).toBeNull();
  });

  it("un código de recuperación que es una lista con el código adentro no vale", () => {
    expect(
      codigosDeRecuperacionDeLaLibreria(JSON.stringify({ backupCodes: [["abcde-12345"]] })),
    ).toBeNull();
    expect(
      altaDeSegundoFactorDeLaLibreria(
        JSON.stringify({ totpURI: DIRECCION, backupCodes: [["abcde-12345"]] }),
      ),
    ).toBeNull();
  });
});
