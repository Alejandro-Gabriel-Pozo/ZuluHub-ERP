import { describe, expect, it } from "vitest";
import { err, ok } from "./resultado";

describe("Resultado", () => {
  it("ok lleva el valor y err lleva el error", () => {
    expect(ok(5)).toEqual({ ok: true, valor: 5 });
    expect(err("X")).toEqual({ ok: false, error: "X" });
  });
});
