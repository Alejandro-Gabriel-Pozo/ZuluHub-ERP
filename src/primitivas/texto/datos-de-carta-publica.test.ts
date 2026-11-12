import { describe, expect, it } from "vitest";
import {
  LARGO_MAXIMO_DEL_LUGAR_DE_CARTA,
  LARGO_MAXIMO_DEL_NOMBRE_DE_CARTA,
  LARGO_MAXIMO_DEL_RUBRO_DE_CARTA,
  codigoDeCartaDesdeTexto,
  lugarDeCartaDesdeTexto,
  nombreDeCartaDesdeTexto,
  rubroDeCartaDesdeTexto,
} from "./datos-de-carta-publica";

const TEXTOS = [
  ["nombre", nombreDeCartaDesdeTexto, LARGO_MAXIMO_DEL_NOMBRE_DE_CARTA, 80],
  ["rubro", rubroDeCartaDesdeTexto, LARGO_MAXIMO_DEL_RUBRO_DE_CARTA, 40],
  ["lugar", lugarDeCartaDesdeTexto, LARGO_MAXIMO_DEL_LUGAR_DE_CARTA, 120],
] as const;

describe.each(TEXTOS)("%s de la carta", (_dato, convertir, maximo, esperado) => {
  it("el tope es el de la especificación y el exacto entra y uno más no", () => {
    expect(maximo).toBe(esperado);
    expect(convertir("a".repeat(maximo))).toEqual({ ok: true, valor: "a".repeat(maximo) });
    expect(convertir("a".repeat(maximo + 1))).toEqual({ ok: false, error: "DEMASIADO_LARGO" });
  });

  it("acepta los nombres reales de una carta, con `¿ ¡ ? ! % $`, y no exige una letra", () => {
    for (const texto of ["Parador El Ensayo", "¿Querés papas?", "Combo 2x1 50% $500", "123"]) {
      expect(convertir(texto), texto).toEqual({ ok: true, valor: texto });
    }
  });

  it("rechaza vacío, saltos de línea, `<` y un `+` inicial; recorta los extremos", () => {
    expect(convertir("")).toEqual({ ok: false, error: "VACIO" });
    expect(convertir("   ")).toEqual({ ok: false, error: "VACIO" });
    for (const texto of ["a\nb", "<b>x</b>", "+x", "-x", "😀"]) {
      expect(convertir(texto), texto).toEqual({ ok: false, error: "CARACTER_PROHIBIDO" });
    }
    expect(convertir("  Parador  El   Ensayo ")).toEqual({ ok: true, valor: "Parador El Ensayo" });
  });
});

describe("código de la carta", () => {
  it("el largo va de 22 (128 bits en base64url) a 64", () => {
    for (const largo of [22, 23, 63, 64]) {
      const codigo = "A".repeat(largo);
      expect(codigoDeCartaDesdeTexto(codigo), `${largo}`).toEqual({ ok: true, valor: codigo });
    }
    for (const largo of [0, 1, 21, 65, 100]) {
      expect(codigoDeCartaDesdeTexto("A".repeat(largo)), `${largo}`).toEqual({
        ok: false,
        error: "CODIGO_DE_CARTA_INVALIDO",
      });
    }
  });

  it("solo el alfabeto base64url: letras, dígitos, `-` y `_`", () => {
    expect(codigoDeCartaDesdeTexto("Ab3dEf6hIj9lMn2pQr5tUv").ok).toBe(true);
    expect(codigoDeCartaDesdeTexto("Ab3dEf6hIj9lMn2pQr5-_v").ok).toBe(true);
    for (const malo of [
      "Ab3dEf6hIj9lMn2pQr5t+v",
      "Ab3dEf6hIj9lMn2pQr5t/v",
      "Ab3dEf6hIj9lMn2pQr5t=v",
      "Ab3dEf6hIj9lMn2pQr5t v",
      "Ab3dEf6hIj9lMn2pQr5tÑv",
      "Ab3dEf6hIj9lMn2pQr5tUv\n",
      "\nAb3dEf6hIj9lMn2pQr5tUv",
      "Ab3dEf6hIj9lMn2pQr5t😀",
    ]) {
      expect(codigoDeCartaDesdeTexto(malo), JSON.stringify(malo)).toEqual({
        ok: false,
        error: "CODIGO_DE_CARTA_INVALIDO",
      });
    }
  });
});
