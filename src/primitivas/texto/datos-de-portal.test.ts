import { describe, expect, it } from "vitest";
import { LARGO_MAXIMO_DEL_TELEFONO } from "../contacto/telefono";
import {
  lineaDelPortalDesdeTexto,
  telefonoDeTarjetaDesdeTexto,
  tituloDelPortalDesdeTexto,
} from "./datos-de-portal";

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

/** La línea superior (hasta 40) y el título (hasta 60) del portal: el largo, que no exijan letra y los signos del catálogo (DEC-0483). */
describe.each([
  { nombre: "la línea superior", desde: lineaDelPortalDesdeTexto, maximo: 40 },
  { nombre: "el título", desde: tituloDelPortalDesdeTexto, maximo: 60 },
])("$nombre del portal", ({ desde, maximo }) => {
  it("acepta un texto válido y lo devuelve en su forma canónica", () => {
    expect(desde("  Nuestros   restaurantes ")).toEqual({
      ok: true,
      valor: "Nuestros restaurantes",
    });
  });
  it(`acepta hasta ${maximo} caracteres y rechaza uno más`, () => {
    expect(desde("a".repeat(maximo))).toEqual({ ok: true, valor: "a".repeat(maximo) });
    expect(desde("a".repeat(maximo + 1))).toEqual({ ok: false, error: "DEMASIADO_LARGO" });
  });
  it("no exige ninguna letra: solo números o signos permitidos pasan", () => {
    expect(desde("2026")).toEqual({ ok: true, valor: "2026" });
    expect(desde("(24)")).toEqual({ ok: true, valor: "(24)" });
  });
  it("admite los signos del catálogo (¿ ¡ ? ! % $)", () => {
    expect(desde("¿Hacés clic? ¡Ya! 50% $")).toEqual({
      ok: true,
      valor: "¿Hacés clic? ¡Ya! 50% $",
    });
  });
  it("rechaza lo vacío y lo que no está en la lista de permitidos", () => {
    expect(desde("   ")).toEqual({ ok: false, error: "VACIO" });
    expect(desde("<b>")).toEqual({ ok: false, error: "CARACTER_PROHIBIDO" });
    expect(desde("=1+1")).toEqual({ ok: false, error: "CARACTER_PROHIBIDO" });
    expect(desde("📞")).toEqual({ ok: false, error: "CARACTER_PROHIBIDO" });
  });
});

describe("el código de error del teléfono de la tarjeta", () => {
  it("es exactamente TELEFONO_INVALIDO ante un guion, un espacio o una letra", () => {
    for (const t of ["11-4321", "11 4321", "11a4321"])
      expect(telefonoDeTarjetaDesdeTexto(t), t).toEqual({ ok: false, error: "TELEFONO_INVALIDO" });
  });
});
