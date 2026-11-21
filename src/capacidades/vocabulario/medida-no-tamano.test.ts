import { describe, expect, it } from "vitest";
import { CATALOGO_DE_TEXTOS } from "./catalogo";

/**
 * Decisión del dueño (12/11/2026, A10): cuando una pantalla nombra la medida de un producto se dice «medida», nunca «tamaño». No cambian «Tamaño de la letra», los tamaños de archivo,
 * imagen o pantalla ni los valores «Chico/Mediano/Grande». Previene: que un texto nuevo del catálogo vuelva a decir «tamaño» para la medida de un producto (el vocabulario ya cumple hoy).
 * Un texto con «tamaño» solo pasa si figura acá, con su motivo: lista cerrada (denegar por defecto).
 */
const EXCEPCIONES: Readonly<Record<string, string>> = {
  "vidriera.letra.grupo": "«Tamaño de la letra» de la carta: no es la medida de un producto",
  "salon.texto.admin_tamano": "el tamaño de una mesa en el salón: no es la medida de un producto",
};

const DICE_TAMANO = /tama(?:ñ|n)o/iu;

function clavesConTamano(catalogo: Readonly<Record<string, { porDefecto: string }>>): string[] {
  return Object.entries(catalogo)
    .filter(([, d]) => DICE_TAMANO.test(d.porDefecto.normalize("NFC")))
    .map(([clave]) => clave);
}

describe("vocabulario: «medida» y no «tamaño» para un producto", () => {
  it("solo dicen «tamaño» los textos exceptuados, y cada excepción sigue existiendo", () => {
    expect(clavesConTamano(CATALOGO_DE_TEXTOS).sort()).toEqual(Object.keys(EXCEPCIONES).sort());
  });

  it("detecta un texto nuevo que diga «tamaño», «Tamaños» o «TAMANO» (violación inyectada)", () => {
    const inyectado = {
      "catalogo.x.a": { porDefecto: "Elegí el tamaño" },
      "catalogo.x.b": { porDefecto: "Tamaños" },
      "catalogo.x.c": { porDefecto: "TAMANO" },
      "catalogo.x.d": { porDefecto: "Según medida" },
    };
    expect(clavesConTamano(inyectado)).toEqual(["catalogo.x.a", "catalogo.x.b", "catalogo.x.c"]);
  });
});
