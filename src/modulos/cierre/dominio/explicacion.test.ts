import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { LARGO_MAXIMO_DE_LA_EXPLICACION, explicacionDesdeTexto } from "./explicacion";

const MALA = { ok: false, error: "EXPLICACION_INVALIDA" } as const;
const ok = (valor: string | null) => ({ ok: true, valor }) as const;

describe("explicación del cierre (opcional, una línea, lista de permitidos)", () => {
  it("omitida, null o en blanco es «sin explicación»", () => {
    for (const vacia of [null, undefined, "", "   ", "\n", "\t \n"]) {
      expect(explicacionDesdeTexto(vacia), JSON.stringify(vacia)).toEqual(ok(null));
    }
  });

  it("acepta una frase en castellano con sus signos y conserva mayúsculas y tildes", () => {
    for (const buena of [
      "Autorizadas por el gerente",
      "¿Faltó $ 1.500,50? ¡Sí! (ver ticket #12 / cupón 3-4) 10% de más",
      "Diferencia de $ 18.400 entre crédito & débito",
      "Año nuevo: ñandú, güira, pingüino",
      "a",
    ]) {
      expect(explicacionDesdeTexto(buena), buena).toEqual(ok(buena));
    }
  });

  it("recorta los extremos, colapsa los espacios repetidos y compone la tilde (NFC)", () => {
    expect(explicacionDesdeTexto("  Dos   espacios \n")).toEqual(ok("Dos espacios"));
    expect(explicacionDesdeTexto("Café")).toEqual(ok("Café"));
    expect(explicacionDesdeTexto("Café")).toEqual(explicacionDesdeTexto("Café"));
  });

  it("rechaza lo que no está en la lista: saltos y tabuladores adentro, invisibles, < >, emojis y comillas raras", () => {
    for (const mala of [
      "uno\ndos",
      "uno\tdos",
      "uno​dos",
      "uno‮dos",
      "uno\u0000dos",
      "<b>negrita</b>",
      "a > b",
      "caja 🙂",
      "טקסט",
      "texto otro",
      "=SUMA(A1)",
      "@usuario",
      "a|b",
      "a\\b",
      "a{b}",
    ]) {
      expect(explicacionDesdeTexto(mala), JSON.stringify(mala)).toEqual(MALA);
    }
  });

  it("el tope es de 500 caracteres: 500 entra y 501 no (después de recortar)", () => {
    expect(LARGO_MAXIMO_DE_LA_EXPLICACION).toBe(500);
    expect(explicacionDesdeTexto("x".repeat(500))).toEqual(ok("x".repeat(500)));
    expect(explicacionDesdeTexto("x".repeat(501))).toEqual(MALA);
    expect(explicacionDesdeTexto(` ${"x".repeat(500)} `)).toEqual(ok("x".repeat(500)));
  });

  it("(propiedad) lo que acepta ya está en forma canónica: repetirlo no cambia nada y cumple el CHECK de la base", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (texto) => {
        const una = explicacionDesdeTexto(texto);
        if (!una.ok || una.valor === null) return;
        expect(explicacionDesdeTexto(una.valor)).toEqual(una);
        expect(una.valor).toBe(una.valor.trim());
        expect(una.valor.length).toBeLessThanOrEqual(500);
        // Lo que exige la base (`jornada_observacion_ck`, `control_texto_ck`): sin control y de una línea.
        const sinControl = [...una.valor].every((c) => {
          const codigo = c.codePointAt(0) ?? 0;
          return codigo > 0x1f && (codigo < 0x7f || codigo > 0x9f);
        });
        expect(sinControl).toBe(true);
      }),
    );
  });
});
