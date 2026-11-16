import { describe, expect, it } from "vitest";
import { telefonoDeTarjetaDesdeTexto } from "./datos-de-portal";

const ok = (t: string) => telefonoDeTarjetaDesdeTexto(t).ok;

describe("teléfono de la tarjeta del portal: lista permitida", () => {
  it("acepta los formatos reales", () => {
    for (const t of [
      "11 4321-0000",
      "+54 (11) 4321-0000",
      "4321-0000 int. 2",
      "0800-555-1234",
      "011/4321.0000",
      "1",
      "x".repeat(40),
    ])
      expect(ok(t)).toBe(true);
  });
  it("los espacios de los extremos se recortan (como la primitiva común), no se rechazan", () => {
    const r = telefonoDeTarjetaDesdeTexto("  11 4321  ");
    expect(r.ok && r.valor).toBe("11 4321");
  });
  it("rechaza lo hostil o fuera de la lista", () => {
    const malos = [
      "",
      "   ",

      "a\nb",
      "a\tb",
      "a\u0000b",
      "a​b",
      "a b",
      "a‮b",
      "<script>",
      "=cmd|' /C calc'!A0",
      "@tel",
      "11;12",
      "Teléfono",
      "📞 4321",
      "'; drop table x; --",
      "x".repeat(41),
      "１２３",
    ];
    for (const t of malos) expect(ok(t), JSON.stringify(t)).toBe(false);
  });
});
