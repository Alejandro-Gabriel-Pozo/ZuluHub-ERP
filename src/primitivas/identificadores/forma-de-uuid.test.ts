import { describe, expect, it } from "vitest";
import { esUuidCualquiera, esUuidEstandar } from "./forma-de-uuid";

const V4 = "3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b";
const V7 = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
/** Hexadecimal bien formado pero sin versión ni variante RFC 4122 (ids de fixtures y de la base, que los acepta). */
const SIN_VERSION = "11111111-2222-3333-4444-555555555555";

describe("esUuidCualquiera", () => {
  it.each([V4, V7, SIN_VERSION, V4.toUpperCase(), "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"])(
    "acepta %s",
    (valor) => {
      expect(esUuidCualquiera(valor)).toBe(true);
    },
  );

  it.each([
    "",
    "no-es-uuid",
    V4.slice(1),
    `${V4}0`,
    ` ${V4}`,
    `${V4} `,
    `${V4}\n`,
    `x${V4}`,
    V4.replaceAll("-", ""),
    V4.replace("3f2b8c1e", "3f2b8c1g"),
    V4.replace("-4a5d-", "-4a5-"),
    V4.replace("-8a9b-", "-8a9b0-"),
    V4.replace("-4e6f-", "-4e6f0-"),
    V4.replace("-0c1d2e3f4a5b", "-0c1d2e3f4a5"),
    V4.replace("-", "_"),
  ])("rechaza %j", (valor) => {
    expect(esUuidCualquiera(valor)).toBe(false);
  });

  it.each([null, undefined, 7, {}, [V4], true])("rechaza lo que no es texto (%j)", (valor) => {
    expect(esUuidCualquiera(valor)).toBe(false);
  });
});

describe("esUuidEstandar", () => {
  it.each([
    V4,
    V7,
    V4.toUpperCase(),
    ...["1", "2", "3", "4", "5", "6", "7", "8"].map(
      (v) => `3f2b8c1e-4a5d-${v}e6f-8a9b-0c1d2e3f4a5b`,
    ),
    ...["8", "9", "a", "b", "A", "B"].map((v) => `3f2b8c1e-4a5d-4e6f-${v}a9b-0c1d2e3f4a5b`),
  ])("acepta %s", (valor) => {
    expect(esUuidEstandar(valor)).toBe(true);
  });

  it.each([
    SIN_VERSION,
    "3f2b8c1e-4a5d-0e6f-8a9b-0c1d2e3f4a5b",
    "3f2b8c1e-4a5d-9e6f-8a9b-0c1d2e3f4a5b",
    "3f2b8c1e-4a5d-4e6f-0a9b-0c1d2e3f4a5b",
    "3f2b8c1e-4a5d-4e6f-ca9b-0c1d2e3f4a5b",
    "",
    `${V4}0`,
    ` ${V4}`,
    `${V4}\n`,
    `x${V4}`,
    V4.replace("3f2b8c1e", "3f2b8c1g"),
    V4.replace("-4a5d-", "-4a5-"),
    V4.replace("-8a9b-", "-8a9b0-"),
    V4.replace("-4e6f-", "-4e6f0-"),
    V4.replace("-0c1d2e3f4a5b", "-0c1d2e3f4a5"),
  ])("rechaza %j", (valor) => {
    expect(esUuidEstandar(valor)).toBe(false);
  });

  it.each([null, undefined, 7, {}, [V4]])("rechaza lo que no es texto (%j)", (valor) => {
    expect(esUuidEstandar(valor)).toBe(false);
  });
});
