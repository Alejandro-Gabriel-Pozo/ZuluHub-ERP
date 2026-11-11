import { describe, expect, it } from "vitest";
import { esUuid } from "./identificadores";

describe("esUuid", () => {
  it("acepta un UUID en cualquier caja y rechaza todo lo demás", () => {
    expect(esUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(esUuid("123E4567-E89B-12D3-A456-426614174000")).toBe(true);
    for (const malo of [
      "",
      "x",
      "123e4567e89b12d3a456426614174000",
      " 123e4567-e89b-12d3-a456-426614174000",
      "123e4567-e89b-12d3-a456-42661417400g",
    ]) {
      expect(esUuid(malo), malo).toBe(false);
    }
  });
});
