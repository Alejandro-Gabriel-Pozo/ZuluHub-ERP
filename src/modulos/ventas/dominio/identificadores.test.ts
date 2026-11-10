import { describe, expect, it } from "vitest";
import { cobranzaId, cuentaId, ejemplarId, esUuid, lineaId, ticketId } from "./identificadores";

describe("identificadores de ventas", () => {
  it("los constructores devuelven el mismo texto con otra marca", () => {
    for (const construir of [cuentaId, lineaId, ticketId, ejemplarId, cobranzaId]) {
      expect(construir("abc")).toBe("abc");
    }
  });
  it("un uuid es exactamente un uuid (sin nada antes ni después)", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    expect(esUuid(uuid)).toBe(true);
    expect(esUuid(uuid.toUpperCase())).toBe(true);
    expect(esUuid(`x${uuid}`)).toBe(false);
    expect(esUuid(`${uuid}x`)).toBe(false);
    expect(esUuid("")).toBe(false);
    expect(esUuid("no-es-uuid")).toBe(false);
  });
});
