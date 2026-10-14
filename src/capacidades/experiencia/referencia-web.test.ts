import { describe, expect, it } from "vitest";
import { bytesDeDigest } from "./referencia-web";

describe("bytesDeDigest", () => {
  it("son 4 bytes", () => {
    expect(bytesDeDigest("123456789")).toHaveLength(4);
    expect(bytesDeDigest("")).toHaveLength(4);
  });

  it("FNV-1a de 32 bits (vectores conocidos)", () => {
    // Vectores de la definición de FNV-1a 32: "" = 811c9dc5, "a" = e40c292c, "foobar" = bf9cf968.
    expect([...bytesDeDigest("")]).toEqual([0x81, 0x1c, 0x9d, 0xc5]);
    expect([...bytesDeDigest("a")]).toEqual([0xe4, 0x0c, 0x29, 0x2c]);
    expect([...bytesDeDigest("foobar")]).toEqual([0xbf, 0x9c, 0xf9, 0x68]);
  });

  it("es determinista y distingue digests", () => {
    expect(bytesDeDigest("2581439760")).toEqual(bytesDeDigest("2581439760"));
    expect(bytesDeDigest("2581439760")).not.toEqual(bytesDeDigest("2581439761"));
  });
});
