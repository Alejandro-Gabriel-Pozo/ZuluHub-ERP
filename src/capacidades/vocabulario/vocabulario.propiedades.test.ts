import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { CATALOGO_DE_TEXTOS, type ClaveDeTexto } from "./catalogo";
import { resolverVocabulario, texto, validarVocabulario, type Vocabulario } from "./vocabulario";

/**
 * Propiedades del vocabulario (marcas y planes, §D «Vocabulario»): resolver con herencia no pierde ni
 * inventa claves, y pintar nunca devuelve vacío, pase lo que pase con los datos guardados.
 */

const CLAVES = Object.keys(CATALOGO_DE_TEXTOS) as ClaveDeTexto[];
const FORMATO_DE_CLAVE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,5}$/;

const claveGuardada = fc.oneof(
  fc.constantFrom(...CLAVES),
  fc.constantFrom(...CLAVES),
  // Huérfanas bien formadas, y claves con la forma de las propias de todo objeto.
  fc.stringMatching(FORMATO_DE_CLAVE),
  fc.constantFrom("constructor", "toString", "__proto__", "hasOwnProperty"),
);

const textoGuardado = fc.oneof(
  fc.constantFrom(
    "",
    "   ",
    "<b>x</b>",
    "Con {limite} dentro",
    "Sin marcadores",
    "{limite}",
    "{otro}",
    "​cero",
    "  Recortado  ",
    "é",
  ),
  fc.string({ maxLength: 100 }),
  fc.string({ unit: "grapheme", maxLength: 30 }),
);

const vocabulario: fc.Arbitrary<Vocabulario> = fc
  .array(fc.tuple(claveGuardada, textoGuardado), { maxLength: 8 })
  .map((pares) => Object.fromEntries(pares));

const cadena = fc.array(vocabulario, { maxLength: 3 });

const esValido = (clave: string, valor: string): boolean => {
  const r = validarVocabulario({ [clave]: valor });
  return r.ok;
};

describe("resolver el vocabulario con herencia", () => {
  it("solo trae claves del catálogo con un texto ya válido y canónico", () => {
    fc.assert(
      fc.property(cadena, (eslabones) => {
        const resuelto = resolverVocabulario(eslabones);
        for (const [clave, valor] of Object.entries(resuelto)) {
          expect(Object.hasOwn(CATALOGO_DE_TEXTOS, clave)).toBe(true);
          expect(validarVocabulario({ [clave]: valor })).toEqual({
            ok: true,
            valor: { [clave]: valor },
          });
        }
      }),
    );
  });

  it("no pierde ni inventa: cada clave con algún reemplazo válido está, y con el del primer eslabón que lo tiene válido", () => {
    fc.assert(
      fc.property(cadena, (eslabones) => {
        const resuelto = resolverVocabulario(eslabones) as Record<string, string>;
        const esperado = new Map<string, string>();
        for (const eslabon of eslabones) {
          for (const [clave, valor] of Object.entries(eslabon)) {
            if (esperado.has(clave) || !Object.hasOwn(CATALOGO_DE_TEXTOS, clave)) continue;
            const r = validarVocabulario({ [clave]: valor });
            if (r.ok) esperado.set(clave, r.valor[clave] as string);
          }
        }
        expect(Object.keys(resuelto).sort()).toEqual([...esperado.keys()].sort());
        for (const [clave, valor] of esperado) expect(resuelto[clave]).toBe(valor);
      }),
    );
  });

  it("un eslabón de más al final no cambia lo que ya estaba resuelto, y solo puede sumar claves", () => {
    fc.assert(
      fc.property(cadena, vocabulario, (eslabones, extra) => {
        const antes = resolverVocabulario(eslabones) as Record<string, string>;
        const despues = resolverVocabulario([...eslabones, extra]) as Record<string, string>;
        for (const [clave, valor] of Object.entries(antes)) expect(despues[clave]).toBe(valor);
        expect(Object.keys(despues).length).toBeGreaterThanOrEqual(Object.keys(antes).length);
      }),
    );
  });

  it("con un solo eslabón, el resultado es lo válido de ese eslabón y resolver es idempotente", () => {
    fc.assert(
      fc.property(vocabulario, (uno) => {
        const una = resolverVocabulario([uno]);
        expect(resolverVocabulario([una as Vocabulario])).toEqual(una);
        for (const clave of Object.keys(una)) expect(Object.hasOwn(uno, clave)).toBe(true);
      }),
    );
  });

  it("las claves de la marca ganan a las del padre y a las del abuelo", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CLAVES), (clave) => {
        const defecto = CATALOGO_DE_TEXTOS[clave].porDefecto;
        const resuelto = resolverVocabulario([
          { [clave]: `${defecto}!` },
          { [clave]: `${defecto}?` },
          { [clave]: `${defecto}.` },
        ]) as Record<string, string>;
        expect(resuelto[clave]).toBe(`${defecto}!`);
      }),
    );
  });
});

describe("pintar un texto", () => {
  const valores = fc.dictionary(
    fc.constantFrom("limite", "otro", "constructor"),
    fc.oneof(
      fc.string({ maxLength: 10 }),
      fc.integer(),
      fc.constantFrom("", " ", "{limite}", "$&"),
    ),
  );

  it("nunca devuelve vacío, ni en blanco, con cualquier dato guardado y cualquier valor", () => {
    fc.assert(
      fc.property(
        cadena,
        fc.constantFrom(...CLAVES),
        fc.option(valores, { nil: undefined }),
        (eslabones, clave, v) => {
          const resultado = texto(resolverVocabulario(eslabones), clave, v);
          expect(resultado.trim()).not.toBe("");
        },
      ),
    );
  });

  it("sin reemplazo y sin valores, es el texto por defecto del catálogo", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CLAVES), (clave) => {
        expect(texto({}, clave)).toBe(CATALOGO_DE_TEXTOS[clave].porDefecto);
      }),
    );
  });

  it("el texto por defecto de cada clave es válido como reemplazo (el catálogo cumple sus propias reglas)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CLAVES), (clave) => {
        expect(esValido(clave, CATALOGO_DE_TEXTOS[clave].porDefecto)).toBe(true);
      }),
    );
  });
});

describe("validar el vocabulario", () => {
  it("validar es idempotente: lo que devuelve vuelve a validar igual", () => {
    fc.assert(
      fc.property(vocabulario, (v) => {
        const primera = validarVocabulario(v);
        if (!primera.ok) return;
        expect(validarVocabulario(primera.valor)).toEqual(primera);
      }),
    );
  });

  it("acepta exactamente los vocabularios cuyas claves y textos aceptan uno por uno", () => {
    fc.assert(
      fc.property(vocabulario, (v) => {
        const todo = validarVocabulario(v).ok;
        const porPartes = Object.entries(v).every(([clave, valor]) => esValido(clave, valor));
        expect(todo).toBe(porPartes);
      }),
    );
  });
});
