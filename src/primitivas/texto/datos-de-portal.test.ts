import { describe, expect, it } from "vitest";
import { LARGO_MAXIMO_DEL_TELEFONO } from "../contacto/telefono";
import { telefonoDeTarjetaDesdeTexto } from "./datos-de-portal";

const ok = (t: string) => telefonoDeTarjetaDesdeTexto(t).ok;

describe("teléfono de la tarjeta del portal: solo números", () => {
  it("acepta solo dígitos hasta el largo de la primitiva", () => {
    for (const t of ["1143210000", "5491143210000", "0", "9".repeat(LARGO_MAXIMO_DEL_TELEFONO)])
      expect(ok(t)).toBe(true);
  });
  it("los espacios de los extremos se recortan (como la primitiva común), no se rechazan", () => {
    const r = telefonoDeTarjetaDesdeTexto("  1143210000  ");
    expect(r.ok && r.valor).toBe("1143210000");
  });
  it("rechaza todo lo que no sea un dígito ASCII", () => {
    const malos = [
      "",
      "   ",
      "11 4321",
      "11-4321",
      "+5411",
      "(011)4321",
      "int2",
      "1143a",
      "Teléfono",
      "\n",
      "1\n2",
      "1\t2",
      "1\u00012",
      "1​2",
      "1 2",
      "1‮2",
      "<1>",
      "=1",
      "@1",
      "1;2",
      "📞1",
      "１２３",
      "١٢٣",
      "1.5",
      "1e5",
      "9".repeat(LARGO_MAXIMO_DEL_TELEFONO + 1),
    ];
    for (const t of malos) expect(ok(t), JSON.stringify(t)).toBe(false);
  });
});
