import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import type { DefinicionDePerilla } from "./perillas";
import { esValorDeLaPerilla, valorDeAjuste } from "./valores";

/**
 * `valorDeAjuste` contra la forma que impone la base (`ajuste_de_perilla_valor_ck`):
 * `^(0|[1-9][0-9]{0,8}|ILIMITADO|DEL_PLAN)$`. El oráculo es esa expresión regular, que es la misma que
 * la restricción de 0007 (una prueba de integración compara ambas contra la base).
 */

const FORMA_DE_LA_BASE = /^(0|[1-9][0-9]{0,8}|ILIMITADO|DEL_PLAN)$/;

const interruptor: DefinicionDePerilla = {
  ambito: "EMPRESA",
  tipo: "INTERRUPTOR",
  base: { encendida: false },
  modulo: "administracion",
};
const tope: DefinicionDePerilla = {
  ambito: "EMPRESA",
  tipo: "LIMITE",
  base: { limite: 0 },
  modulo: "administracion",
};

const textos = fc.oneof(
  fc.string({ maxLength: 12 }),
  fc.stringMatching(/^[0-9]{1,11}$/),
  fc.constantFrom("ILIMITADO", "DEL_PLAN", "0", "1", "999999999", "1000000000"),
);

describe("valorDeAjuste (propiedades)", () => {
  it("un límite acepta exactamente los textos que admite la base, DEL_PLAN incluido", () => {
    fc.assert(
      fc.property(textos, (texto) => {
        expect(valorDeAjuste(tope, texto) !== null).toBe(FORMA_DE_LA_BASE.test(texto));
      }),
    );
  });

  it("un interruptor acepta solo 0, 1 y DEL_PLAN, y nunca algo que la base rechace", () => {
    fc.assert(
      fc.property(textos, (texto) => {
        const valor = valorDeAjuste(interruptor, texto);
        expect(valor !== null).toBe(texto === "0" || texto === "1" || texto === "DEL_PLAN");
        if (valor !== null) expect(FORMA_DE_LA_BASE.test(texto)).toBe(true);
      }),
    );
  });

  it("lo que acepta es siempre un valor bien formado de la perilla, y un límite conserva su número", () => {
    fc.assert(
      fc.property(textos, (texto) => {
        for (const definicion of [interruptor, tope]) {
          const valor = valorDeAjuste(definicion, texto);
          if (valor === null || valor === "DEL_PLAN") continue;
          expect(esValorDeLaPerilla(definicion, valor)).toBe(true);
          if (valor.tipo === "LIMITE" && valor.limite !== "ILIMITADO") {
            expect(String(valor.limite)).toBe(texto);
          }
        }
      }),
    );
  });
});
